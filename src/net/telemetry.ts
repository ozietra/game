import { BUILD_ID, METRICS_ENDPOINT, METRICS_PROTOCOL } from '../data/config';
import type { GameState } from '../core/types';

/**
 * Anonymous play metrics.
 *
 * The whole point of this file is to answer questions the game cannot answer
 * from a single save file: do people come back the next day, how long does a
 * first sitting last, which floor do they quit on. Nothing here identifies a
 * person. There is a random identifier so two sittings from the same browser
 * can be joined, and that is the extent of it: no address, no name, no screen
 * fingerprint, no third party.
 *
 * It stays quiet in every direction. Without VITE_METRICS_URL nothing is even
 * queued. With Do Not Track or Global Privacy Control set, nothing is queued.
 * With the switch in the settings turned off, nothing is queued. Every failure
 * is swallowed: a blocked request must never cost a frame.
 */

export type Mark = 'install' | 'session' | 'beat' | 'dive' | 'wipe' | 'extract' | 'prestige' | 'close';

interface Sample {
  k: Mark;
  t: number;
  s: number;
  f: number;
  d?: string;
}

const PID_KEY = 'hollowdeep.pid.v1';
const RUNS_KEY = 'hollowdeep.runs.v1';

/** A minute between flushes keeps a busy day inside a free collector's budget. */
const FLUSH_SECONDS = 60;
const BEAT_SECONDS = 60;
const BATCH_LIMIT = 40;
const QUEUE_LIMIT = 120;

function randomId(): string {
  const scope = globalThis.crypto;
  if (scope && 'randomUUID' in scope) return scope.randomUUID().replace(/-/g, '').slice(0, 24);
  let out = '';
  for (let i = 0; i < 24; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A blocked store just means this browser stays anonymous between visits.
  }
}

/** Browser level refusals, which outrank the game's own switch. */
function refusedByBrowser(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const legacy = (globalThis as { doNotTrack?: string }).doNotTrack;
  return nav.doNotTrack === '1' || nav.msDoNotTrack === '1' || legacy === '1' || nav.globalPrivacyControl === true;
}

class Telemetry {
  private state: GameState | null = null;
  private queue: Sample[] = [];
  private pid = '';
  private sid = '';
  private ordinal = 1;
  private started = 0;
  private active = 0;
  private since = 0;
  private visible = true;
  private floor = 0;
  private sinceFlush = 0;
  private sinceBeat = 0;
  private sending = false;
  private live = false;

  /** True when this build could send anything at all. */
  get configured(): boolean {
    return METRICS_ENDPOINT.length > 0;
  }

  begin(state: GameState): void {
    this.state = state;
    if (!this.configured) return;

    this.pid = readLocal(PID_KEY) ?? '';
    const known = this.pid.length > 0;
    if (!known) {
      this.pid = randomId();
      writeLocal(PID_KEY, this.pid);
    }

    this.ordinal = Math.max(1, Number(readLocal(RUNS_KEY) ?? '0') + 1);
    writeLocal(RUNS_KEY, String(this.ordinal));

    this.sid = randomId();
    this.started = Date.now();
    this.since = this.started;
    this.active = 0;
    this.visible = document.visibilityState !== 'hidden';
    this.live = this.allowed();

    if (!known) this.push('install');
    this.push('session', state.deepestFloor);

    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.finish());
    window.addEventListener('beforeunload', () => this.finish());
  }

  /** The settings switch. Turning it off drops whatever is still queued. */
  setEnabled(on: boolean): void {
    if (this.state) this.state.shareMetrics = on;
    this.live = this.allowed();
    if (!this.live) this.queue.length = 0;
  }

  /** Whether the settings switch is worth showing at all. */
  get available(): boolean {
    return this.configured && !refusedByBrowser();
  }

  private allowed(): boolean {
    if (!this.configured || refusedByBrowser()) return false;
    return this.state?.shareMetrics !== false;
  }

  private onVisibility(): void {
    const now = Date.now();
    if (document.visibilityState === 'hidden') {
      if (this.visible) this.active += (now - this.since) / 1000;
      this.visible = false;
      this.flush(true);
    } else {
      this.visible = true;
      this.since = now;
    }
  }

  private elapsed(): number {
    const running = this.visible ? (Date.now() - this.since) / 1000 : 0;
    return Math.round(this.active + running);
  }

  private push(kind: Mark, floor?: number, detail?: string): void {
    if (!this.allowed()) return;
    const sample: Sample = {
      k: kind,
      t: Date.now(),
      s: this.elapsed(),
      f: Math.max(0, Math.round(floor ?? this.floor)),
    };
    if (detail) sample.d = detail.slice(0, 48);
    this.queue.push(sample);
    if (this.queue.length > QUEUE_LIMIT) this.queue.splice(0, this.queue.length - QUEUE_LIMIT);
  }

  /**
   * Something worth a row in the panel happened. `floor` is the floor it
   * happened on, which is the whole point for wipes and extractions.
   */
  mark(kind: Mark, floor: number, detail?: string): void {
    this.floor = Math.max(this.floor, Math.round(floor));
    this.push(kind, floor, detail);
  }

  /** Called every frame from the shell; cheap, and the only clock this has. */
  tick(dt: number, floor: number): void {
    if (!this.configured) return;
    this.floor = Math.max(this.floor, Math.round(floor));
    this.sinceFlush += dt;
    this.sinceBeat += dt;
    if (this.sinceBeat >= BEAT_SECONDS) {
      this.sinceBeat = 0;
      this.push('beat');
    }
    if (this.sinceFlush >= FLUSH_SECONDS) {
      this.sinceFlush = 0;
      this.flush(false);
    }
  }

  private envelope(events: Sample[]): string {
    return JSON.stringify({
      v: METRICS_PROTOCOL,
      pid: this.pid,
      sid: this.sid,
      n: this.ordinal,
      build: BUILD_ID,
      lang: this.state?.language ?? 'tr',
      events,
    });
  }

  private flush(urgent: boolean): void {
    if (!this.allowed() || this.queue.length === 0) return;
    if (this.sending && !urgent) return;

    const batch = this.queue.splice(0, BATCH_LIMIT);
    const body = this.envelope(batch);
    const url = `${METRICS_ENDPOINT}/collect`;

    // text/plain keeps this a simple request, so no preflight and no second
    // round trip for something nobody is waiting on.
    if (urgent && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      if (!ok) this.queue.unshift(...batch);
      return;
    }

    this.sending = true;
    void fetch(url, {
      method: 'POST',
      body,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok && response.status >= 500) this.queue.unshift(...batch);
      })
      .catch(() => {
        this.queue.unshift(...batch);
      })
      .finally(() => {
        this.sending = false;
      });
  }

  /** Last word of a sitting: how long it ran and how deep it got. */
  finish(): void {
    if (!this.allowed()) return;
    if (this.visible) {
      this.active += (Date.now() - this.since) / 1000;
      this.visible = false;
    }
    this.push('close');
    this.flush(true);
  }
}

export const metrics = new Telemetry();

import manifest from '../data/assets.json';

const CUES = (manifest as { sounds?: Record<string, string[]> }).sounds ?? {};

/**
 * How close together the same cue may fire, in seconds. Combat can throw a
 * dozen hits at once and an idle game is meant to sit in the background, so
 * every cue has a floor and the whole mixer has a ceiling.
 */
const GAP: Record<string, number> = {
  strike: 0.11,
  clank: 0.16,
  loot: 0.4,
  step: 0.5,
  leaf: 0.5,
  click: 0.05,
};

const DEFAULT_GAP = 0.25;
const MAX_PER_SECOND = 9;

/**
 * Which switch a cue answers to. Pressing things and turning pages is how the
 * interface talks back, and somebody who wants the fighting to shut up rarely
 * wants that gone too, so the two are separate.
 */
const INTERFACE_CUES = new Set(['click', 'buy', 'rank', 'leaf']);

/** The looping theme, if the build carries one. */
const THEME = 'assets/sound/theme.ogg';

export interface PlayOptions {
  gain?: number;
  rate?: number;
}

function url(path: string): string {
  const base = import.meta.env.BASE_URL ?? './';
  return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

class Mixer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly encoded = new Map<string, ArrayBuffer[]>();
  private readonly decoded = new Map<string, AudioBuffer[]>();
  private readonly lastPlayed = new Map<string, number>();
  private recent: number[] = [];
  private loading: Promise<void> | null = null;

  volume = 0.6;
  muted = false;
  effects = true;
  musicVolume = 0.35;

  private music: GainNode | null = null;
  private theme: AudioBufferSourceNode | null = null;
  private themeBuffer: AudioBuffer | null = null;
  private themeEncoded: ArrayBuffer | null = null;

  /** Downloads the clips. Decoding waits for a real audio context. */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    const jobs: Promise<void>[] = [];
    for (const [cue, files] of Object.entries(CUES)) {
      for (const file of files) {
        jobs.push(
          fetch(url(file))
            .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(file))))
            .then((buffer) => {
              const bucket = this.encoded.get(cue) ?? [];
              bucket.push(buffer);
              this.encoded.set(cue, bucket);
            })
            .catch(() => undefined),
        );
      }
    }
    // The theme is optional: a build without one simply never has music.
    jobs.push(
      fetch(url(THEME))
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(THEME))))
        .then((buffer) => {
          this.themeEncoded = buffer;
        })
        .catch(() => undefined),
    );

    this.loading = Promise.all(jobs).then(() => undefined);
    return this.loading;
  }

  /** Browsers only allow audio after a gesture, so this runs on the first click. */
  async unlock(): Promise<void> {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(this.context.destination);

    this.music = this.context.createGain();
    this.music.gain.value = this.musicVolume;
    this.music.connect(this.master);

    await this.load();
    for (const [cue, buffers] of this.encoded) {
      for (const buffer of buffers) {
        try {
          const audio = await this.context.decodeAudioData(buffer.slice(0));
          const bucket = this.decoded.get(cue) ?? [];
          bucket.push(audio);
          this.decoded.set(cue, bucket);
        } catch {
          // A clip that will not decode simply never plays.
        }
      }
    }

    if (this.themeEncoded) {
      try {
        this.themeBuffer = await this.context.decodeAudioData(this.themeEncoded.slice(0));
      } catch {
        this.themeBuffer = null;
      }
    }
    this.startTheme();
  }

  /** True when this build actually shipped a theme to play. */
  get hasTheme(): boolean {
    return this.themeBuffer !== null || this.themeEncoded !== null;
  }

  private startTheme(): void {
    if (!this.context || !this.music || !this.themeBuffer || this.theme) return;
    const source = this.context.createBufferSource();
    source.buffer = this.themeBuffer;
    source.loop = true;
    source.connect(this.music);
    source.start();
    this.theme = source;
  }

  setMusicVolume(value: number): void {
    this.musicVolume = Math.max(0, Math.min(1, value));
    if (this.music) this.music.gain.value = this.musicVolume;
  }

  setEffects(on: boolean): void {
    this.effects = on;
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if (this.master) this.master.gain.value = value ? 0 : this.volume;
  }

  play(cue: string, options: PlayOptions = {}): void {
    if (this.muted || !this.context || !this.master) return;
    if (!this.effects && !INTERFACE_CUES.has(cue)) return;
    if (document.visibilityState === 'hidden') return;

    const buffers = this.decoded.get(cue);
    if (!buffers || buffers.length === 0) return;

    const now = this.context.currentTime;
    const gap = GAP[cue] ?? DEFAULT_GAP;
    if (now - (this.lastPlayed.get(cue) ?? -Infinity) < gap) return;

    this.recent = this.recent.filter((time) => now - time < 1);
    if (this.recent.length >= MAX_PER_SECOND) return;

    const buffer = buffers[Math.floor(Math.random() * buffers.length)];
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.rate ?? 0.94 + Math.random() * 0.12;

    const gain = this.context.createGain();
    gain.gain.value = options.gain ?? 1;
    source.connect(gain);
    gain.connect(this.master);
    source.start();

    this.lastPlayed.set(cue, now);
    this.recent.push(now);
  }
}

export const sound = new Mixer();

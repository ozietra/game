import {
  ACHIEVEMENTS,
  ALL_FOES,
  BALANCE,
  DEEP,
  ECHOES,
  ECHO_EFFECT,
  ECHO_ORDER,
  BUILDINGS,
  BUILDING_EFFECT,
  BUILDING_ORDER,
  CONTRACTS,
  EVENTS,
  EVENT_SECONDS,
  FOE_ORDER,
  HEROES,
  HERO_ORDER,
  MILESTONE,
  RARITIES,
  RARITY_ORDER,
  RELICS,
  RELIC_EFFECT,
  RELIC_ORDER,
  RISK,
  SLOTS,
  contractReward,
  zoneForFloor,
  type ContractId,
} from '../data/content';
import type { Game, Harvest } from '../core/game';
import {
  echoYield,
  heroLook,
  itemGain,
  masteryCost,
  heroStats,
  maxStartFloor,
  partyOf,
  relicYield,
  setsWorn,
  xpForLevel,
} from '../core/stats';
import type { BuildingId, DiveReport, Hero, Item, RarityId, RelicId } from '../core/types';
import { clearSave, writeSave } from '../core/save';
import { formatDuration, formatNumber, formatPercent, setLanguage, t, type StringKey } from '../i18n';
import { metrics } from '../net/telemetry';
import { fetchBoard, ladderAvailable, myId, submitScore, type BoardScope } from '../net/leaderboard';
import { sound } from './audio';
import { icon, portraitStyle, preload, spriteMeta } from './assets';
import { clear, el, on, setText, setWidth } from './dom';
import { Menu } from './menu';
import { Scene, type AttackStyle } from './scene';

type TabId = 'shaft' | 'roster' | 'camp' | 'relics' | 'records';

const TAB_ICONS: Record<TabId, string> = {
  shaft: 'descend',
  roster: 'swords',
  camp: 'camp',
  relics: 'relic',
  records: 'ledger',
};

export class App {
  private readonly game: Game;
  private readonly root: HTMLElement;
  private scene!: Scene;
  private tab: TabId = 'shaft';
  private refs = new Map<string, HTMLElement>();
  private lastFrame = performance.now();
  private carry = 0;
  private saveTimer = 0;
  private panelTimer = 0;
  private panelState = new Map<TabId, string>();
  private stashFilter: RarityId | 'all' = 'all';
  private floatSeen = 0;
  private view: 'menu' | 'game' = 'menu';
  private menu!: Menu;
  private lastPhase = '';
  private lastLogId = 0;
  private boardScope: BoardScope = 'week';

  constructor(game: Game, root: HTMLElement) {
    this.game = game;
    this.root = root;
  }

  async start(): Promise<void> {
    metrics.begin(this.game.state);
    setLanguage(this.game.state.language);
    sound.setVolume(this.game.state.audio.volume);
    sound.setMuted(this.game.state.audio.muted);
    sound.setEffects(this.game.state.audio.effects !== false);
    sound.setMusicVolume(this.game.state.audio.music ?? 0.35);
    void sound.load();

    this.menu = new Menu(
      this.game,
      this.root,
      () => this.enterGame(),
      () => {
        clearSave();
        window.location.reload();
      },
    );
    this.showMenu();
    await preload();

    const away = (Date.now() - this.game.state.lastSeen) / 1000;
    if (away > 60) {
      const harvest = this.game.catchUp(away);
      if (harvest.seconds > 60) this.showHarvest(harvest);
    }

    // Audio may only start from a gesture, and any click counts.
    const wake = () => void sound.unlock();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });

    window.addEventListener('resize', () => {
      if (this.view === 'game') this.scene.resize(this.ref('stage'));
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') writeSave(this.game.state);
    });
    window.addEventListener('beforeunload', () => writeSave(this.game.state));

    // Preloading takes time the shaft has already been credited for, so the
    // clock starts here rather than when the object was built.
    this.lastFrame = performance.now();
    requestAnimationFrame(() => this.frame());
  }

  // ------------------------------------------------------------------ views

  private showMenu(): void {
    this.view = 'menu';
    this.refs.clear();
    clear(this.root);
    this.menu.render();
  }

  private enterGame(): void {
    void sound.unlock();
    this.view = 'game';
    this.build();
    if (!this.game.state.tutorialSeen) this.showIntro();
  }

  // ------------------------------------------------------------------ shell

  private ref(name: string): HTMLElement {
    const node = this.refs.get(name);
    if (!node) throw new Error(`missing element: ${name}`);
    return node;
  }

  private keep(name: string, node: HTMLElement): HTMLElement {
    this.refs.set(name, node);
    return node;
  }

  private build(): void {
    clear(this.root);
    this.refs.clear();

    const brand = el('div', { class: 'brand' }, [
      el('h1', { class: 'brand-name', text: t('app.title') }),
      this.keep('subtitle', el('p', { class: 'brand-line', text: t('app.subtitle') })),
    ]);

    const purse = this.keep('purse', el('div', { class: 'purse' }));
    const toMenu = el('button', {
      class: 'button tiny',
      type: 'button',
      html: `${icon('ledger')}<span>${t('menu.open')}</span>`,
    });
    on(toMenu, 'click', () => {
      sound.play('click', { gain: 0.5 });
      writeSave(this.game.state);
      this.showMenu();
    });
    const header = el('header', { class: 'topbar' }, [brand, el('div', { class: 'topbar-right' }, [purse, toMenu])]);

    const tabs = el(
      'nav',
      { class: 'tabs' },
      (Object.keys(TAB_ICONS) as TabId[]).map((id) => {
        const button = el('button', {
          class: `tab${id === this.tab ? ' is-active' : ''}`,
          type: 'button',
          'data-tab': id,
          html: `${icon(TAB_ICONS[id])}<span>${t(`tab.${id}` as StringKey)}</span>`,
        });
        on(button, 'click', () => {
          sound.play('click', { gain: 0.4 });
          this.selectTab(id);
        });
        this.keep(`tab:${id}`, button);
        return button;
      }),
    );

    const panels = el('main', { class: 'panels' }, [
      this.keep('panel:shaft', this.buildShaft()),
      this.keep('panel:roster', el('section', { class: 'panel', hidden: true })),
      this.keep('panel:camp', el('section', { class: 'panel', hidden: true })),
      this.keep('panel:relics', el('section', { class: 'panel', hidden: true })),
      this.keep('panel:records', el('section', { class: 'panel', hidden: true })),
    ]);

    this.root.append(el('div', { class: 'frame' }, [header, tabs, panels]));
    this.renderPurse();
    this.scene.resize(this.ref('stage'));
  }

  private buildShaft(): HTMLElement {
    const canvas = el('canvas', { class: 'scene', width: 512, height: 288 });
    this.scene = new Scene(canvas);
    const floats = this.keep('floats', el('div', { class: 'floats' }));
    const stage = this.keep('stage', el('div', { class: 'stage' }, [canvas, floats]));

    const status = el('div', { class: 'status' }, [
      el('div', { class: 'status-block' }, [
        el('span', { class: 'label', text: t('shaft.depth') }),
        this.keep('depth', el('strong', { class: 'readout', text: '-' })),
      ]),
      el('div', { class: 'status-block' }, [
        this.keep('zoneName', el('span', { class: 'zone-name', text: '' })),
        this.keep('zoneLine', el('span', { class: 'zone-line', text: '' })),
        this.keep('boonLine', el('span', { class: 'boon-line', text: '' })),
      ]),
      el('div', { class: 'status-block right' }, [
        this.keep('phase', el('strong', { class: 'phase', text: '' })),
        this.keep('phaseNote', el('span', { class: 'muted', text: '' })),
      ]),
    ]);

    const dive = el('button', { class: 'button primary', type: 'button', html: `${icon('descend')}<span>${t('action.dive')}</span>` });
    on(dive, 'click', () => {
      sound.play('click', { gain: 0.5 });
      this.game.beginDive(true);
    });
    const back = el('button', { class: 'button', type: 'button', html: `${icon('ascend')}<span>${t('action.extract')}</span>` });
    on(back, 'click', () => {
      sound.play('click', { gain: 0.5 });
      this.game.extract();
    });
    this.keep('diveButton', dive);
    this.keep('backButton', back);

    const controls = el('div', { class: 'controls' }, [dive, back]);

    const satchel = this.keep('satchel', el('div', { class: 'satchel-body' }));
    const satchelCard = el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', html: `${icon('satchel')}<span>${t('shaft.satchel')}</span>` }),
      satchel,
      el('p', { class: 'note', text: t('shaft.satchelNote') }),
    ]);

    const orders = this.buildOrders();
    const party = this.keep('partyList', el('div', { class: 'party-list' }));
    const partyCard = el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', html: `${icon('swords')}<span>${t('shaft.party')}</span>` }),
      party,
    ]);

    const log = this.keep('log', el('ol', { class: 'log' }));
    const prompt = this.keep('eventBox', el('div', { class: 'event-box', hidden: true }));

    // The contracts and the dive summary live under Records. This column is
    // for what the party is doing right now, and it was getting long enough
    // that the standing orders fell off the bottom of the screen.
    return el('section', { class: 'panel shaft' }, [
      el('div', { class: 'shaft-main' }, [
        stage,
        status,
        prompt,
        controls,
        el('div', { class: 'card log-card' }, [log]),
      ]),
      el('div', { class: 'shaft-side' }, [partyCard, satchelCard, orders]),
    ]);
  }

  private buildOrders(): HTMLElement {
    const state = this.game.state;

    const auto = this.keep('autoDive', el('input', { type: 'checkbox', id: 'auto-dive' }));
    (auto as HTMLInputElement).checked = state.policy.autoDive;
    on(auto, 'change', () => {
      state.policy.autoDive = (auto as HTMLInputElement).checked;
    });

    const start = el('input', { type: 'number', min: 1, max: 9999, step: 1, class: 'field', id: 'start-floor' });
    (start as HTMLInputElement).value = String(state.policy.startFloor);
    on(start, 'change', () => {
      const value = Number((start as HTMLInputElement).value);
      state.policy.startFloor = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
      this.refreshOrders();
    });
    this.keep('startFloor', start);
    const startHint = this.keep('startHint', el('span', { class: 'readout small', text: '' }));

    const target = el('input', { type: 'number', min: 1, max: 9999, step: 1, class: 'field', id: 'target-floor' });
    (target as HTMLInputElement).value = String(state.policy.targetFloor);
    on(target, 'change', () => {
      const value = Number((target as HTMLInputElement).value);
      state.policy.targetFloor = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 1;
    });

    const retreat = el('input', { type: 'range', min: 0, max: 90, step: 5, class: 'slider', id: 'retreat-health' });
    (retreat as HTMLInputElement).value = String(Math.round(state.policy.retreatHealth * 100));
    const retreatValue = this.keep('retreatValue', el('span', { class: 'readout small', text: formatPercent(state.policy.retreatHealth) }));
    on(retreat, 'input', () => {
      state.policy.retreatHealth = Number((retreat as HTMLInputElement).value) / 100;
      setText(retreatValue, formatPercent(state.policy.retreatHealth));
    });

    const limit = el('input', { type: 'number', min: 0, step: 100, class: 'field', id: 'satchel-limit' });
    (limit as HTMLInputElement).value = String(state.policy.satchelLimit);
    on(limit, 'change', () => {
      const value = Number((limit as HTMLInputElement).value);
      state.policy.satchelLimit = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    });

    const risk = el('input', { type: 'range', min: 0, max: RISK.steps, step: 1, class: 'slider', id: 'risk-dial' });
    (risk as HTMLInputElement).value = String(state.policy.risk);
    const riskValue = this.keep('riskValue', el('span', { class: 'readout small', text: String(state.policy.risk) }));
    const riskNote = this.keep('riskNote', el('p', { class: 'note', text: '' }));
    const showRisk = () => {
      const step = state.policy.risk;
      setText(riskValue, String(step));
      setText(
        riskNote,
        t('policy.riskReadout', {
          foe: formatPercent(step * RISK.foe),
          loot: formatPercent(step * RISK.loot),
        }),
      );
    };
    on(risk, 'input', () => {
      state.policy.risk = Number((risk as HTMLInputElement).value);
      showRisk();
    });
    showRisk();

    const events = el('div', { class: 'lang-switch' });
    const choices: [typeof state.policy.eventChoice, StringKey][] = [
      ['ask', 'policy.eventAsk'],
      ['bold', 'policy.eventBold'],
      ['safe', 'policy.eventSafe'],
    ];
    for (const [value, label] of choices) {
      const button = el('button', {
        class: `button tiny${state.policy.eventChoice === value ? ' primary' : ''}`,
        type: 'button',
        'data-choice': value,
        text: t(label),
      });
      on(button, 'click', () => {
        sound.play('click', { gain: 0.4 });
        state.policy.eventChoice = value;
        for (const other of Array.from(events.children)) {
          other.classList.toggle('primary', (other as HTMLElement).dataset.choice === value);
        }
      });
      events.append(button);
    }

    return el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', html: `${icon('gear')}<span>${t('policy.title')}</span>` }),
      el('label', { class: 'row toggle', for: 'auto-dive' }, [auto, el('span', { text: t('action.autoDive') })]),
      el('label', { class: 'row', for: 'start-floor' }, [el('span', { text: t('policy.start') }), startHint, start]),
      el('label', { class: 'row', for: 'target-floor' }, [el('span', { text: t('policy.target') }), target]),
      el('label', { class: 'row', for: 'retreat-health' }, [el('span', { text: t('policy.retreat') }), retreat, retreatValue]),
      el('label', { class: 'row', for: 'satchel-limit' }, [el('span', { text: t('policy.satchel') }), limit]),
      el('p', { class: 'note', text: t('policy.note') }),
      el('h3', { class: 'card-sub', text: t('policy.risk') }),
      el('label', { class: 'row', for: 'risk-dial' }, [el('span', { text: t('dive.risk') }), risk, riskValue]),
      riskNote,
      el('p', { class: 'note', text: t('policy.riskNote') }),
      el('h3', { class: 'card-sub', text: t('policy.event') }),
      events,
      el('p', { class: 'note', text: t('policy.eventNote', { seconds: EVENT_SECONDS }) }),
    ]);
  }

  /**
   * A dot on the Records tab when a contract is finished and waiting. Moving
   * the contracts off the shaft screen only works if there is still something
   * telling the player to go and look.
   */
  private markClaimable(): void {
    const tab = this.refs.get('tab:records');
    if (!tab) return;
    const waiting = this.game.state.contracts.goals.some((goal) => !goal.claimed && goal.progress >= goal.target);
    tab.classList.toggle('has-claim', waiting);
  }

  // -------------------------------------------------------- floor events

  /** The one moment the game stops and asks. It never waits forever. */
  private renderEvent(): void {
    const box = this.ref('eventBox');
    const run = this.game.run;
    const event = run.phase === 'event' ? run.event : null;

    if (!event) {
      if (!box.hidden) {
        box.hidden = true;
        clear(box);
        box.dataset.id = '';
      }
      return;
    }

    if (box.dataset.id !== `${event.id}:${event.floor}`) {
      box.dataset.id = `${event.id}:${event.floor}`;
      box.hidden = false;
      clear(box);
      sound.play('gate', { gain: 0.6 });

      const shape = EVENTS[event.id as keyof typeof EVENTS];
      const clock = this.keep('eventClock', el('strong', { class: 'readout small', text: '' }));

      const choice = (kind: 'bold' | 'safe', glyph: string) => {
        const button = el('button', {
          class: `button${kind === 'bold' ? ' primary' : ''}`,
          type: 'button',
          html: `${icon(glyph)}<span>${t(`event.${event.id}.${kind}` as StringKey)}</span>`,
        });
        on(button, 'click', () => {
          sound.play('click', { gain: 0.5 });
          this.game.answerEvent(kind);
          this.renderEvent();
        });
        return el('div', { class: 'event-choice' }, [
          button,
          el('span', { class: 'note', text: t(`event.${event.id}.${kind}Note` as StringKey) }),
        ]);
      };

      box.append(
        el('div', { class: 'event-head' }, [
          el('span', { class: 'event-icon', html: icon(shape.icon) }),
          el('div', {}, [
            el('h2', { class: 'event-title', text: t(`event.${event.id}.name` as StringKey) }),
            el('p', { class: 'event-line', text: t(`event.${event.id}.line` as StringKey) }),
          ]),
          el('div', { class: 'event-clock' }, [el('span', { class: 'label', text: t('event.wait') }), clock]),
        ]),
        el('div', { class: 'event-choices' }, [choice('bold', shape.bold), choice('safe', shape.safe)]),
      );
    }

    setText(this.refs.get('eventClock') ?? null, `${Math.max(0, Math.ceil(event.timer))}`);
  }

  // ---------------------------------------------------------- contracts

  private renderContracts(): void {
    const card = this.refs.get('contractCard');
    if (!card) return;
    const contracts = this.game.state.contracts;
    const signature = `${contracts.day}|${contracts.goals
      .map((goal) => `${goal.id}:${goal.progress}/${goal.target}:${goal.claimed ? 1 : 0}`)
      .join('|')}|${contracts.streak}`;
    if (card.dataset.signature === signature) return;
    card.dataset.signature = signature;

    clear(card);
    const deepest = Math.max(1, this.game.state.deepestBanked, this.game.state.deepestFloor);

    card.append(
      el('h2', { class: 'card-title', html: `${icon('ledger')}<span>${t('contract.title')}</span>` }),
      el('p', { class: 'note' }, [
        document.createTextNode(`${t('contract.streak')}: `),
        el('strong', { class: 'readout small', text: String(contracts.streak) }),
        document.createTextNode(`  ·  ${t('contract.best')}: `),
        el('strong', { class: 'readout small', text: String(contracts.best) }),
      ]),
    );

    for (const goal of contracts.goals) {
      const shape = CONTRACTS[goal.id as ContractId];
      const done = goal.progress >= goal.target;
      const reward = contractReward(goal.id as ContractId, deepest);

      const bar = el('span', { class: 'bar-fill' });
      bar.style.width = `${Math.min(100, (goal.progress / Math.max(1, goal.target)) * 100)}%`;

      const action = el('button', {
        class: `button tiny${done && !goal.claimed ? ' primary' : ''}`,
        type: 'button',
        disabled: !done || goal.claimed,
        text: goal.claimed ? t('contract.claimed') : t('contract.claim'),
      });
      on(action, 'click', () => {
        if (!this.game.claimContract(goal.id)) return;
        sound.play('coins', { gain: 0.7 });
        this.renderContracts();
        this.renderPurse();
      });

      card.append(
        el('div', { class: `contract${goal.claimed ? ' is-done' : ''}` }, [
          el('div', { class: 'contract-head' }, [
            el('span', { class: 'contract-icon', html: icon(shape?.icon ?? 'ledger') }),
            el('div', { class: 'contract-body' }, [
              el('span', { class: 'contract-name', text: t(`contract.${goal.id}.name` as StringKey) }),
              el('span', {
                class: 'contract-line',
                text: t(`contract.${goal.id}.line` as StringKey, { target: formatNumber(goal.target) }),
              }),
            ]),
            action,
          ]),
          el('div', { class: 'bar' }, [bar]),
          el('span', { class: 'contract-meta' }, [
            document.createTextNode(`${formatNumber(goal.progress)} / ${formatNumber(goal.target)}`),
            document.createTextNode(`  ·  ${t('contract.reward')}: ${formatNumber(reward.coin)} `),
            document.createTextNode(`${t('res.coin')}, ${formatNumber(reward.iron)} ${t('res.iron')}`),
          ]),
        ]),
      );
    }
  }

  // --------------------------------------------------------- dive summary

  private diveRows(report: DiveReport): [string, string][] {
    const rows: [string, string][] = [
      [t('dive.deepest'), String(report.deepest)],
      [t('dive.floors'), String(report.floors)],
      [t('dive.fights'), String(report.fights)],
      [t('dive.time'), formatDuration(report.seconds)],
      [t('res.coin'), formatNumber(report.coin)],
      [t('res.iron'), formatNumber(report.iron)],
    ];
    if (report.crystal > 0) rows.push([t('res.crystal'), formatNumber(report.crystal)]);
    if (report.items > 0) rows.push([t('offline.items'), String(report.items)]);
    if (report.hardest > 0) {
      const by = report.hardestBy ? t(`hero.${report.hardestBy}.name` as StringKey) : '';
      rows.push([t('dive.hardest'), `${formatNumber(report.hardest)}${by ? ` · ${by}` : ''}`]);
    }
    if (report.risk > 0) rows.push([t('dive.risk'), String(report.risk)]);
    if (report.wiped) rows.push([t('dive.lost'), formatNumber(report.lost)]);
    return rows;
  }

  private renderLastDive(): void {
    const card = this.refs.get('lastDiveCard');
    if (!card) return;
    const report = this.game.state.lastDive;
    if (!report) {
      card.hidden = true;
      return;
    }
    const signature = `${report.at}:${report.deepest}:${report.coin}:${report.wiped ? 1 : 0}`;
    if (card.dataset.signature === signature) return;
    card.dataset.signature = signature;
    card.hidden = false;

    clear(card);
    card.append(
      el('h2', { class: 'card-title' }, [
        el('span', { html: icon(report.wiped ? 'grave' : 'ascend') }),
        el('span', { text: t('dive.last') }),
        el('span', { class: `tagline ${report.wiped ? 'bad' : 'good'}`, text: report.wiped ? t('dive.wiped') : t('dive.returned') }),
      ]),
      el(
        'div',
        { class: 'record-grid tight' },
        this.diveRows(report).map(([label, value]) =>
          el('div', { class: 'record' }, [
            el('span', { class: 'label', text: label }),
            el('strong', { class: 'readout', text: value }),
          ]),
        ),
      ),
    );
  }

  /** Keeps the start-floor order inside what the party has actually unlocked. */
  private refreshOrders(): void {
    const state = this.game.state;
    const allowed = maxStartFloor(state);
    state.policy.startFloor = Math.max(1, Math.min(state.policy.startFloor, allowed));
    const auto = this.refs.get('autoDive') as HTMLInputElement | undefined;
    if (auto && auto.checked !== state.policy.autoDive) auto.checked = state.policy.autoDive;

    const field = this.refs.get('startFloor') as HTMLInputElement | undefined;
    if (field) {
      field.max = String(allowed);
      if (document.activeElement !== field) field.value = String(state.policy.startFloor);
    }
    setText(this.refs.get('startHint') ?? null, `${t('policy.upTo')} ${allowed}`);
  }

  // ------------------------------------------------------------------- loop

  private frame(): void {
    const now = performance.now();
    const real = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    // A hidden tab stops getting frames and a sleeping machine stops entirely,
    // so anything past a couple of seconds is a stall, not a slow frame.
    // Stepping it one frame at a time would throw the missing time away, which
    // is exactly the wrong answer for a game that is supposed to run on its
    // own: it is replayed instead, the same way a closed tab is.
    if (real > 2) {
      const harvest = this.game.catchUp(real);
      this.carry = 0;
      this.game.events.length = 0;
      this.lastLogId = this.game.log[0]?.id ?? this.lastLogId;
      this.lastPhase = this.game.run.phase;
      if (this.view === 'game' && harvest.seconds > 180) this.showHarvest(harvest);
      writeSave(this.game.state);
      requestAnimationFrame(() => this.frame());
      return;
    }

    const elapsed = Math.min(0.5, real);
    this.carry += elapsed;
    const step = BALANCE.tickSeconds;
    let steps = 0;
    while (this.carry >= step && steps < 12) {
      this.game.tick(step);
      this.carry -= step;
      steps += 1;
    }

    this.cuesForPhase();
    metrics.tick(elapsed, Math.max(this.game.run.floor, this.game.state.deepestFloor));

    if (this.view === 'game') {
      this.scene.render(this.game.state, elapsed);
      this.spawnFloats();
      this.renderPurse();
      this.renderShaft();

      if (this.tab === 'roster') this.refreshExperience();
      if (this.tab === 'records') {
        // Both update in place and cost nothing when nothing has changed, so
        // watching a contract fill up does not rebuild the panel under it.
        this.renderContracts();
        this.renderLastDive();
      }
      this.markClaimable();

      this.panelTimer += elapsed;
      if (this.panelTimer > 0.4) {
        this.panelTimer = 0;
        if (this.tab !== 'shaft') this.renderPanel(this.tab);
      }
    } else {
      this.game.events.length = 0;
      this.lastLogId = this.game.log[0]?.id ?? this.lastLogId;
    }

    this.saveTimer += elapsed;
    if (this.saveTimer > 10) {
      this.saveTimer = 0;
      writeSave(this.game.state);
    }

    requestAnimationFrame(() => this.frame());
  }

  // ----------------------------------------------------------------- sound

  /** One cue per phase change, and one per fresh line in the log. */
  private cuesForPhase(): void {
    const phase = this.game.run.phase;
    if (phase !== this.lastPhase) {
      if (this.lastPhase === 'descending' && phase === 'fighting') sound.play('draw', { gain: 0.5 });
      if (phase === 'descending') sound.play('step', { gain: 0.45 });
      if (this.lastPhase === 'camp' && phase === 'descending') metrics.mark('dive', this.game.run.floor);
      if (phase === 'climbing') metrics.mark('extract', this.game.run.floor);
      if (phase === 'wiped') metrics.mark('wipe', this.game.run.floor);
      this.lastPhase = phase;
    }

    const newest = this.game.log[0];
    if (!newest || newest.id === this.lastLogId) return;
    const fresh = this.game.log.filter((entry) => entry.id > this.lastLogId);
    this.lastLogId = newest.id;

    const cues: Record<string, { cue: string; gain: number }> = {
      'log.dive.start': { cue: 'gate', gain: 0.7 },
      'log.climb.start': { cue: 'rope', gain: 0.7 },
      'log.bank': { cue: 'coins', gain: 0.8 },
      'log.wipe': { cue: 'rout', gain: 0.9 },
      'log.loot.item': { cue: 'loot', gain: 0.6 },
      'log.level': { cue: 'rank', gain: 0.7 },
      'log.boss': { cue: 'keeper', gain: 0.9 },
    };

    // Oldest first, so a burst of lines still plays in the order they happened.
    for (const entry of fresh.reverse()) {
      const cue = cues[entry.key];
      if (cue) sound.play(cue.cue, { gain: cue.gain });
    }
  }

  // ------------------------------------------------------------------ shaft

  private renderPurse(): void {
    const purse = this.ref('purse');
    const bank = this.game.state.bank;
    const entries: [string, number, string][] = [
      ['coin', bank.coin, 'coin'],
      ['iron', bank.iron, 'ingot'],
      ['crystal', bank.crystal, 'crystal'],
      ['relic', bank.relic, 'relic'],
    ];
    // Echoes only exist once a shaft has been given up entirely, so the chip
    // stays out of the way until there is something to put in it.
    const state = this.game.state;
    if (bank.echo > 0 || state.deepPrestiges > 0 || Object.values(state.echoes ?? {}).some((rank) => rank > 0)) {
      entries.push(['echo', bank.echo, 'stone']);
    }

    if (purse.childElementCount !== entries.length) {
      clear(purse);
      for (const [id, , glyph] of entries) {
        const value = el('strong', { class: 'chip-value', text: '0' });
        this.keep(`purse:${id}`, value);
        purse.append(
          el('div', { class: 'chip', title: t(`res.${id}` as StringKey) }, [
            el('span', { class: 'chip-icon', html: icon(glyph) }),
            value,
          ]),
        );
      }
    }
    for (const [id, amount] of entries) setText(this.refs.get(`purse:${id}`) ?? null, formatNumber(amount));
  }

  private renderShaft(): void {
    const state = this.game.state;
    const run = state.run;
    const inShaft = run.phase !== 'camp' && run.phase !== 'wiped';
    const zone = zoneForFloor(Math.max(1, run.floor));

    setText(this.ref('depth'), inShaft ? String(run.floor) : '-');
    setText(this.ref('zoneName'), t(`zone.${zone.id}.name` as StringKey));
    setText(this.ref('zoneLine'), t(`zone.${zone.id}.line` as StringKey));
    setText(this.ref('phase'), t(`phase.${run.phase}` as StringKey));

    let note = '';
    if (run.phase === 'camp') note = t('shaft.idle');
    else if (run.manual && (run.phase === 'descending' || run.phase === 'fighting' || run.phase === 'looting'))
      note = t('shaft.manual');
    else if (run.phase === 'wiped') note = t('shaft.wiped');
    else if (run.phase === 'fighting') note = `${t('shaft.foes')}: ${run.foes.filter((foe) => foe.alive).length}`;
    else if (run.phase === 'climbing') note = `${Math.max(0, Math.ceil(run.phaseTimer))}s`;
    setText(this.ref('phaseNote'), note);

    const boon = run.boon;
    setText(
      this.ref('boonLine'),
      boon
        ? t(`boon.${boon.kind}` as StringKey, { power: formatPercent(boon.power), floors: boon.floorsLeft })
        : '',
    );

    (this.ref('diveButton') as HTMLButtonElement).disabled = run.phase !== 'camp';
    (this.ref('backButton') as HTMLButtonElement).disabled = !inShaft || run.phase === 'climbing';

    this.refreshOrders();
    this.renderEvent();
    this.renderSatchel();
    this.renderParty();
    this.renderLog();
  }

  private renderSatchel(): void {
    const node = this.ref('satchel');
    const satchel = this.game.run.satchel;
    const rows: [string, string, number][] = [
      ['coin', 'coin', satchel.coin],
      ['iron', 'ingot', satchel.iron],
      ['crystal', 'crystal', satchel.crystal],
    ];
    const empty = satchel.coin === 0 && satchel.iron === 0 && satchel.crystal === 0 && satchel.items.length === 0;

    if (node.dataset.mode !== (empty ? 'empty' : 'full')) {
      clear(node);
      node.dataset.mode = empty ? 'empty' : 'full';
      if (empty) {
        node.append(el('p', { class: 'muted', text: t('shaft.satchelEmpty') }));
      } else {
        for (const [id, glyph] of rows) {
          const value = el('strong', { class: 'readout', text: '0' });
          this.keep(`satchel:${id}`, value);
          node.append(
            el('div', { class: 'satchel-row' }, [
              el('span', { class: 'satchel-icon', html: icon(glyph) }),
              el('span', { class: 'satchel-label', text: t(`res.${id}` as StringKey) }),
              value,
            ]),
          );
        }
        const gear = el('strong', { class: 'readout', text: '0' });
        this.keep('satchel:items', gear);
        node.append(
          el('div', { class: 'satchel-row' }, [
            el('span', { class: 'satchel-icon', html: icon('gear') }),
            el('span', { class: 'satchel-label', text: t('offline.items') }),
            gear,
          ]),
        );
      }
    }

    if (!empty) {
      for (const [id, , amount] of rows) setText(this.refs.get(`satchel:${id}`) ?? null, formatNumber(amount));
      setText(this.refs.get('satchel:items') ?? null, String(satchel.items.length));
    }
  }

  private renderParty(): void {
    const list = this.ref('partyList');
    const heroes = partyOf(this.game.state);
    const fighters = new Map(this.game.run.party.map((one) => [one.hero, one]));

    if (list.childElementCount !== heroes.length) {
      clear(list);
      for (const hero of heroes) {
        const bar = el('span', { class: 'bar-fill' });
        const cooldown = el('span', { class: 'bar-fill cooldown' });
        this.keep(`party:${hero.id}:bar`, bar);
        this.keep(`party:${hero.id}:cd`, cooldown);
        const health = el('span', { class: 'party-health', text: '' });
        this.keep(`party:${hero.id}:hp`, health);
        list.append(
          el('div', { class: 'party-row' }, [
            el('span', { class: 'party-icon', html: icon(HEROES[hero.id].icon) }),
            el('div', { class: 'party-body' }, [
              el('div', { class: 'party-head' }, [
                el('span', { class: 'party-name', text: t(`hero.${hero.id}.name` as StringKey) }),
                health,
              ]),
              el('div', { class: 'bar' }, [bar]),
              el('div', { class: 'bar thin' }, [cooldown]),
            ]),
          ]),
        );
      }
    }

    for (const hero of heroes) {
      const fighter = fighters.get(hero.id);
      const stats = heroStats(this.game.state, hero);
      const hp = fighter ? fighter.hp : Math.round(hero.hp);
      setWidth(this.refs.get(`party:${hero.id}:bar`) ?? null, hp / stats.maxHp);
      setText(this.refs.get(`party:${hero.id}:hp`) ?? null, `${formatNumber(hp)} / ${formatNumber(stats.maxHp)}`);
      const ability = HEROES[hero.id].ability;
      const ready = fighter ? 1 - Math.max(0, fighter.abilityTimer) / ability.cooldown : 0;
      setWidth(this.refs.get(`party:${hero.id}:cd`) ?? null, ready);
    }
  }

  private renderLog(): void {
    const list = this.ref('log');
    const entries = this.game.log.slice(0, 24);
    if (list.dataset.top === String(entries[0]?.id ?? 0)) return;
    list.dataset.top = String(entries[0]?.id ?? 0);

    clear(list);
    for (const entry of entries) {
      list.append(
        el('li', { class: `log-line ${entry.tone}` }, [
          el('span', { class: 'log-text', text: t(entry.key as StringKey, entry.params) }),
        ]),
      );
    }
  }

  private spawnFloats(): void {
    const events = this.game.events;
    if (events.length === 0) return;
    const container = this.ref('floats');
    const scale = this.scene.currentScale();
    const spots = new Map(this.scene.positions().map((spot) => [spot.key, spot]));

    for (const event of events) {
      const onParty = event.key.startsWith('hero:');
      if (event.kind === 'hit' || event.kind === 'crit') {
        this.scene.flash(event.key);
        if (event.from) this.scene.spawnAttack(event.from, event.key, this.styleOf(event.from));
        // Ordinary blows land often, so only some of them are heard at all.
        if (event.kind === 'crit') sound.play('strike', { gain: 0.5 });
        else if (Math.random() < 0.5) sound.play(onParty ? 'thud' : 'strike', { gain: onParty ? 0.3 : 0.26 });
      } else if (event.kind === 'heal') {
        sound.play('leaf', { gain: 0.45 });
      }

      // A blow the ward eats never becomes a hit, so the swing still has to be
      // drawn from here or the fight looks like it stopped.
      if (event.kind === 'ward') {
        this.scene.flash(event.key);
        if (event.from) this.scene.spawnAttack(event.from, event.key, this.styleOf(event.from));
        else sound.play('rope', { gain: 0.55 });
      } else if (event.kind === 'rage') {
        sound.play('keeper', { gain: 0.8 });
      } else if (event.kind === 'summon') {
        sound.play('gate', { gain: 0.7 });
      }

      const spot = spots.get(event.key);
      if (!spot) continue;
      if (event.kind === 'guard' || event.kind === 'rage' || event.kind === 'summon') continue;
      const node = el('span', {
        class: `float ${event.kind}`,
        text: event.kind === 'heal' ? `+${formatNumber(event.amount)}` : formatNumber(event.amount),
      });
      node.style.left = `${spot.x * scale}px`;
      node.style.top = `${spot.y * scale}px`;
      node.style.setProperty('--drift', `${(this.floatSeen++ % 5) * 4 - 8}px`);
      container.append(node);
      window.setTimeout(() => node.remove(), 900);
    }
    events.length = 0;
  }

  /** Which effect a fighter throws, taken from the animation it attacks with. */
  private styleOf(key: string): AttackStyle {
    const sprite = key.startsWith('hero:') ? key.slice(5) : key.split(':')[2];
    const meta = spriteMeta(sprite);
    if (!meta) return 'melee';
    if (meta.attackKind === 'shoot') return 'shoot';
    if (meta.attackKind === 'cast') return sprite === 'magus' ? 'frost' : 'flame';
    return 'melee';
  }

  // ------------------------------------------------------------------ tabs

  private selectTab(id: TabId): void {
    this.tab = id;
    for (const key of Object.keys(TAB_ICONS) as TabId[]) {
      this.ref(`tab:${key}`).classList.toggle('is-active', key === id);
      (this.ref(`panel:${key}`) as HTMLElement).hidden = key !== id;
    }
    if (id !== 'shaft') this.renderPanel(id, true);
    else this.scene.resize(this.ref('stage'));
  }

  /** Experience ticks constantly, so it is written in place, never rebuilt. */
  private refreshExperience(): void {
    for (const hero of partyOf(this.game.state)) {
      setWidth(this.refs.get(`xp:${hero.id}`) ?? null, this.game.progressToNextLevel(hero));
      setText(
        this.refs.get(`xpText:${hero.id}`) ?? null,
        `${formatNumber(hero.xp)} / ${formatNumber(xpForLevel(hero.level))}`,
      );
    }
  }

  /** A cheap fingerprint of what a panel shows, so it only rebuilds on change. */
  private panelSignature(id: TabId): string {
    const state = this.game.state;
    const purse = `${Math.round(state.bank.coin)}/${Math.round(state.bank.iron)}/${Math.round(state.bank.crystal)}/${state.bank.relic}`;
    if (id === 'roster') {
      const heroes = HERO_ORDER.map((hero) => {
        const one = state.heroes[hero];
        const gear = SLOTS.map((slot) => one.gear[slot]?.uid ?? 0).join('.');
        return `${one.unlocked ? 1 : 0}${one.level}:${one.mastery}:${one.wounds}:${gear}`;
      }).join('|');
      return `${purse}|${heroes}|${this.stashFilter}|${state.stash.map((item) => item.uid).join('.')}`;
    }
    if (id === 'camp') return `${purse}|${Object.values(state.buildings).join('.')}|${this.game.mendCost()}`;
    if (id === 'relics') {
      return `${purse}|${state.bank.echo}|${Object.values(state.relics).join('.')}|${Object.values(
        state.echoes ?? {},
      ).join('.')}|${relicYield(state)}|${echoYield(state)}`;
    }
    if (id === 'records') {
      // Kill counts tick up constantly and nothing on this panel needs to
      // follow them that closely. Rebuilding on every one of them threw away
      // whatever was half typed into the ladder field.
      const kinds = Object.values(state.bestiary).filter((count) => count > 0).length;
      return [
        Object.keys(state.achievements).length,
        kinds,
        state.milestones,
        state.lastDive?.at ?? 0,
        state.diveHistory.length,
      ].join('|');
    }
    return purse;
  }

  private renderPanel(id: TabId, force = false): void {
    const signature = this.panelSignature(id);
    if (!force && this.panelState.get(id) === signature) return;
    this.panelState.set(id, signature);

    // Rebuilding throws away the scroll position, so put it back afterwards.
    const scrollers = Array.from(this.ref(`panel:${id}`).querySelectorAll<HTMLElement>('.stash, .credit-list'));
    const offsets = scrollers.map((node) => node.scrollTop);

    switch (id) {
      case 'roster':
        this.renderRoster();
        break;
      case 'camp':
        this.renderCamp();
        break;
      case 'relics':
        this.renderRelics();
        break;
      case 'records':
        this.renderRecords();
        break;
      default:
        break;
    }

    const restored = Array.from(this.ref(`panel:${id}`).querySelectorAll<HTMLElement>('.stash, .credit-list'));
    restored.forEach((node, index) => {
      const offset = offsets[index];
      if (offset) node.scrollTop = offset;
    });
  }

  private renderRoster(): void {
    const panel = this.ref('panel:roster');
    const state = this.game.state;
    clear(panel);

    const cards = el('div', { class: 'grid' });
    for (const id of HERO_ORDER) {
      const hero = state.heroes[id];
      const definition = HEROES[id];
      const stats = heroStats(state, hero);

      const header = el('div', { class: 'hero-head' }, [
        el('span', { class: 'portrait', style: portraitStyle(heroLook(hero).sprite) }),
        el('div', {}, [
          el('h3', { class: 'hero-name', text: t(`hero.${id}.name` as StringKey) }),
          el('p', { class: 'note', text: t(`hero.${id}.line` as StringKey) }),
        ]),
      ]);

      const body: HTMLElement[] = [];
      if (!hero.unlocked) {
        const hire = el('button', {
          class: 'button',
          type: 'button',
          disabled: state.bank.coin < definition.cost,
          html: `${icon('coin')}<span>${t('action.recruit')} · ${formatNumber(definition.cost)}</span>`,
        });
        on(hire, 'click', () => {
          sound.play('buy', { gain: 0.8 });
          this.game.recruit(id);
          this.renderPanel('roster', true);
        });
        body.push(el('p', { class: 'muted', text: t('roster.locked') }), hire);
      } else {
        const training = masteryCost(hero);
        const train = el('button', {
          class: 'button',
          type: 'button',
          disabled: state.bank.coin < training.coin || state.bank.iron < training.iron,
          html: `${icon('upgrade')}<span>${t('action.train')} · ${formatNumber(training.coin)} ${t('res.coin')} · ${formatNumber(training.iron)} ${t('res.iron')}</span>`,
        });
        on(train, 'click', () => {
          sound.play('buy', { gain: 0.8 });
          this.game.train(id);
          this.renderPanel('roster', true);
        });

        const xpBar = this.keep(`xp:${id}`, el('span', { class: 'bar-fill' }));
        xpBar.style.width = `${this.game.progressToNextLevel(hero) * 100}%`;
        const xpText = this.keep(
          `xpText:${id}`,
          el('span', { class: 'muted', text: `${formatNumber(hero.xp)} / ${formatNumber(xpForLevel(hero.level))}` }),
        );

        body.push(
          el('div', { class: 'stat-line' }, [
            el('span', { text: `${t('roster.level')} ${hero.level}` }),
            xpText,
          ]),
          el('div', { class: 'bar thin' }, [xpBar]),
          el('p', {
            class: 'stats',
            text: t('roster.stats', {
              hp: formatNumber(stats.maxHp),
              attack: formatNumber(stats.attack),
              defence: formatNumber(stats.defence),
              speed: stats.speed,
              crit: formatPercent(stats.crit),
            }),
          }),
          el('p', { class: 'note' }, [
            el('strong', { text: `${t(`ability.${id}.name` as StringKey)}: ` }),
            document.createTextNode(
              t(`ability.${id}.line` as StringKey, {
                value:
                  definition.ability.kind === 'bulwark' || definition.ability.kind === 'mend'
                    ? formatPercent(definition.ability.power)
                    : definition.ability.power.toFixed(1),
              }),
            ),
          ]),
          el('div', { class: 'gear-row' }, SLOTS.map((slot) => this.gearChip(hero.gear[slot], slot))),
          this.setLine(hero),
          el('div', { class: 'stat-line' }, [
            el('span', { text: `${t('roster.mastery')} ${hero.mastery}` }),
            el('span', { class: hero.wounds > 0 ? 'bad' : 'muted', text: `${t('roster.wounds')} ${hero.wounds}` }),
          ]),
          train,
        );
      }

      cards.append(el('article', { class: `card hero-card${hero.unlocked ? '' : ' locked'}` }, [header, ...body]));
    }

    const counts = new Map<RarityId, number>();
    for (const item of state.stash) counts.set(item.rarity, (counts.get(item.rarity) ?? 0) + 1);
    if (this.stashFilter !== 'all' && !counts.has(this.stashFilter)) this.stashFilter = 'all';

    const filters = el('div', { class: 'filter-row' });
    const options: (RarityId | 'all')[] = ['all', ...RARITY_ORDER];
    for (const option of options) {
      const count = option === 'all' ? state.stash.length : counts.get(option) ?? 0;
      const button = el('button', {
        class: `chip-button${this.stashFilter === option ? ' is-active' : ''}`,
        type: 'button',
        disabled: count === 0 && option !== 'all',
        text: `${option === 'all' ? t('roster.filterAll') : t(`rarity.${option}` as StringKey)} ${count}`,
      });
      if (option !== 'all') button.style.setProperty('--rarity', RARITIES[option].shade);
      on(button, 'click', () => {
        sound.play('click', { gain: 0.4 });
        this.stashFilter = option;
        this.renderPanel('roster', true);
      });
      filters.append(button);
    }

    const shown = state.stash
      .filter((item) => this.stashFilter === 'all' || item.rarity === this.stashFilter)
      .sort((a, b) => b.power - a.power);

    const stash = el('div', { class: 'stash' });
    if (shown.length === 0) {
      stash.append(el('p', { class: 'muted', text: t('roster.stashEmpty') }));
    } else {
      for (const item of shown) stash.append(this.stashRow(item));
    }

    const scrapTotal = shown.reduce((sum, item) => sum + this.game.scrapValue(item), 0);
    const label = this.stashFilter === 'all' ? t('action.scrapAll') : t('action.scrapShown');
    const scrap = el('button', {
      class: 'button',
      type: 'button',
      disabled: shown.length === 0,
      html: `${icon('pick')}<span>${label} · ${formatNumber(scrapTotal)} ${t('res.iron')}</span>`,
    });
    on(scrap, 'click', () => {
      sound.play('buy', { gain: 0.6 });
      for (const item of shown) this.game.scrapItem(item.uid);
      this.renderPanel('roster', true);
    });

    panel.append(
      cards,
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', html: `${icon('hoard')}<span>${t('roster.stash')}</span>` }),
        filters,
        stash,
        scrap,
      ]),
    );
  }

  /** Plain reading of what a piece of gear is worth: "+128 attack, +0.4% crit". */
  private gearGainText(item: Item): string {
    const gain = itemGain(item);
    const parts: string[] = [];
    const add = (value: number | undefined, label: StringKey, percent = false) => {
      if (!value) return;
      const shown = percent ? formatPercent(Math.abs(value), 1) : formatNumber(Math.abs(Math.round(value)));
      parts.push(`${value < 0 ? '-' : '+'}${shown} ${t(label)}`);
    };
    add(gain.attack, 'stat.attack');
    add(gain.maxHp, 'stat.health');
    add(gain.defence, 'stat.defence');
    add(gain.speed, 'stat.speed');
    add(gain.crit, 'stat.crit', true);
    return parts.join('  ');
  }

  /** Which workshops a hero has pieces from, and which of them are paying. */
  private setLine(hero: Hero): HTMLElement {
    const worn = setsWorn(hero);
    if (worn.length === 0) return el('p', { class: 'note muted', text: t('set.none') });

    return el(
      'p',
      { class: 'note set-line' },
      worn.map((entry) =>
        el('span', {
          class: `set-mark${entry.count >= 2 ? ' is-live' : ''}`,
          text: `${t(`set.${entry.id}.name` as StringKey)} ${entry.count}/3${
            entry.count >= 3 ? ` · ${t('set.three')}` : entry.count === 2 ? ` · ${t('set.two')}` : ''
          }`,
        }),
      ),
    );
  }

  /** Prefix, grade, kind, and the workshop it came out of. */
  private itemName(item: Item): string {
    const parts = [
      item.affix ? t(`affix.${item.affix}` as StringKey) : '',
      t(`rarity.${item.rarity}` as StringKey),
      t(`kind.${item.kind}` as StringKey),
    ].filter(Boolean);
    const name = parts.join(' ');
    return item.set ? `${name} (${t(`set.${item.set}.name` as StringKey)})` : name;
  }

  private gearChip(item: Item | null, slot: string): HTMLElement {
    if (!item) {
      return el('div', { class: 'gear-chip empty' }, [
        el('span', { class: 'gear-slot', text: t(`slot.${slot}` as StringKey) }),
        el('span', { class: 'muted', text: t('roster.empty') }),
      ]);
    }
    const chip = el('div', { class: 'gear-chip' }, [
      el('span', { class: 'gear-slot', text: t(`slot.${item.slot}` as StringKey) }),
      el('span', { class: 'gear-name', text: this.itemName(item) }),
      el('span', { class: 'gear-gain', text: this.gearGainText(item) }),
    ]);
    chip.style.setProperty('--rarity', RARITIES[item.rarity].shade);
    return chip;
  }

  private stashRow(item: Item): HTMLElement {
    const buttons = partyOf(this.game.state).map((hero) => {
      const current = hero.gear[item.slot];
      const change = item.power - (current?.power ?? 0);
      const button = el('button', {
        class: `button tiny${change > 0 ? ' primary' : ''}`,
        type: 'button',
        title: t(`hero.${hero.id}.name` as StringKey),
        html: `${icon(HEROES[hero.id].icon)}<span>${t(`hero.${hero.id}.name` as StringKey)} ${change >= 0 ? '+' : ''}${formatNumber(change)}</span>`,
      });
      on(button, 'click', () => {
        sound.play('loot', { gain: 0.7 });
        this.game.equip(hero.id, item);
        this.renderPanel('roster', true);
      });
      return button;
    });

    const melt = el('button', {
      class: 'button tiny',
      type: 'button',
      html: `${icon('pick')}<span>${formatNumber(this.game.scrapValue(item))} ${t('res.iron')}</span>`,
      title: t('action.scrap'),
    });
    on(melt, 'click', () => {
      sound.play('buy', { gain: 0.6 });
      this.game.scrapItem(item.uid);
      this.renderPanel('roster', true);
    });

    return el('div', { class: 'stash-row' }, [
      this.gearChip(item, item.slot),
      el('div', { class: 'stash-actions' }, [...buttons, melt]),
    ]);
  }

  private renderCamp(): void {
    const panel = this.ref('panel:camp');
    const state = this.game.state;
    clear(panel);

    const grid = el('div', { class: 'grid' });
    for (const id of BUILDING_ORDER) {
      const definition = BUILDINGS[id];
      const level = state.buildings[id];
      const cost = this.game.buildingCost(id);
      const maxed = level >= definition.maxLevel;
      const effect = BUILDING_EFFECT[id];
      const value = formatPercent(effect as number);

      const button = el('button', {
        class: 'button',
        type: 'button',
        disabled: maxed || !this.game.canAfford(cost),
        html: maxed
          ? `<span>${t('camp.max')}</span>`
          : `${icon('upgrade')}<span>${t('action.upgrade')} · ${this.costLabel(cost)}</span>`,
      });
      on(button, 'click', () => {
        sound.play('buy', { gain: 0.8 });
        this.game.upgrade(id as BuildingId);
        this.renderPanel('camp', true);
      });

      grid.append(
        el('article', { class: 'card' }, [
          el('h3', { class: 'card-title', html: `${icon(definition.icon)}<span>${t(`building.${id}.name` as StringKey)}</span>` }),
          el('p', { class: 'note', text: t(`building.${id}.line` as StringKey, { value }) }),
          el('div', { class: 'stat-line' }, [
            el('span', { text: `${t('camp.level')} ${level}` }),
            el('span', { class: 'muted', text: `/ ${definition.maxLevel}` }),
          ]),
          button,
        ]),
      );
    }

    const cost = this.game.mendCost();
    const mend = el('button', {
      class: 'button',
      type: 'button',
      disabled: cost === 0 || state.bank.coin < cost,
      html: cost === 0 ? `<span>${t('camp.mendNone')}</span>` : `${icon('vitals')}<span>${t('action.mend')} · ${formatNumber(cost)}</span>`,
    });
    on(mend, 'click', () => {
      sound.play('buy', { gain: 0.8 });
      this.game.mend();
      this.renderPanel('camp', true);
    });

    panel.append(
      el('div', { class: 'card wide' }, [
        el('h2', { class: 'card-title', html: `${icon('vitals')}<span>${t('camp.mend')}</span>` }),
        el('p', { class: 'note', text: t('roster.woundNote', { value: formatPercent(BALANCE.woundPenalty) }) }),
        el('p', { class: 'note', text: t('camp.woundNote') }),
        mend,
      ]),
      grid,
    );
  }

  private costLabel(cost: { coin: number; iron: number; crystal: number }): string {
    const parts = [`${formatNumber(cost.coin)} ${t('res.coin')}`];
    if (cost.iron > 0) parts.push(`${formatNumber(cost.iron)} ${t('res.iron')}`);
    if (cost.crystal > 0) parts.push(`${formatNumber(cost.crystal)} ${t('res.crystal')}`);
    return parts.join(' · ');
  }

  private renderRelics(): void {
    const panel = this.ref('panel:relics');
    const state = this.game.state;
    clear(panel);

    const gain = relicYield(state);
    const offer = el('button', {
      class: 'button primary',
      type: 'button',
      disabled: gain <= 0,
      html: `${icon('relic')}<span>${t('action.prestige')}</span>`,
    });
    on(offer, 'click', () => {
      if (!this.game.canPrestige()) return;
      if (!window.confirm(t('relics.warning'))) return;
      const reached = this.game.state.deepestFloor;
      this.game.prestige();
      metrics.mark('prestige', reached);
      this.build();
      this.selectTab('relics');
    });

    panel.append(
      el('div', { class: 'card wide' }, [
        el('h2', { class: 'card-title', html: `${icon('relic')}<span>${t('relics.title')}</span>` }),
        el('p', { class: 'note', text: t('relics.note') }),
        el('p', {
          class: gain > 0 ? 'readout' : 'muted',
          text: gain > 0 ? t('relics.gain', { value: gain }) : t('relics.locked', { value: BALANCE.prestige.minFloor }),
        }),
        el('p', { class: 'note', text: t('relics.warning') }),
        offer,
      ]),
    );

    const grid = el('div', { class: 'grid' });
    for (const id of RELIC_ORDER) {
      const definition = RELICS[id];
      const rank = state.relics[id];
      const cost = this.game.relicCost(id);
      const maxed = rank >= definition.maxRank;
      const raw = RELIC_EFFECT[id];
      const value = id === 'guidestone' || id === 'wakingcamp' ? `${raw}` : formatPercent(raw as number);

      const button = el('button', {
        class: 'button',
        type: 'button',
        disabled: maxed || state.bank.relic < cost,
        html: maxed ? `<span>${t('camp.max')}</span>` : `${icon('relic')}<span>${formatNumber(cost)} ${t('res.relic')}</span>`,
      });
      on(button, 'click', () => {
        sound.play('buy', { gain: 0.8 });
        this.game.buyRelic(id as RelicId);
        this.renderPanel('relics', true);
      });

      grid.append(
        el('article', { class: 'card' }, [
          el('h3', { class: 'card-title', html: `${icon(definition.icon)}<span>${t(`relic.${id}.name` as StringKey)}</span>` }),
          el('p', { class: 'note', text: t(`relic.${id}.line` as StringKey, { value }) }),
          el('div', { class: 'stat-line' }, [
            el('span', { text: `${t('relics.rank')} ${rank}` }),
            el('span', { class: 'muted', text: `/ ${definition.maxRank}` }),
          ]),
          button,
        ]),
      );
    }
    panel.append(grid);
    this.renderEchoes(panel);
  }

  /**
   * The second reset, which only shows up once the shaft has been pushed far
   * enough for the first one to have stopped helping.
   */
  private renderEchoes(panel: HTMLElement): void {
    const state = this.game.state;
    const gain = echoYield(state);
    const seen = gain > 0 || state.deepPrestiges > 0 || state.bank.echo > 0;
    if (!seen) return;

    const offer = el('button', {
      class: 'button primary',
      type: 'button',
      disabled: gain <= 0,
      html: `${icon('stone')}<span>${t('deep.title')}</span>`,
    });
    on(offer, 'click', () => {
      if (!this.game.canDescendDeep()) return;
      if (!window.confirm(t('deep.warning'))) return;
      const reached = this.game.state.deepestFloor;
      this.game.deepPrestige();
      metrics.mark('prestige', reached, 'deep');
      this.build();
      this.selectTab('relics');
    });

    panel.append(
      el('div', { class: 'card wide' }, [
        el('h2', { class: 'card-title' }, [
          el('span', { html: icon('stone') }),
          el('span', { text: t('deep.title') }),
          el('span', { class: 'tagline', text: `${t('deep.count')}: ${formatNumber(state.deepPrestiges)}` }),
        ]),
        el('p', { class: 'note', text: t('deep.note') }),
        el('p', {
          class: gain > 0 ? 'readout' : 'muted',
          text: gain > 0 ? t('deep.offer', { echoes: gain }) : t('deep.locked', { floor: DEEP.minFloor }),
        }),
        offer,
      ]),
    );

    const grid = el('div', { class: 'grid' });
    for (const id of ECHO_ORDER) {
      const definition = ECHOES[id];
      const rank = state.echoes[id];
      const cost = this.game.echoCost(id);
      const maxed = rank >= definition.maxRank;
      const raw = ECHO_EFFECT[id];
      const value = id === 'oldlamp' || id === 'firstlight' ? `${raw}` : formatPercent(raw as number);

      const button = el('button', {
        class: 'button',
        type: 'button',
        disabled: maxed || state.bank.echo < cost,
        html: maxed ? `<span>${t('camp.max')}</span>` : `${icon('stone')}<span>${formatNumber(cost)} ${t('res.echo')}</span>`,
      });
      on(button, 'click', () => {
        sound.play('buy', { gain: 0.8 });
        this.game.buyEcho(id);
        this.renderPanel('relics', true);
      });

      grid.append(
        el('article', { class: 'card' }, [
          el('h3', { class: 'card-title', html: `${icon(definition.icon)}<span>${t(`echo.${id}.name` as StringKey)}</span>` }),
          el('p', { class: 'note', text: t(`echo.${id}.line` as StringKey) }),
          el('div', { class: 'stat-line' }, [
            el('span', { text: `${t('relics.rank')} ${rank}` }),
            el('span', { class: 'muted', text: `/ ${definition.maxRank}` }),
            el('span', { class: 'muted', text: value }),
          ]),
          button,
        ]),
      );
    }
    panel.append(grid);
  }

  // ----------------------------------------------------------------- records

  private renderRecords(): void {
    const panel = this.ref('panel:records');
    const state = this.game.state;
    clear(panel);

    // These three are kept rather than rebuilt. The ladder holds a field a
    // player may be typing into, and the other two update themselves in place
    // whenever their own contents actually change.
    const contracts =
      this.refs.get('contractCard') ?? this.keep('contractCard', el('div', { class: 'card wide contract-card' }));
    const lastDive = this.refs.get('lastDiveCard') ?? this.keep('lastDiveCard', el('div', { class: 'card wide', hidden: true }));
    panel.append(contracts, lastDive);
    this.renderContracts();
    this.renderLastDive();

    if (ladderAvailable()) panel.append(this.refs.get('ladderCard') ?? this.buildLadder());

    // Milestones, which are the only permanent thing a rout cannot touch.
    const marks = state.milestones;
    const nextFloor = (marks + 1) * MILESTONE.everyFloors;
    panel.append(
      el('div', { class: 'card wide' }, [
        el('h2', { class: 'card-title', html: `${icon('rank')}<span>${t('milestone.title')}</span>` }),
        el('p', { class: 'note', text: t('milestone.line', { every: MILESTONE.everyFloors }) }),
        el('div', { class: 'record-grid' }, [
          el('div', { class: 'record' }, [
            el('span', { class: 'label', text: t('milestone.count') }),
            el('strong', { class: 'readout', text: String(marks) }),
          ]),
          el('div', { class: 'record' }, [
            el('span', { class: 'label', text: t('milestone.bonus') }),
            el('strong', { class: 'readout', text: formatPercent(marks * MILESTONE.attack) }),
          ]),
          el('div', { class: 'record' }, [
            el('span', { class: 'label', text: t('milestone.next') }),
            el('strong', { class: 'readout', text: String(nextFloor) }),
          ]),
        ]),
      ]),
    );

    // Recent dives.
    const dives = el('div', { class: 'card wide' }, [
      el('h2', { class: 'card-title', html: `${icon('descend')}<span>${t('records.dives')}</span>` }),
    ]);
    if (state.diveHistory.length === 0) {
      dives.append(el('p', { class: 'muted', text: t('records.none') }));
    } else {
      const table = el('div', { class: 'dive-list' });
      for (const report of state.diveHistory) {
        table.append(
          el('div', { class: `dive-row${report.wiped ? ' bad' : ''}` }, [
            el('span', { class: 'dive-icon', html: icon(report.wiped ? 'grave' : 'ascend') }),
            el('span', { class: 'dive-depth', text: `${t('dive.deepest')} ${report.deepest}` }),
            el('span', { class: 'dive-take', text: `${formatNumber(report.coin)} ${t('res.coin')}` }),
            el('span', { class: 'dive-meta', text: `${report.fights} ${t('dive.fights')}` }),
            el('span', { class: 'dive-meta', text: formatDuration(report.seconds) }),
            el('span', {
              class: `dive-tag ${report.wiped ? 'bad' : 'good'}`,
              text: report.wiped ? t('dive.wiped') : t('dive.returned'),
            }),
          ]),
        );
      }
      dives.append(table);
    }
    panel.append(dives);

    // Achievements.
    const earned = ACHIEVEMENTS.filter((entry) => state.achievements[entry.id]).length;
    const list = el('div', { class: 'grid' });
    for (const entry of ACHIEVEMENTS) {
      const at = state.achievements[entry.id];
      list.append(
        el('div', { class: `card badge${at ? ' is-earned' : ' is-locked'}` }, [
          el('h3', { class: 'badge-title', html: `${icon(entry.icon)}<span>${t(`achievement.${entry.id}.name` as StringKey)}</span>` }),
          el('p', { class: 'note', text: t(`achievement.${entry.id}.line` as StringKey) }),
          el('span', {
            class: 'badge-meta',
            text: at ? new Date(at).toLocaleDateString(state.language === 'tr' ? 'tr-TR' : 'en-GB') : t('achievement.locked'),
          }),
        ]),
      );
    }
    panel.append(
      el('div', { class: 'card wide' }, [
        el('h2', { class: 'card-title' }, [
          el('span', { html: icon('rank') }),
          el('span', { text: t('achievement.title') }),
          el('span', { class: 'tagline', text: t('achievement.count', { done: earned, total: ACHIEVEMENTS.length }) }),
        ]),
        list,
      ]),
    );

    // Bestiary.
    const seen = ALL_FOES.filter((kind) => (state.bestiary[kind] ?? 0) > 0).length;
    const beasts = el('div', { class: 'bestiary' });
    for (const kind of FOE_ORDER) {
      const kills = state.bestiary[kind] ?? 0;
      beasts.append(
        el('div', { class: `beast${kills > 0 ? '' : ' is-unseen'}` }, [
          el('span', { class: 'beast-portrait', style: portraitStyle(kind) }),
          el('span', { class: 'beast-name', text: kills > 0 ? t(`foe.${kind}` as StringKey) : t('bestiary.unknown') }),
          el('span', { class: 'beast-count', text: kills > 0 ? `${formatNumber(kills)} ${t('bestiary.kills')}` : '' }),
        ]),
      );
    }
    panel.append(
      el('div', { class: 'card wide' }, [
        el('h2', { class: 'card-title' }, [
          el('span', { html: icon('swords') }),
          el('span', { text: t('bestiary.title') }),
          el('span', { class: 'tagline', text: t('bestiary.seen', { seen, total: ALL_FOES.length }) }),
        ]),
        beasts,
      ]),
    );
  }

  // ------------------------------------------------------------------ ladder

  /**
   * The board ranks the deepest floor a party actually climbed out of, which
   * is the only number in the game that cost something to get.
   */
  private buildLadder(): HTMLElement {
    const state = this.game.state;
    const card = this.keep('ladderCard', el('div', { class: 'card wide' }));

    const name = el('input', { class: 'field', type: 'text', maxlength: 18, placeholder: t('ladder.namePlaceholder') });
    (name as HTMLInputElement).value = state.ladderName;
    // Kept as it is typed, so nothing is lost to a reload or a rebuild either.
    on(name, 'input', () => {
      state.ladderName = (name as HTMLInputElement).value;
    });

    const note = this.keep('ladderNote', el('p', { class: 'note', text: t('ladder.note') }));

    const send = el('button', {
      class: 'button primary',
      type: 'button',
      html: `${icon('rank')}<span>${t('ladder.submit')}</span>`,
    });
    on(send, 'click', () => {
      const chosen = (name as HTMLInputElement).value.trim();
      state.ladderName = chosen;
      writeSave(state);
      sound.play('click', { gain: 0.5 });
      setText(note, t('ladder.sending'));
      void submitScore(state, chosen).then((result) => {
        setText(note, t(`ladder.result.${result}` as StringKey, { floor: state.deepestBanked }));
        if (result === 'ok') void this.loadBoard();
      });
    });

    const scopes = el('div', { class: 'lang-switch' });
    for (const scope of ['week', 'all'] as BoardScope[]) {
      const button = el('button', {
        class: `button tiny${this.boardScope === scope ? ' primary' : ''}`,
        type: 'button',
        'data-scope': scope,
        text: t(scope === 'week' ? 'ladder.week' : 'ladder.all'),
      });
      on(button, 'click', () => {
        this.boardScope = scope;
        for (const other of Array.from(scopes.children)) {
          other.classList.toggle('primary', (other as HTMLElement).dataset.scope === scope);
        }
        void this.loadBoard();
      });
      scopes.append(button);
    }

    const rows = this.keep('ladderRows', el('div', { class: 'board' }));

    card.append(
      el('h2', { class: 'card-title' }, [
        el('span', { html: icon('rank') }),
        el('span', { text: t('ladder.title') }),
        scopes,
      ]),
      el('div', { class: 'ladder-form' }, [name, send]),
      note,
      rows,
    );

    void this.loadBoard();
    return card;
  }

  private async loadBoard(): Promise<void> {
    const rows = this.refs.get('ladderRows');
    if (!rows) return;
    const board = await fetchBoard(this.boardScope);
    const host = this.refs.get('ladderRows');
    if (!host) return;

    clear(host);
    if (!board || board.rows.length === 0) {
      host.append(el('p', { class: 'muted', text: t('ladder.empty') }));
      return;
    }

    const me = myId();
    for (const row of board.rows) {
      host.append(
        el('div', { class: `board-row${row.pid === me ? ' is-me' : ''}` }, [
          el('span', { class: 'board-rank', text: `${row.rank}` }),
          el('span', { class: 'board-name', text: row.name }),
          el('span', { class: 'board-floor', text: `${t('dive.deepest')} ${formatNumber(row.floor)}` }),
          el('span', {
            class: 'board-meta',
            text: `${t('ledger.stat.prestiges')} ${formatNumber(row.prestiges)}${row.deep > 0 ? ` · ${t('deep.title')} ${row.deep}` : ''}`,
          }),
          el('span', { class: 'board-meta', text: formatDuration(row.played) }),
        ]),
      );
    }
  }

  // ---------------------------------------------------------------- overlays

  private overlay(title: string, body: HTMLElement[], actionLabel: string, onClose?: () => void): void {
    const close = el('button', { class: 'button primary', type: 'button', text: actionLabel });
    const backdrop = el('div', { class: 'backdrop' }, [
      el('div', { class: 'modal' }, [el('h2', { class: 'modal-title', text: title }), ...body, close]),
    ]);
    on(close, 'click', () => {
      backdrop.remove();
      onClose?.();
    });
    this.root.append(backdrop);
  }

  private showIntro(): void {
    this.game.state.tutorialSeen = true;
    this.overlay(t('intro.title'), [el('p', { class: 'modal-body', text: t('intro.body') })], t('intro.begin'));
  }

  private showHarvest(harvest: Harvest): void {
    const rows: [StringKey, string][] = [
      ['offline.away', formatDuration(harvest.seconds)],
      ['res.coin', formatNumber(harvest.coin)],
      ['res.iron', formatNumber(harvest.iron)],
      ['res.crystal', formatNumber(harvest.crystal)],
      ['offline.floors', formatNumber(harvest.floors)],
      ['offline.fights', formatNumber(harvest.fights)],
      ['offline.wipes', formatNumber(harvest.wipes)],
      ['offline.items', formatNumber(harvest.items)],
    ];

    this.overlay(
      t('offline.title'),
      [
        el(
          'div',
          { class: 'record-grid' },
          rows.map(([key, value]) =>
            el('div', { class: 'record' }, [el('span', { class: 'label', text: t(key) }), el('strong', { class: 'readout', text: value })]),
          ),
        ),
        el('p', { class: 'note', text: t('offline.capped') }),
      ],
      t('action.close'),
    );
  }
}

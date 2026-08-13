import {
  BALANCE,
  BUILDINGS,
  BUILDING_EFFECT,
  BUILDING_ORDER,
  HEROES,
  HERO_ORDER,
  RARITIES,
  RARITY_ORDER,
  RELICS,
  RELIC_EFFECT,
  RELIC_ORDER,
  SLOTS,
  zoneForFloor,
} from '../data/content';
import type { Game, Harvest } from '../core/game';
import { heroLook, itemGain, masteryCost, heroStats, maxStartFloor, partyOf, relicYield, xpForLevel } from '../core/stats';
import type { BuildingId, Item, RarityId, RelicId } from '../core/types';
import { clearSave, writeSave } from '../core/save';
import { formatDuration, formatNumber, formatPercent, setLanguage, t, type StringKey } from '../i18n';
import { sound } from './audio';
import { icon, portraitStyle, preload, spriteMeta } from './assets';
import { clear, el, on, setText, setWidth } from './dom';
import { Menu } from './menu';
import { Scene, type AttackStyle } from './scene';

type TabId = 'shaft' | 'roster' | 'camp' | 'relics';

const TAB_ICONS: Record<TabId, string> = {
  shaft: 'descend',
  roster: 'swords',
  camp: 'camp',
  relics: 'relic',
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

  constructor(game: Game, root: HTMLElement) {
    this.game = game;
    this.root = root;
  }

  async start(): Promise<void> {
    setLanguage(this.game.state.language);
    sound.setVolume(this.game.state.audio.volume);
    sound.setMuted(this.game.state.audio.muted);
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

    return el('section', { class: 'panel shaft' }, [
      el('div', { class: 'shaft-main' }, [stage, status, controls, el('div', { class: 'card log-card' }, [log])]),
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

    return el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', html: `${icon('gear')}<span>${t('policy.title')}</span>` }),
      el('label', { class: 'row toggle', for: 'auto-dive' }, [auto, el('span', { text: t('action.autoDive') })]),
      el('label', { class: 'row', for: 'start-floor' }, [el('span', { text: t('policy.start') }), startHint, start]),
      el('label', { class: 'row', for: 'target-floor' }, [el('span', { text: t('policy.target') }), target]),
      el('label', { class: 'row', for: 'retreat-health' }, [el('span', { text: t('policy.retreat') }), retreat, retreatValue]),
      el('label', { class: 'row', for: 'satchel-limit' }, [el('span', { text: t('policy.satchel') }), limit]),
      el('p', { class: 'note', text: t('policy.note') }),
    ]);
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
    const elapsed = Math.min(0.5, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    this.carry += elapsed;
    const step = BALANCE.tickSeconds;
    let steps = 0;
    while (this.carry >= step && steps < 12) {
      this.game.tick(step);
      this.carry -= step;
      steps += 1;
    }

    this.cuesForPhase();

    if (this.view === 'game') {
      this.scene.render(this.game.state, elapsed);
      this.spawnFloats();
      this.renderPurse();
      this.renderShaft();

      if (this.tab === 'roster') this.refreshExperience();

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

    (this.ref('diveButton') as HTMLButtonElement).disabled = run.phase !== 'camp';
    (this.ref('backButton') as HTMLButtonElement).disabled = !inShaft || run.phase === 'climbing';

    this.refreshOrders();
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

      const spot = spots.get(event.key);
      if (!spot) continue;
      if (event.kind === 'guard') continue;
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
    if (id === 'relics') return `${purse}|${Object.values(state.relics).join('.')}|${relicYield(state)}`;
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

  private gearChip(item: Item | null, slot: string): HTMLElement {
    if (!item) {
      return el('div', { class: 'gear-chip empty' }, [
        el('span', { class: 'gear-slot', text: t(`slot.${slot}` as StringKey) }),
        el('span', { class: 'muted', text: t('roster.empty') }),
      ]);
    }
    const chip = el('div', { class: 'gear-chip' }, [
      el('span', { class: 'gear-slot', text: t(`slot.${item.slot}` as StringKey) }),
      el('span', { class: 'gear-name', text: `${t(`rarity.${item.rarity}` as StringKey)} ${t(`kind.${item.kind}` as StringKey)}` }),
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
      this.game.prestige();
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

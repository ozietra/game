import { HERO_ORDER } from '../data/content';
import creditsData from '../data/credits.json';
import type { Game } from '../core/game';
import { clearSave, writeSave } from '../core/save';
import { formatDuration, formatNumber, setLanguage, t, type Language, type StringKey } from '../i18n';
import { sound } from './audio';
import { heroLook } from '../core/stats';
import { icon, portraitStyle } from './assets';
import { clear, el, on } from './dom';

type Section = 'main' | 'settings' | 'credits';

interface CreditEntry {
  source: string;
  authors: string[];
  licenses: string[];
  urls: string[];
  notes: string;
  usedBy: string[];
}

/**
 * The title screen. It also holds everything that is not part of playing:
 * language, sound, the save, and who made the art.
 */
export class Menu {
  private readonly game: Game;
  private readonly host: HTMLElement;
  private readonly onPlay: () => void;
  private readonly onRestart: () => void;
  private section: Section = 'main';

  constructor(game: Game, host: HTMLElement, onPlay: () => void, onRestart: () => void) {
    this.game = game;
    this.host = host;
    this.onPlay = onPlay;
    this.onRestart = onRestart;
  }

  render(): void {
    clear(this.host);
    const body =
      this.section === 'settings' ? this.settings() : this.section === 'credits' ? this.credits() : this.main();

    this.host.append(
      el('div', { class: 'menu' }, [
        el('div', { class: 'menu-plate' }, [
          el('h1', { class: 'menu-title', text: t('app.title') }),
          el('p', { class: 'menu-line', text: t('app.subtitle') }),
          el('p', { class: 'menu-genre', text: t('app.genre') }),
          el('div', { class: 'menu-party' }, HERO_ORDER.map((id) => {
            const hero = this.game.state.heroes[id];
            return el('span', {
              class: `menu-portrait${hero.unlocked ? '' : ' dim'}`,
              style: portraitStyle(heroLook(hero).sprite),
              title: t(`hero.${id}.name` as StringKey),
            });
          })),
          body,
        ]),
      ]),
    );
  }

  private button(label: string, glyph: string, action: () => void, primary = false): HTMLElement {
    const node = el('button', {
      class: `button menu-button${primary ? ' primary' : ''}`,
      type: 'button',
      html: `${icon(glyph)}<span>${label}</span>`,
    });
    on(node, 'click', () => {
      sound.play('click', { gain: 0.5 });
      action();
    });
    return node;
  }

  private go(section: Section): void {
    this.section = section;
    this.render();
  }

  private main(): HTMLElement {
    const state = this.game.state;
    const started = state.totalDives > 0 || state.deepestFloor > 0;

    const summary = started
      ? el('p', { class: 'menu-status' }, [
          document.createTextNode(`${t('shaft.deepest')}: `),
          el('strong', { class: 'readout small', text: formatNumber(state.deepestFloor) }),
          document.createTextNode(`  ·  ${t('ledger.stat.played')}: `),
          el('strong', { class: 'readout small', text: formatDuration(state.playedSeconds) }),
        ])
      : el('p', { class: 'menu-status muted', text: t('menu.first') });

    const rows = [
      this.button(started ? t('menu.continue') : t('menu.play'), 'descend', () => this.onPlay(), true),
      this.button(t('ledger.settings'), 'settings', () => this.go('settings')),
      this.button(t('ledger.title'), 'ledger', () => this.go('credits')),
    ];

    if (started) {
      rows.push(
        this.button(t('menu.restart'), 'grave', () => {
          if (!window.confirm(t('menu.restartWarning'))) return;
          this.onRestart();
        }),
      );
    }

    return el('div', { class: 'menu-body' }, [summary, el('div', { class: 'menu-buttons' }, rows)]);
  }

  private settings(): HTMLElement {
    const state = this.game.state;

    const language = el('div', { class: 'lang-switch' });
    for (const code of ['tr', 'en'] as Language[]) {
      const button = el('button', {
        class: `button tiny${state.language === code ? ' primary' : ''}`,
        type: 'button',
        text: code === 'tr' ? 'Türkçe' : 'English',
      });
      on(button, 'click', () => {
        sound.play('click', { gain: 0.5 });
        state.language = code;
        setLanguage(code);
        writeSave(state);
        this.render();
      });
      language.append(button);
    }

    const volume = el('input', { type: 'range', min: 0, max: 100, step: 5, class: 'slider', id: 'volume' });
    (volume as HTMLInputElement).value = String(Math.round(state.audio.volume * 100));
    const volumeValue = el('span', { class: 'readout small', text: `${Math.round(state.audio.volume * 100)}` });
    on(volume, 'input', () => {
      const value = Number((volume as HTMLInputElement).value) / 100;
      state.audio.volume = value;
      sound.setVolume(value);
      volumeValue.textContent = String(Math.round(value * 100));
    });
    on(volume, 'change', () => {
      sound.play('click', { gain: 0.6 });
      writeSave(state);
    });

    const mute = el('input', { type: 'checkbox', id: 'mute' });
    (mute as HTMLInputElement).checked = state.audio.muted;
    on(mute, 'change', () => {
      state.audio.muted = (mute as HTMLInputElement).checked;
      sound.setMuted(state.audio.muted);
      sound.play('click', { gain: 0.6 });
      writeSave(state);
    });

    const records: [StringKey, string][] = [
      ['ledger.stat.dives', formatNumber(state.totalDives)],
      ['ledger.stat.wipes', formatNumber(state.totalWipes)],
      ['ledger.stat.floors', formatNumber(state.descents)],
      ['ledger.stat.coin', formatNumber(state.lifetimeCoin)],
      ['ledger.stat.deepest', formatNumber(state.deepestFloor)],
      ['ledger.stat.prestiges', formatNumber(state.prestiges)],
      ['ledger.stat.played', formatDuration(state.playedSeconds)],
    ];

    return el('div', { class: 'menu-body' }, [
      el('div', { class: 'menu-section' }, [
        el('h2', { class: 'menu-heading', text: t('ledger.language') }),
        language,
      ]),
      el('div', { class: 'menu-section' }, [
        el('h2', { class: 'menu-heading', text: t('menu.audio') }),
        el('label', { class: 'row', for: 'volume' }, [el('span', { text: t('menu.volume') }), volume, volumeValue]),
        el('label', { class: 'row toggle', for: 'mute' }, [mute, el('span', { text: t('menu.mute') })]),
      ]),
      el('div', { class: 'menu-section' }, [
        el('h2', { class: 'menu-heading', text: t('ledger.stats') }),
        el(
          'div',
          { class: 'record-grid' },
          records.map(([key, value]) =>
            el('div', { class: 'record' }, [
              el('span', { class: 'label', text: t(key) }),
              el('strong', { class: 'readout', text: value }),
            ]),
          ),
        ),
      ]),
      el('div', { class: 'menu-buttons' }, [
        this.button(t('action.wipeSave'), 'grave', () => {
          if (!window.confirm(t('ledger.wipeWarning'))) return;
          clearSave();
          window.location.reload();
        }),
        this.button(t('menu.back'), 'ascend', () => this.go('main')),
      ]),
    ]);
  }

  private credits(): HTMLElement {
    const entries = creditsData as CreditEntry[];
    const groups = new Map<string, CreditEntry[]>();
    for (const entry of entries) {
      const key = entry.authors.join(', ') || 'unknown';
      const bucket = groups.get(key);
      if (bucket) bucket.push(entry);
      else groups.set(key, [entry]);
    }

    const list = el('div', { class: 'credit-list' });
    for (const [authors, group] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const licences = [...new Set(group.flatMap((entry) => entry.licenses))].join(', ');
      const link = group.find((entry) => entry.urls.length > 0)?.urls[0];
      list.append(
        el('div', { class: 'credit' }, [
          el('span', { class: 'credit-authors', text: authors }),
          el('span', { class: 'credit-meta', text: `${licences} · ${group.length}` }),
          link
            ? el('a', { class: 'credit-link', href: link, target: '_blank', rel: 'noreferrer noopener', text: link })
            : null,
        ]),
      );
    }

    return el('div', { class: 'menu-body' }, [
      el('p', { class: 'note', text: t('ledger.assets') }),
      list,
      el('p', { class: 'note', text: t('ledger.licence') }),
      el('div', { class: 'menu-buttons' }, [this.button(t('menu.back'), 'ascend', () => this.go('main'))]),
    ]);
  }
}

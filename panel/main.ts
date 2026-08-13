import './panel.css';
import { clear, el, on } from '../src/ui/dom';
import { columnChart, funnelChart, lineChart, type Series } from './charts';

/**
 * The owner's panel.
 *
 * It is a reader and nothing else: it holds an address and a token in this
 * browser, asks the collector one question, and draws the answer. The page
 * itself is harmless to publish because it knows nothing without the token,
 * and it can be pointed at a saved copy of a report when there is no
 * collector to ask.
 */

// ------------------------------------------------------------------- shapes

interface Totals {
  players: number;
  sessions: number;
  seconds: number;
  new7: number;
  new30: number;
  active1: number;
  active7: number;
  active30: number;
  medianSession: number;
  dives: number;
  wipes: number;
  extracts: number;
}

interface DailyRow {
  day: string;
  fresh: number;
  sessions: number;
  active: number;
  seconds: number;
}

interface CohortRow {
  day: string;
  cohort: number;
  d1: number;
  d3: number;
  d7: number;
  returned: number;
  mature1: boolean;
  mature3: boolean;
  mature7: boolean;
}

interface Bucket {
  from: number;
  to: number | null;
  n: number;
}

interface Report {
  generated: number;
  window: number;
  churnDays: number;
  prestigeFloor: number;
  totals: Totals;
  daily: DailyRow[];
  retention: CohortRow[];
  firstSession: {
    sample: number;
    medianSeconds: number;
    p25Seconds: number;
    p75Seconds: number;
    medianFloor: number;
    lengthBuckets: Bucket[];
    floorBuckets: Bucket[];
    closedShare: number;
  };
  dropoff: { floor: number; n: number }[];
  wipeFloors: { floor: number; n: number }[];
  funnel: { step: string; n: number }[];
  prestige: { players: number; eligible: number; rateOfAll: number; rateOfEligible: number };
  repeatPlayers: number;
  langs: { lang: string; n: number }[];
  builds: { build: string; n: number }[];
}

// ------------------------------------------------------------------ strings

type Lang = 'tr' | 'en';

const TR = {
  title: 'Hollowdeep Panel',
  subtitle: 'Oyunun kendi ölçümleri. Kimlik yok, sadece sayılar.',
  setupTitle: 'Panel bağlı değil',
  setupLead: 'Toplayıcıyı kurduktan sonra adresi ve panel anahtarını buraya bir kez yaz. İkisi de yalnız bu tarayıcıda kalır.',
  setupSteps: 'Kurulum adımları analytics/README.md dosyasında.',
  endpoint: 'Toplayıcı adresi',
  token: 'Panel anahtarı',
  connect: 'Bağlan',
  openFile: 'Kayıtlı rapor aç',
  refresh: 'Yenile',
  save: 'Raporu indir',
  disconnect: 'Bağlantıyı unut',
  window: 'Pencere',
  days: 'gün',
  loading: 'Okunuyor',
  offline: 'Dosyadan okunuyor',
  generated: 'Rapor zamanı',
  errorAuth: 'Anahtar kabul edilmedi.',
  errorNet: 'Toplayıcıya ulaşılamadı.',
  errorFile: 'Bu dosya bir rapor değil.',
  empty: 'Henüz veri yok. İlk oyuncu geldiğinde burası dolar.',

  kpiPlayers: 'Toplam oyuncu',
  kpiPlayersFoot: 'ilk kez oynayanların toplamı',
  kpiNew7: 'Son 7 günde yeni',
  kpiNew30: 'Son 30 günde yeni',
  kpiSessions: 'Toplam oturum',
  kpiSeconds: 'Toplam oynanma süresi',
  kpiMedian: 'Ortanca oturum',
  kpiActive: 'Aktif oyuncu',
  kpiActiveFoot: '1 gün / 7 gün / 30 gün',
  kpiRuns: 'İniş / bozgun / çıkış',

  dailyTitle: 'Günlük',
  dailyNote: 'Yeni oyuncu, o gün oynayan oyuncu ve açılan oturum sayısı.',
  dailyNew: 'Yeni',
  dailyActive: 'Aktif',
  dailySessions: 'Oturum',
  timeTitle: 'Günlük oynanma süresi',
  timeNote: 'Toplam saat, oturumların bildirdiği süreye göre.',

  retentionTitle: 'Geri dönüş',
  retentionNote:
    'Her satır bir günün ilk kez gelen oyuncularını izler. Yeterince zaman geçmemiş hücreler soluk yazılır, çünkü o oyuncuların dönme şansı henüz olmadı.',
  retentionCohort: 'İlk gün',
  retentionSize: 'Oyuncu',
  retentionD1: '1. gün',
  retentionD3: '3. gün',
  retentionD7: '7. gün',
  retentionEver: 'Bir daha',
  retentionYoung: 'erken',
  retentionD1All: 'Ortalama 1. gün dönüşü',
  retentionD7All: 'Ortalama 7. gün dönüşü',
  retentionEverAll: 'Bir daha gelen',

  firstTitle: 'İlk oturum ne kadar sürüyor',
  firstNote: 'Oyunu ilk kez açanların o oturumda geçirdiği süre. Yatay eksen dakika.',
  firstFloorTitle: 'İlk oturumda inilen kat',
  firstFloorNote: 'İlk oturumda ulaşılan en derin kat. Yatay eksen kat numarası.',
  median: 'ortanca',
  quartiles: 'çeyrekler',

  stopTitle: 'Nerede bırakıyorlar',
  stopNote:
    'Koyu sütun: bir daha dönmeyen oyuncuların son oturumundaki kat. Açık sütun: kadronun bozguna uğradığı kat. İkisinin üst üste bindiği yer zorluk duvarıdır.',
  stopDrop: 'Bırakılan kat',
  stopWipe: 'Bozgun katı',
  stopChurn: 'gündür dönmeyen oyuncular',

  funnelTitle: 'Huni',
  funnelNote: 'Her adıma kaç oyuncunun ulaştığı.',
  funnelOpened: 'Oyunu açtı',
  funnelDived: 'Kuyuya indi',
  funnelExtracted: 'Yukarı çıktı',
  funnelFloor5: '5. kata indi',
  funnelFloor10: '10. kata indi',
  funnelEligible: 'Kalıntı hakkı',
  funnelPrestiged: 'Kalıntı aldı',

  prestigeTitle: 'Kalıntı oranı',
  prestigeNote: 'Kalıntı hakkı {floor}. kattan sonra açılıyor.',
  prestigeOfAll: 'Tüm oyuncular içinde',
  prestigeOfEligible: 'Hak kazananlar içinde',
  prestigeRepeat: 'Birden fazla oturum açan',

  mixTitle: 'Dil ve sürüm',
  mixKind: 'Tür',
  mixLang: 'Dil',
  mixBuild: 'Sürüm',
  mixCount: 'Oyuncu',
} as const;

type Key = keyof typeof TR;

const EN: Record<Key, string> = {
  title: 'Hollowdeep Panel',
  subtitle: "The game's own measurements. No identities, only counts.",
  setupTitle: 'Panel not connected',
  setupLead:
    'Once the collector is deployed, put its address and the panel key in here once. Both stay in this browser only.',
  setupSteps: 'The deployment steps are in analytics/README.md.',
  endpoint: 'Collector address',
  token: 'Panel key',
  connect: 'Connect',
  openFile: 'Open a saved report',
  refresh: 'Refresh',
  save: 'Download report',
  disconnect: 'Forget connection',
  window: 'Window',
  days: 'days',
  loading: 'Reading',
  offline: 'Reading from a file',
  generated: 'Report time',
  errorAuth: 'That key was refused.',
  errorNet: 'The collector could not be reached.',
  errorFile: 'That file is not a report.',
  empty: 'Nothing yet. This fills up when the first player arrives.',

  kpiPlayers: 'Players',
  kpiPlayersFoot: 'everyone who has ever opened it',
  kpiNew7: 'New in 7 days',
  kpiNew30: 'New in 30 days',
  kpiSessions: 'Sittings',
  kpiSeconds: 'Total time played',
  kpiMedian: 'Median sitting',
  kpiActive: 'Active players',
  kpiActiveFoot: '1 day / 7 days / 30 days',
  kpiRuns: 'Dives / routs / climbs',

  dailyTitle: 'By day',
  dailyNote: 'New players, players who played that day, and sittings opened.',
  dailyNew: 'New',
  dailyActive: 'Active',
  dailySessions: 'Sittings',
  timeTitle: 'Time played per day',
  timeNote: 'Total hours, from the length each sitting reported.',

  retentionTitle: 'Coming back',
  retentionNote:
    'Each row follows the players who arrived on one day. Cells that have not had time to happen yet are printed faint, because those players have not had the chance to return.',
  retentionCohort: 'First day',
  retentionSize: 'Players',
  retentionD1: 'Day 1',
  retentionD3: 'Day 3',
  retentionD7: 'Day 7',
  retentionEver: 'Ever again',
  retentionYoung: 'too soon',
  retentionD1All: 'Day one return, all cohorts',
  retentionD7All: 'Day seven return, all cohorts',
  retentionEverAll: 'Came back at all',

  firstTitle: 'How long a first sitting lasts',
  firstNote: 'Time spent by people opening the game for the first time. The bottom axis is minutes.',
  firstFloorTitle: 'Floor reached in a first sitting',
  firstFloorNote: 'The deepest floor of a first sitting. The bottom axis is floor numbers.',
  median: 'median',
  quartiles: 'quartiles',

  stopTitle: 'Where they stop',
  stopNote:
    'Dark column: the floor of the last sitting of players who never came back. Light column: the floor a party was lost on. Where the two pile up is the difficulty wall.',
  stopDrop: 'Floor left on',
  stopWipe: 'Floor lost on',
  stopChurn: 'days without returning',

  funnelTitle: 'Funnel',
  funnelNote: 'How many players reached each step.',
  funnelOpened: 'Opened the game',
  funnelDived: 'Went down',
  funnelExtracted: 'Climbed back out',
  funnelFloor5: 'Reached floor 5',
  funnelFloor10: 'Reached floor 10',
  funnelEligible: 'Earned the offering',
  funnelPrestiged: 'Took the offering',

  prestigeTitle: 'Offering rate',
  prestigeNote: 'The offering opens past floor {floor}.',
  prestigeOfAll: 'Of all players',
  prestigeOfEligible: 'Of those who earned it',
  prestigeRepeat: 'Opened more than one sitting',

  mixTitle: 'Language and build',
  mixKind: 'Kind',
  mixLang: 'Language',
  mixBuild: 'Build',
  mixCount: 'Players',
};

const TABLES: Record<Lang, Record<Key, string>> = { tr: TR, en: EN };

// ------------------------------------------------------------------- state

interface Settings {
  endpoint: string;
  token: string;
  days: number;
  lang: Lang;
}

const STORE = 'hollowdeep.panel.v1';

function loadSettings(): Settings {
  const fallback: Settings = { endpoint: '', token: '', days: 30, lang: 'tr' };
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return fallback;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    // A locked store only means the address has to be typed again next time.
  }
}

let settings = loadSettings();
let report: Report | null = null;
let status: 'idle' | 'loading' | 'ready' | 'file' = 'idle';
let problem = '';

const host = document.getElementById('panel');
if (!host) throw new Error('panel host missing');

function t(key: Key, params: Record<string, string | number> = {}): string {
  const template = TABLES[settings.lang][key] ?? TR[key];
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(params[name] ?? ''));
}

// ---------------------------------------------------------------- formatting

const locale = () => (settings.lang === 'tr' ? 'tr-TR' : 'en-GB');

function count(value: number): string {
  if (Math.abs(value) < 10000) return Math.round(value).toLocaleString(locale());
  return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function duration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total >= 3600) {
    const hours = total / 3600;
    return `${hours >= 100 ? Math.round(hours) : hours.toFixed(1)} ${settings.lang === 'tr' ? 'sa' : 'h'}`;
  }
  if (total >= 60) return `${Math.round(total / 60)} ${settings.lang === 'tr' ? 'dk' : 'm'}`;
  return `${total} ${settings.lang === 'tr' ? 'sn' : 's'}`;
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

function shortDay(day: string): string {
  return day.slice(5).replace('-', settings.lang === 'tr' ? '.' : '/');
}

/** Buckets are ranges, so they get labelled as ranges rather than as an edge. */
function bucketLabel(bucket: Bucket, format: (value: number) => string): string {
  if (bucket.to === null) return `${format(bucket.from)}+`;
  if (bucket.from === 0) return `<${format(bucket.to)}`;
  return `${format(bucket.from)}-${format(bucket.to)}`;
}

// ------------------------------------------------------------------ fetching

async function refresh(): Promise<void> {
  if (!settings.endpoint || !settings.token) return;
  status = 'loading';
  problem = '';
  render();

  const url = `${settings.endpoint.replace(/\/+$/, '')}/stats?days=${settings.days}`;
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${settings.token}` },
      cache: 'no-store',
    });
    if (response.status === 401) {
      problem = t('errorAuth');
      status = 'idle';
      render();
      return;
    }
    if (!response.ok) throw new Error(String(response.status));
    report = (await response.json()) as Report;
    status = 'ready';
  } catch {
    problem = t('errorNet');
    status = report ? 'ready' : 'idle';
  }
  render();
}

function openFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as Report;
      if (!parsed || typeof parsed.totals !== 'object') throw new Error('shape');
      report = parsed;
      status = 'file';
      problem = '';
    } catch {
      problem = t('errorFile');
    }
    render();
  };
  reader.readAsText(file);
}

function download(): void {
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: `hollowdeep-${new Date(report.generated).toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------- pieces

function tile(label: string, value: string, foot?: string, variant?: 'hero' | 'trio'): HTMLElement {
  return el('div', { class: 'tile' }, [
    el('span', { class: 'label', text: label }),
    el('strong', { class: `value${variant ? ` ${variant}` : ''}`, text: value }),
    foot ? el('span', { class: 'foot', text: foot }) : null,
  ]);
}

function legend(entries: Series[]): HTMLElement {
  return el(
    'div',
    { class: 'legend' },
    entries.map((entry) =>
      el('span', {}, [el('i', { style: `background:${entry.colour}` }), document.createTextNode(entry.label)]),
    ),
  );
}

function card(title: string, note: string, body: (Node | null)[], wide = false): HTMLElement {
  return el('section', { class: `card${wide ? ' wide' : ''}` }, [
    el('h2', { text: title }),
    note ? el('p', { class: 'note', text: note }) : null,
    ...body,
  ]);
}

const SERIES = ['#bc8b09', '#008fb2', '#ae4230', '#809e3b'];

// -------------------------------------------------------------------- views

function setupView(): HTMLElement {
  const endpoint = el('input', { class: 'field', type: 'url', placeholder: 'https://hollowdeep-metrics.workers.dev' });
  (endpoint as HTMLInputElement).value = settings.endpoint;
  const token = el('input', { class: 'field', type: 'password', placeholder: '................' });
  (token as HTMLInputElement).value = settings.token;

  const connect = el('button', { class: 'btn on', type: 'button', text: t('connect') });
  on(connect, 'click', () => {
    settings.endpoint = (endpoint as HTMLInputElement).value.trim();
    settings.token = (token as HTMLInputElement).value.trim();
    saveSettings();
    void refresh();
  });

  const picker = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
  on(picker, 'change', () => {
    const file = (picker as HTMLInputElement).files?.[0];
    if (file) openFile(file);
  });
  const open = el('button', { class: 'btn', type: 'button', text: t('openFile') });
  on(open, 'click', () => (picker as HTMLInputElement).click());

  return el('div', { class: 'card setup' }, [
    el('h2', { text: t('setupTitle') }),
    el('p', { class: 'note', text: t('setupLead') }),
    el('div', { class: 'rows' }, [
      el('label', {}, [el('span', { text: t('endpoint') }), endpoint]),
      el('label', {}, [el('span', { text: t('token') }), token]),
    ]),
    el('div', { class: 'tools' }, [connect, open, picker]),
    problem ? el('p', { class: 'warn', text: problem }) : null,
    el('p', { class: 'note', text: t('setupSteps') }),
  ]);
}

function languageButton(): HTMLElement {
  const button = el('button', { class: 'btn', type: 'button', text: settings.lang === 'tr' ? 'EN' : 'TR' });
  on(button, 'click', () => {
    settings.lang = settings.lang === 'tr' ? 'en' : 'tr';
    saveSettings();
    render();
  });
  return button;
}

function headerView(): HTMLElement {
  const tools: HTMLElement[] = [];

  for (const days of [7, 30, 90]) {
    const button = el('button', {
      class: `btn${settings.days === days ? ' on' : ''}`,
      type: 'button',
      text: `${days} ${t('days')}`,
    });
    on(button, 'click', () => {
      settings.days = days;
      saveSettings();
      void refresh();
    });
    tools.push(button);
  }

  tools.push(languageButton());

  const reload = el('button', { class: 'btn', type: 'button', text: t('refresh') });
  on(reload, 'click', () => void refresh());
  tools.push(reload);

  if (report) {
    const save = el('button', { class: 'btn', type: 'button', text: t('save') });
    on(save, 'click', () => download());
    tools.push(save);
  }

  const forget = el('button', { class: 'btn', type: 'button', text: t('disconnect') });
  on(forget, 'click', () => {
    settings.endpoint = '';
    settings.token = '';
    report = null;
    status = 'idle';
    saveSettings();
    render();
  });
  tools.push(forget);

  const stamp =
    status === 'loading'
      ? t('loading')
      : status === 'file'
        ? t('offline')
        : report
          ? `${t('generated')}: ${new Date(report.generated).toLocaleString(locale())}`
          : '';

  return el('header', { class: 'head' }, [
    el('div', {}, [el('h1', { text: t('title') }), el('p', { class: 'sub', text: problem || stamp || t('subtitle') })]),
    el('div', { class: 'tools' }, tools),
  ]);
}

function tilesView(data: Report): HTMLElement {
  const totals = data.totals;
  return el('div', { class: 'tiles' }, [
    tile(t('kpiPlayers'), count(totals.players), t('kpiPlayersFoot'), 'hero'),
    tile(t('kpiNew7'), count(totals.new7), `${t('kpiNew30')}: ${count(totals.new30)}`),
    tile(t('kpiSessions'), count(totals.sessions), `${t('prestigeRepeat')}: ${count(data.repeatPlayers)}`),
    tile(t('kpiSeconds'), duration(totals.seconds)),
    tile(t('kpiMedian'), duration(totals.medianSession)),
    tile(
      t('kpiActive'),
      `${count(totals.active1)} / ${count(totals.active7)} / ${count(totals.active30)}`,
      t('kpiActiveFoot'),
      'trio',
    ),
    tile(t('kpiRuns'), `${count(totals.dives)} / ${count(totals.wipes)} / ${count(totals.extracts)}`, undefined, 'trio'),
  ]);
}

function dailyView(data: Report): HTMLElement {
  const labels = data.daily.map((row) => shortDay(row.day));
  const series: Series[] = [
    { label: t('dailyNew'), colour: SERIES[0], values: data.daily.map((row) => row.fresh) },
    { label: t('dailyActive'), colour: SERIES[1], values: data.daily.map((row) => row.active) },
    { label: t('dailySessions'), colour: SERIES[2], values: data.daily.map((row) => row.sessions) },
  ];
  return card(t('dailyTitle'), t('dailyNote'), [
    legend(series),
    lineChart({ title: t('dailyTitle'), labels, series, format: (value) => count(value) }),
  ], true);
}

function timeView(data: Report): HTMLElement {
  const labels = data.daily.map((row) => shortDay(row.day));
  const series: Series[] = [
    { label: t('timeTitle'), colour: SERIES[0], values: data.daily.map((row) => row.seconds / 3600) },
  ];
  return card(t('timeTitle'), t('timeNote'), [
    columnChart({
      title: t('timeTitle'),
      labels,
      series,
      width: 1100,
      height: 220,
      whole: false,
      format: (value) => (value >= 10 ? String(Math.round(value)) : value.toFixed(1)),
    }),
  ], true);
}

function retentionView(data: Report): HTMLElement {
  const mature = (pick: (row: CohortRow) => boolean) => data.retention.filter(pick);
  const share = (rows: CohortRow[], value: (row: CohortRow) => number) => {
    const size = rows.reduce((sum, row) => sum + row.cohort, 0);
    return size > 0 ? rows.reduce((sum, row) => sum + value(row), 0) / size : 0;
  };

  const d1Rows = mature((row) => row.mature1);
  const d7Rows = mature((row) => row.mature7);

  const head = el('div', { class: 'tiles' }, [
    tile(t('retentionD1All'), percent(share(d1Rows, (row) => row.d1)), `${d1Rows.length} ${t('days')}`),
    tile(t('retentionD7All'), percent(share(d7Rows, (row) => row.d7)), `${d7Rows.length} ${t('days')}`),
    tile(t('retentionEverAll'), percent(share(d1Rows, (row) => row.returned))),
  ]);

  const cell = (value: number, size: number, ready: boolean) =>
    el('td', {
      class: ready ? 'num' : 'num young',
      text: ready ? `${value} · ${size > 0 ? percent(value / size) : '0%'}` : t('retentionYoung'),
    });

  const table = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: t('retentionCohort') }),
        el('th', { text: t('retentionSize') }),
        el('th', { text: t('retentionD1') }),
        el('th', { text: t('retentionD3') }),
        el('th', { text: t('retentionD7') }),
        el('th', { text: t('retentionEver') }),
      ]),
    ]),
    el(
      'tbody',
      {},
      [...data.retention].reverse().map((row) =>
        el('tr', {}, [
          el('td', { text: row.day }),
          el('td', { class: 'num', text: count(row.cohort) }),
          cell(row.d1, row.cohort, row.mature1),
          cell(row.d3, row.cohort, row.mature3),
          cell(row.d7, row.cohort, row.mature7),
          cell(row.returned, row.cohort, row.mature1),
        ]),
      ),
    ),
  ]);

  return card(t('retentionTitle'), t('retentionNote'), [head, el('div', { class: 'scroll' }, [table])], true);
}

function firstLengthView(data: Report): HTMLElement {
  const first = data.firstSession;
  const labels = first.lengthBuckets.map((bucket) => bucketLabel(bucket, (value) => String(Math.round(value / 60))));
  const series: Series[] = [{ label: t('firstTitle'), colour: SERIES[0], values: first.lengthBuckets.map((b) => b.n) }];
  return card(t('firstTitle'), t('firstNote'), [
    el('p', { class: 'note' }, [
      document.createTextNode(`${t('median')}: `),
      el('strong', { text: duration(first.medianSeconds) }),
      document.createTextNode(`  ·  ${t('quartiles')}: `),
      el('strong', { text: `${duration(first.p25Seconds)} / ${duration(first.p75Seconds)}` }),
    ]),
    columnChart({ title: t('firstTitle'), labels, series, labelCaps: true, format: (value) => count(value) }),
  ]);
}

function firstFloorView(data: Report): HTMLElement {
  const first = data.firstSession;
  const labels = first.floorBuckets.map((bucket) => bucketLabel(bucket, (value) => String(value)));
  const series: Series[] = [
    { label: t('firstFloorTitle'), colour: SERIES[0], values: first.floorBuckets.map((b) => b.n) },
  ];
  return card(t('firstFloorTitle'), t('firstFloorNote'), [
    el('p', { class: 'note' }, [
      document.createTextNode(`${t('median')}: `),
      el('strong', { text: String(first.medianFloor) }),
    ]),
    columnChart({ title: t('firstFloorTitle'), labels, series, labelCaps: true, format: (value) => count(value) }),
  ]);
}

/** Floors are open ended, so the long tail folds into one final column. */
function floorSeries(rows: { floor: number; n: number }[], edge: number): number[] {
  const out = new Array<number>(edge + 1).fill(0);
  for (const row of rows) out[Math.min(edge, Math.max(0, row.floor))] += row.n;
  return out;
}

function stopView(data: Report): HTMLElement {
  const deepest = Math.max(
    1,
    ...data.dropoff.map((row) => row.floor),
    ...data.wipeFloors.map((row) => row.floor),
  );
  const edge = Math.min(40, deepest);
  const labels = Array.from({ length: edge + 1 }, (_unused, index) => (index === edge && deepest > edge ? `${edge}+` : String(index)));
  const series: Series[] = [
    { label: t('stopDrop'), colour: SERIES[2], values: floorSeries(data.dropoff, edge) },
    { label: t('stopWipe'), colour: SERIES[0], values: floorSeries(data.wipeFloors, edge) },
  ];
  return card(t('stopTitle'), t('stopNote'), [
    legend(series),
    columnChart({ title: t('stopTitle'), labels, series, width: 1100, height: 240, format: (value) => count(value) }),
    el('p', { class: 'note', text: `${data.churnDays} ${t('stopChurn')}` }),
  ], true);
}

function funnelView(data: Report): HTMLElement {
  const names: Record<string, Key> = {
    opened: 'funnelOpened',
    dived: 'funnelDived',
    extracted: 'funnelExtracted',
    floor5: 'funnelFloor5',
    floor10: 'funnelFloor10',
    eligible: 'funnelEligible',
    prestiged: 'funnelPrestiged',
  };
  const total = data.funnel[0]?.n ?? 0;
  const rows = data.funnel.map((entry) => ({ label: t(names[entry.step] ?? 'funnelOpened'), n: entry.n }));
  return card(t('funnelTitle'), t('funnelNote'), [funnelChart(rows, total)]);
}

function prestigeView(data: Report): HTMLElement {
  return card(t('prestigeTitle'), t('prestigeNote', { floor: data.prestigeFloor }), [
    el('div', { class: 'tiles' }, [
      tile(t('prestigeOfAll'), percent(data.prestige.rateOfAll), `${count(data.prestige.players)} / ${count(data.totals.players)}`),
      tile(
        t('prestigeOfEligible'),
        percent(data.prestige.rateOfEligible),
        `${count(data.prestige.players)} / ${count(data.prestige.eligible)}`,
      ),
    ]),
  ]);
}

function mixView(data: Report): HTMLElement {
  const rows = [
    ...data.langs.map((row) => ({ kind: t('mixLang'), name: row.lang || '?', n: row.n })),
    ...data.builds.map((row) => ({ kind: t('mixBuild'), name: row.build || '?', n: row.n })),
  ];
  const table = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [el('th', { text: t('mixKind') }), el('th', { text: '' }), el('th', { text: t('mixCount') })]),
    ]),
    el(
      'tbody',
      {},
      rows.map((row) =>
        el('tr', {}, [
          el('td', { text: row.kind }),
          el('td', { text: row.name }),
          el('td', { class: 'num', text: count(row.n) }),
        ]),
      ),
    ),
  ]);
  return card(t('mixTitle'), '', [el('div', { class: 'scroll' }, [table])]);
}

// -------------------------------------------------------------------- render

function render(): void {
  if (!host) return;
  clear(host);
  document.documentElement.lang = settings.lang;

  const root = el('div', { class: 'viz' });

  if (!report && !settings.endpoint) {
    root.append(
      el('header', { class: 'head' }, [
        el('div', {}, [el('h1', { text: t('title') }), el('p', { class: 'sub', text: t('subtitle') })]),
        el('div', { class: 'tools' }, [languageButton()]),
      ]),
    );
    root.append(setupView());
    host.append(root);
    return;
  }

  root.append(headerView());

  if (!report) {
    root.append(el('p', { class: 'note', text: status === 'loading' ? t('loading') : problem || t('empty') }));
    if (problem) root.append(setupView());
    host.append(root);
    return;
  }

  const data = report;
  root.append(tilesView(data));
  root.append(
    el('div', { class: 'grid' }, [
      dailyView(data),
      timeView(data),
      retentionView(data),
      firstLengthView(data),
      firstFloorView(data),
      stopView(data),
      funnelView(data),
      prestigeView(data),
      mixView(data),
    ]),
  );
  host.append(root);
}

render();
if (settings.endpoint && settings.token) void refresh();

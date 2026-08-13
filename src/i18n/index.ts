import { en } from './en';
import { tr, type StringKey } from './tr';

export type Language = 'tr' | 'en';
export type { StringKey };

const TABLES: Record<Language, Record<StringKey, string>> = { tr, en };

let active: Language = 'tr';

export function setLanguage(language: Language): void {
  active = language;
  document.documentElement.lang = language;
}

export function currentLanguage(): Language {
  return active;
}

/** Looks a string up and fills {placeholders}; nested keys resolve too. */
export function t(key: StringKey, params: Record<string, string | number> = {}): string {
  const table = TABLES[active];
  const template = table[key] ?? tr[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) return '';
    if (typeof value === 'string' && value in table) return table[value as StringKey];
    return String(value);
  });
}

export function has(key: string): key is StringKey {
  return key in tr;
}

export function maybe(key: string): string {
  return has(key) ? t(key) : key;
}

const NUMBER_LOCALES: Record<Language, string> = { tr: 'tr-TR', en: 'en-GB' };

/** Big idle-game numbers, kept readable without turning into noise. */
export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10000) return Math.round(value).toLocaleString(NUMBER_LOCALES[active]);
  const units = ['', 'K', 'M', 'B', 'T', 'Q'];
  let index = 0;
  let scaled = value;
  while (Math.abs(scaled) >= 1000 && index < units.length - 1) {
    scaled /= 1000;
    index += 1;
  }
  const digits = Math.abs(scaled) < 10 ? 2 : Math.abs(scaled) < 100 ? 1 : 0;
  return `${scaled.toFixed(digits)}${units[index]}`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

const DURATION_UNITS: Record<Language, { hour: string; minute: string; second: string }> = {
  tr: { hour: 's', minute: 'd', second: 'sn' },
  en: { hour: 'h', minute: 'm', second: 's' },
};

export function formatDuration(seconds: number): string {
  const unit = DURATION_UNITS[active];
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return `${hours}${unit.hour} ${minutes}${unit.minute}`;
  if (minutes > 0) return `${minutes}${unit.minute} ${rest}${unit.second}`;
  return `${rest}${unit.second}`;
}

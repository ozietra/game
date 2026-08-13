import manifest from '../data/assets.json';
import glyphs from '../data/icons.json';

type SpriteEntry = {
  kind: string;
  file: string;
  frame: number;
  facing: string;
  animations: Record<string, { row: number; frames: number }>;
};

const SPRITES = manifest.sprites as Record<string, SpriteEntry>;
const ZONES = manifest.zones as Record<string, { wall: string[]; floor: string[] }>;
const GLYPHS = glyphs as Record<string, string>;

const images = new Map<string, HTMLImageElement>();

function url(path: string): string {
  const base = import.meta.env.BASE_URL ?? './';
  return base.endsWith('/') ? `${base}${path}` : `${base}/${path}`;
}

function load(path: string): HTMLImageElement {
  const existing = images.get(path);
  if (existing) return existing;
  const image = new Image();
  image.src = url(path);
  images.set(path, image);
  return image;
}

export function spriteMeta(name: string): SpriteEntry | undefined {
  return SPRITES[name];
}

export function spriteImage(name: string): HTMLImageElement | null {
  const entry = SPRITES[name];
  if (!entry) return null;
  return load(entry.file);
}

export function zoneTiles(zone: string): { wall: HTMLImageElement[]; floor: HTMLImageElement[] } {
  const entry = ZONES[zone] ?? ZONES.cellars;
  return {
    wall: entry.wall.map(load),
    floor: entry.floor.map(load),
  };
}

/** Inline SVG so icons inherit the surrounding text colour. */
export function icon(name: string, className = ''): string {
  const glyph = GLYPHS[name];
  if (!glyph) return '';
  return `<svg class="icon ${className}" viewBox="0 0 512 512" aria-hidden="true" focusable="false">${glyph}</svg>`;
}

/**
 * A still frame from a fighter's own sheet, cropped to the body and doubled so
 * the pixels stay square. Used for card portraits.
 */
export function portraitStyle(name: string): string {
  const entry = SPRITES[name];
  if (!entry) return '';
  const zoom = 2;
  const frame = entry.frame;
  const rows = Object.values(entry.animations).reduce((most, clip) => Math.max(most, clip.row), 0) + 1;
  const cropX = 12;
  const cropY = 5;
  return [
    `background-image: url('${url(entry.file)}')`,
    `background-size: ${13 * frame * zoom}px ${rows * frame * zoom}px`,
    `background-position: ${-cropX * zoom}px ${-cropY * zoom}px`,
  ].join('; ');
}

export function preload(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const name of Object.keys(SPRITES)) {
    const image = spriteImage(name);
    if (image && !image.complete) pending.push(image.decode().catch(() => undefined));
  }
  for (const zone of Object.keys(ZONES)) {
    const tiles = zoneTiles(zone);
    for (const image of [...tiles.wall, ...tiles.floor]) {
      if (!image.complete) pending.push(image.decode().catch(() => undefined));
    }
  }
  return Promise.all(pending).then(() => undefined);
}

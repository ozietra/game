import { zoneForFloor } from '../data/content';
import { heroStats, partyOf } from '../core/stats';
import type { Combatant, GameState } from '../core/types';
import { effectImage, spriteImage, spriteMeta, zoneTiles } from './assets';

const TILE = 32;
const SPRITE = 64;
/** Logical pixels the scene aims for before whole-number upscaling. */
const IDEAL_WIDTH = 440;
const MIN_WIDTH = 380;
const MAX_WIDTH = 880;
/** LPC frames leave the feet a few pixels above the bottom edge. */
const FOOT_INSET = 4;

interface AnimationState {
  clip: string;
  frame: number;
  clock: number;
  once: boolean;
}

export interface SpotOnScreen {
  key: string;
  x: number;
  y: number;
  /** Middle of the body, where projectiles are aimed. */
  midY: number;
}

export type AttackStyle = 'melee' | 'shoot' | 'frost' | 'flame';

interface Effect {
  image: string;
  mirror: boolean;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  age: number;
  life: number;
  travelling: boolean;
  scale: number;
}

export class Scene {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly anim = new Map<string, AnimationState>();
  private scroll = 0;
  private flicker = 0;
  private spots: SpotOnScreen[] = [];
  private scale = 1;
  private width = 512;
  private height = 288;
  private clock = 0;
  private effects: Effect[] = [];
  private flashes = new Map<string, number>();
  private readonly tintCanvas = document.createElement('canvas');

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas 2d context unavailable');
    this.ctx = context;
    this.ctx.imageSmoothingEnabled = false;
    this.tintCanvas.width = SPRITE;
    this.tintCanvas.height = SPRITE;
  }

  /** A blow landed: the sprite flashes for a moment. */
  flash(key: string): void {
    this.flashes.set(key, 0.16);
  }

  /**
   * Throws whatever the attack looks like from one fighter to another. Arrows
   * and orbs fly across; a swing just kicks up dust where it lands.
   */
  spawnAttack(fromKey: string, toKey: string, style: AttackStyle): void {
    const from = this.spots.find((spot) => spot.key === fromKey);
    const to = this.spots.find((spot) => spot.key === toKey);
    if (!to) return;

    if (style === 'melee' || !from) {
      this.effects.push({
        image: Math.random() < 0.5 ? 'dust_0' : 'dust_1',
        mirror: false,
        fromX: to.x,
        fromY: to.midY,
        toX: to.x,
        toY: to.midY,
        age: 0,
        life: 0.28,
        travelling: false,
        scale: 0.8,
      });
      return;
    }

    const image = style === 'shoot' ? 'arrow_left' : style === 'frost' ? 'orb_frost' : 'orb_flame';
    this.effects.push({
      image,
      // The cleared arrow tile points left, so shots to the right are mirrored.
      mirror: style === 'shoot' && to.x > from.x,
      fromX: from.x,
      fromY: from.midY,
      toX: to.x,
      toY: to.midY,
      age: 0,
      life: 0.22,
      travelling: true,
      scale: style === 'shoot' ? 1 : 0.75,
    });
  }

  /** Screen position of each fighter, used to place floating numbers. */
  positions(): SpotOnScreen[] {
    return this.spots;
  }

  setScale(scale: number): void {
    this.scale = scale;
  }

  currentScale(): number {
    return this.scale;
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private floorLine(): number {
    return Math.round(this.height * 0.64);
  }

  render(state: GameState, dt: number): void {
    const run = state.run;
    const floor = Math.max(1, run.floor);
    const zone = zoneForFloor(floor);
    const ctx = this.ctx;

    const moving = run.phase === 'descending' ? 1 : run.phase === 'climbing' ? -1 : 0;
    this.scroll = (this.scroll + moving * dt * 46 + TILE * 8) % (TILE * 4);
    this.flicker += dt;

    ctx.clearRect(0, 0, this.width, this.height);
    this.drawWalls(zone.tiles);
    this.drawFloor(zone.tiles);
    this.drawLight(floor);

    this.clock += dt;
    for (const [key, left] of this.flashes) {
      const next = left - dt;
      if (next <= 0) this.flashes.delete(key);
      else this.flashes.set(key, next);
    }

    this.spots = [];
    const resting = run.party.length === 0;
    const party = resting ? this.campParty(state) : run.party;
    this.drawSide(party, dt, 'party', run.phase);
    // Between floors there is nobody to face; the last fight's dead stay behind.
    const facing = run.phase === 'fighting' || run.phase === 'looting';
    if (!resting && facing) this.drawSide(run.foes, dt, 'foe', run.phase);

    this.drawEffects(dt);
    this.drawEdges();
  }

  /** Stand-ins for the roster so the camp is not an empty corridor. */
  private campParty(state: GameState): Combatant[] {
    return partyOf(state).map((hero) => {
      const stats = heroStats(state, hero);
      return {
        key: `camp:${hero.id}`,
        side: 'party' as const,
        sprite: hero.id,
        nameKey: `hero.${hero.id}.name`,
        hero: hero.id,
        stats,
        hp: Math.max(0, Math.round(hero.hp)),
        timer: 0,
        abilityTimer: 0,
        guard: 0,
        alive: hero.hp > 0,
        action: 'idle' as const,
        actionUntil: 0,
      } satisfies Combatant;
    });
  }

  private drawWalls(zoneId: string): void {
    const tiles = zoneTiles(zoneId).wall;
    if (tiles.length === 0 || !tiles[0].complete) return;
    const floorLine = this.floorLine();
    const offset = Math.floor(this.scroll);
    const rows = Math.ceil(floorLine / TILE) + 2;
    const columns = Math.ceil(this.width / TILE);

    for (let row = -1; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tile = tiles[(row * 3 + column * 5 + tiles.length * 2) % tiles.length];
        if (!tile.complete) continue;
        const y = row * TILE + offset - TILE;
        if (y > floorLine) continue;
        this.ctx.drawImage(tile, column * TILE, y);
      }
    }

    // The wall recedes into the dark towards the ceiling.
    const shade = this.ctx.createLinearGradient(0, 0, 0, floorLine);
    shade.addColorStop(0, 'rgba(6, 5, 8, 0.92)');
    shade.addColorStop(0.45, 'rgba(6, 5, 8, 0.45)');
    shade.addColorStop(1, 'rgba(6, 5, 8, 0.2)');
    this.ctx.fillStyle = shade;
    this.ctx.fillRect(0, 0, this.width, floorLine);
  }

  private drawFloor(zoneId: string): void {
    const tiles = zoneTiles(zoneId).floor;
    if (tiles.length === 0) return;
    const floorLine = this.floorLine();
    const columns = Math.ceil(this.width / TILE);
    const rows = Math.ceil((this.height - floorLine) / TILE) + 1;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tile = tiles[(row * 2 + column * 7 + tiles.length) % tiles.length];
        if (!tile.complete) continue;
        this.ctx.drawImage(tile, column * TILE, floorLine + row * TILE);
      }
    }

    const shade = this.ctx.createLinearGradient(0, floorLine, 0, this.height);
    shade.addColorStop(0, 'rgba(8, 6, 9, 0.55)');
    shade.addColorStop(0.35, 'rgba(8, 6, 9, 0.12)');
    shade.addColorStop(1, 'rgba(8, 6, 9, 0.6)');
    this.ctx.fillStyle = shade;
    this.ctx.fillRect(0, floorLine, this.width, this.height - floorLine);
  }

  /** Lantern light in the middle of the corridor, unsteady like a real flame. */
  private drawLight(floor: number): void {
    const ctx = this.ctx;
    const wobble = Math.sin(this.flicker * 6.1) * 0.02 + Math.sin(this.flicker * 2.3) * 0.015;
    const floorLine = this.floorLine();
    const radius = this.width * 0.44 + wobble * 200;
    const glow = ctx.createRadialGradient(this.width / 2, floorLine - 6, 24, this.width / 2, floorLine - 6, radius);
    glow.addColorStop(0, `rgba(255, 197, 122, ${0.16 + wobble})`);
    glow.addColorStop(0.55, 'rgba(180, 120, 60, 0.05)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, this.width, this.height);

    const depthDark = Math.min(0.5, floor / 260);
    if (depthDark > 0) {
      ctx.fillStyle = `rgba(4, 4, 8, ${depthDark})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
  }

  private drawEffects(dt: number): void {
    const ctx = this.ctx;
    const alive: Effect[] = [];

    for (const effect of this.effects) {
      effect.age += dt;
      const image = effectImage(effect.image);
      if (!image || !image.complete || effect.age >= effect.life) {
        if (effect.age >= effect.life && effect.travelling) {
          // A shot that reaches its mark bursts where it lands.
          alive.push({
            ...effect,
            travelling: false,
            age: 0,
            life: 0.26,
            fromX: effect.toX,
            fromY: effect.toY,
            scale: effect.image === 'arrow_left' ? 0.7 : 1.1,
            image: effect.image === 'arrow_left' ? 'dust_0' : effect.image,
          });
        }
        continue;
      }

      const progress = effect.age / effect.life;
      const x = effect.travelling ? effect.fromX + (effect.toX - effect.fromX) * progress : effect.fromX;
      const y = effect.travelling ? effect.fromY + (effect.toY - effect.fromY) * progress : effect.fromY;
      const size = image.width * effect.scale * (effect.travelling ? 1 : 0.75 + progress * 0.7);

      ctx.save();
      ctx.globalAlpha = effect.travelling ? 1 : Math.max(0, 1 - progress);
      ctx.translate(Math.round(x), Math.round(y));
      if (effect.mirror) ctx.scale(-1, 1);
      ctx.drawImage(image, Math.round(-size / 2), Math.round(-size / 2), Math.round(size), Math.round(size));
      ctx.restore();

      alive.push(effect);
    }

    this.effects = alive.slice(-40);
  }

  private drawEdges(): void {
    const ctx = this.ctx;
    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.height * 0.35,
      this.width / 2,
      this.height / 2,
      this.height * 0.95,
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.72)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  private clipFor(fighter: Combatant, phase: GameState['run']['phase']): { clip: string; once: boolean } {
    if (!fighter.alive) return { clip: 'collapse', once: true };
    if (fighter.action === 'attack') return { clip: 'attack', once: true };
    if (phase === 'descending' || phase === 'climbing') return { clip: 'walk', once: false };
    return { clip: 'idle', once: false };
  }

  private drawSide(fighters: Combatant[], dt: number, side: 'party' | 'foe', phase: GameState['run']['phase']): void {
    const count = Math.max(1, fighters.length);
    for (let index = 0; index < fighters.length; index += 1) {
      const fighter = fighters[index];
      const meta = spriteMeta(fighter.sprite);
      const image = spriteImage(fighter.sprite);
      if (!meta || !image || !image.complete) continue;

      const depth = index / Math.max(1, count - 1 || 1);
      const lane = Number.isFinite(depth) ? depth : 0;
      // The front rank stands nearest the middle; the rest trail behind it.
      const spacing = Math.max(22, Math.min(30, Math.round(this.width * 0.06)));
      const front = Math.round(this.width * (side === 'party' ? 0.31 : 0.69));
      const x = side === 'party' ? front - index * spacing : front + index * spacing;
      const y = this.floorLine() + 20 + lane * 22 + (index % 2) * 6;

      const wanted = this.clipFor(fighter, phase);
      const state = this.advance(fighter.key, wanted, meta, dt);
      const clip = meta.animations[state.clip] ?? meta.animations.walk;
      const frame = Math.min(state.frame, clip.frames - 1);

      // Standing still is not standing frozen: a slow breath keeps them alive.
      const breathing = fighter.alive && state.clip === 'idle';
      const bob = breathing ? Math.round(Math.sin(this.clock * 1.9 + index * 1.7)) : 0;

      const drawX = Math.round(x - SPRITE / 2);
      const drawY = Math.round(y - SPRITE + FOOT_INSET) + bob;

      this.ctx.save();
      if (!fighter.alive) this.ctx.globalAlpha = 0.55;
      this.ctx.drawImage(image, frame * SPRITE, clip.row * SPRITE, SPRITE, SPRITE, drawX, drawY, SPRITE, SPRITE);
      this.ctx.restore();

      const flash = this.flashes.get(fighter.key);
      if (flash) this.drawFlash(image, frame, clip.row, drawX, drawY, flash, fighter.side);

      if (fighter.alive) this.drawBar(fighter, drawX + SPRITE / 2, drawY + 12);
      if (fighter.guard > 0) this.drawGuard(drawX + SPRITE / 2, drawY + SPRITE - 10);

      this.spots.push({ key: fighter.key, x: drawX + SPRITE / 2, y: drawY + 8, midY: drawY + SPRITE - 26 });
    }
  }

  private advance(
    key: string,
    wanted: { clip: string; once: boolean },
    meta: { animations: Record<string, { row: number; frames: number }> },
    dt: number,
  ): AnimationState {
    let state = this.anim.get(key);
    if (!state) {
      state = { clip: wanted.clip, frame: 0, clock: 0, once: wanted.once };
      this.anim.set(key, state);
    }

    const resolved = meta.animations[wanted.clip] ? wanted.clip : 'walk';
    if (state.clip !== resolved) {
      state.clip = resolved;
      state.frame = resolved === 'idle' ? 0 : 0;
      state.clock = 0;
      state.once = wanted.once;
    }

    const clip = meta.animations[resolved === 'idle' ? 'walk' : resolved];
    const frames = clip?.frames ?? 1;
    const rate = resolved === 'attack' ? 13 : resolved === 'collapse' ? 7 : 9;

    if (resolved === 'idle') {
      state.frame = 0;
      return state;
    }

    state.clock += dt;
    while (state.clock > 1 / rate) {
      state.clock -= 1 / rate;
      if (state.once && state.frame >= frames - 1) break;
      state.frame = (state.frame + 1) % frames;
    }
    return state;
  }

  /** Paints the struck frame in flat colour for a couple of frames. */
  private drawFlash(
    image: CanvasImageSource,
    frame: number,
    row: number,
    x: number,
    y: number,
    left: number,
    side: 'party' | 'foe',
  ): void {
    const tint = this.tintCanvas.getContext('2d');
    if (!tint) return;

    tint.clearRect(0, 0, SPRITE, SPRITE);
    tint.drawImage(image, frame * SPRITE, row * SPRITE, SPRITE, SPRITE, 0, 0, SPRITE, SPRITE);
    tint.globalCompositeOperation = 'source-atop';
    tint.fillStyle = side === 'party' ? '#c8534a' : '#fff4dc';
    tint.fillRect(0, 0, SPRITE, SPRITE);
    tint.globalCompositeOperation = 'source-over';

    this.ctx.save();
    this.ctx.globalAlpha = Math.min(0.7, left * 4);
    this.ctx.drawImage(this.tintCanvas, x, y);
    this.ctx.restore();
  }

  private drawBar(fighter: Combatant, centreX: number, y: number): void {
    const width = 26;
    const fraction = Math.max(0, Math.min(1, fighter.hp / Math.max(1, fighter.stats.maxHp)));
    if (fraction >= 1 && fighter.side === 'foe') return;

    const x = Math.round(centreX - width / 2);
    this.ctx.fillStyle = 'rgba(10, 8, 10, 0.85)';
    this.ctx.fillRect(x - 1, y - 1, width + 2, 5);
    this.ctx.fillStyle = '#2a2320';
    this.ctx.fillRect(x, y, width, 3);
    this.ctx.fillStyle = fighter.side === 'party' ? '#9ac06a' : '#b4503f';
    this.ctx.fillRect(x, y, Math.round(width * fraction), 3);
  }

  private drawGuard(centreX: number, y: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(200, 162, 74, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(centreX, y, 18, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Fills the container using whole-number upscaling so the art stays sharp. */
  resize(container: HTMLElement): void {
    const available = Math.max(320, container.clientWidth);
    const scale = Math.max(1, Math.min(3, Math.round(available / IDEAL_WIDTH)));
    const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(available / scale)));
    const height = Math.round(width * 0.5);

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.imageSmoothingEnabled = false;
    this.setScale(scale);
    this.canvas.style.width = `${width * scale}px`;
    this.canvas.style.height = `${height * scale}px`;
  }
}

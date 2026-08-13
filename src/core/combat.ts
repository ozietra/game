import {
  BALANCE,
  BOSS_SCALE,
  ELITE_SCALE,
  FOES,
  HEROES,
  KEEPER,
  ZONES,
  talentGain,
  cycleForFloor,
  isBossFloor,
  isEliteFloor,
  openingEase,
  zoneForFloor,
} from '../data/content';
import { Rng } from './rng';
import { heroLook, heroStats } from './stats';
import type { Combatant, GameState, Hero, Stats } from './types';

export interface CombatEvent {
  kind: 'hit' | 'crit' | 'heal' | 'guard' | 'down' | 'ward' | 'rage' | 'summon';
  key: string;
  amount: number;
  from?: string;
}

export function heroCombatant(state: GameState, hero: Hero): Combatant {
  const stats = heroStats(state, hero);
  const look = heroLook(hero);
  const talents = talentGain(hero.id, hero.talents);
  const ability = HEROES[hero.id].ability;
  const cooldown = ability.cooldown * (1 - Math.min(0.6, talents.haste ?? 0));
  return {
    key: `hero:${hero.id}`,
    side: 'party',
    sprite: hero.id,
    look: look.sprite,
    gleam: look.gleam,
    nameKey: `hero.${hero.id}.name`,
    hero: hero.id,
    stats,
    hp: Math.max(1, Math.round(hero.hp)),
    timer: 0,
    abilityTimer: cooldown * 0.5,
    abilityCooldown: cooldown,
    abilityPower: ability.power * (1 + (talents.power ?? 0)),
    guard: 0,
    alive: hero.hp > 0,
    action: 'idle',
    actionUntil: 0,
  };
}

function foeStats(kind: string, floor: number, rank: 'common' | 'elite' | 'boss', danger: number): Stats {
  const shape = FOES[kind];
  const steps = floor - 1;
  const scale = rank === 'boss' ? BOSS_SCALE : rank === 'elite' ? ELITE_SCALE : { health: 1, attack: 1, defence: 1 };
  const cycle = 1 + cycleForFloor(floor) * 0.25;
  const ease = openingEase(floor);

  return {
    maxHp: Math.round(
      BALANCE.foe.health.base *
        BALANCE.foe.health.growth ** steps *
        shape.health *
        scale.health *
        cycle *
        ease *
        danger,
    ),
    attack:
      Math.round(
        BALANCE.foe.attack.base *
          BALANCE.foe.attack.growth ** steps *
          shape.attack *
          scale.attack *
          cycle *
          ease *
          danger *
          10,
      ) / 10,
    defence:
      Math.round(BALANCE.foe.defence.base * BALANCE.foe.defence.growth ** steps * shape.defence * scale.defence * 10) / 10,
    speed: shape.speed,
    crit: BALANCE.foe.crit,
  };
}

/**
 * `danger` is everything outside the depth curve that makes this fight worse:
 * the risk dial, an ambush, a guarded hoard. `forceElite` promotes the front
 * rank whatever the floor number says.
 */
export function buildFoes(
  floor: number,
  encounter: number,
  rng: Rng,
  danger = 1,
  forceElite = false,
): Combatant[] {
  const zone = zoneForFloor(floor);
  const boss = isBossFloor(floor) && encounter === BALANCE.encountersPerFloor;
  const elite = forceElite || (isEliteFloor(floor) && encounter === BALANCE.encountersPerFloor);

  const kinds: string[] = [];
  if (boss) {
    kinds.push(zone.boss);
    if (floor >= 20) kinds.push(rng.pick(zone.foes));
  } else {
    const count = Math.min(4, 1 + Math.floor(rng.range(0, 2)) + Math.min(2, Math.floor(floor / 9)));
    for (let index = 0; index < count; index += 1) kinds.push(rng.pick(zone.foes));
    if (elite) kinds[0] = zone.boss;
  }

  return kinds.map((kind, index) => makeFoe(kind, index, boss && index === 0 ? 'boss' : elite && index === 0 ? 'elite' : 'common', floor, danger, rng));
}

/** One foe, built the same way whether it walked in or was called for. */
export function makeFoe(
  kind: string,
  index: number,
  rank: 'common' | 'elite' | 'boss',
  floor: number,
  danger: number,
  rng: Rng,
): Combatant {
  const stats = foeStats(kind, floor, rank, danger);
  const foe: Combatant = {
    key: `foe:${index}:${kind}`,
    side: 'foe',
    sprite: kind,
    nameKey: `foe.${kind}`,
    rank,
    stats,
    hp: stats.maxHp,
    timer: rng.range(0, 0.9),
    abilityTimer: 999,
    guard: 0,
    alive: true,
    action: 'idle',
    actionUntil: 0,
  };

  if (rank === 'boss') {
    foe.wardMax = Math.round(stats.maxHp * KEEPER.ward);
    foe.ward = foe.wardMax;
    // How many times the ward has been raised so far.
    foe.wardTimer = 0;
    foe.raged = false;
    foe.summons = 0;
  }
  return foe;
}

function interval(combatant: Combatant): number {
  return BALANCE.attackInterval * (100 / Math.max(20, combatant.stats.speed));
}

function strike(attacker: Combatant, defender: Combatant, multiplier: number, rng: Rng, events: CombatEvent[]): void {
  const mitigation = 100 / (100 + defender.stats.defence);
  const critical = rng.chance(attacker.stats.crit);
  let damage = attacker.stats.attack * multiplier * mitigation * rng.range(0.9, 1.12);
  if (critical) damage *= BALANCE.critMultiplier;
  if (defender.guard > 0) damage *= 1 - HEROES.warden.ability.power;

  let dealt = Math.max(1, Math.round(damage));

  // A keeper's ward soaks the blow before its health ever hears about it.
  if (defender.ward && defender.ward > 0) {
    const soaked = Math.min(defender.ward, dealt);
    defender.ward -= soaked;
    dealt -= soaked;
    events.push({ kind: 'ward', key: defender.key, amount: soaked, from: attacker.key });
    if (dealt <= 0) return;
  }

  defender.hp -= dealt;
  events.push({ kind: critical ? 'crit' : 'hit', key: defender.key, amount: dealt, from: attacker.key });

  if (defender.hp <= 0) {
    defender.hp = 0;
    defender.alive = false;
    defender.action = 'down';
    events.push({ kind: 'down', key: defender.key, amount: 0 });
  } else if (defender.action !== 'attack') {
    defender.action = 'hurt';
    defender.actionUntil = 0.25;
  }
}

function pickTarget(candidates: Combatant[], rng: Rng, taunted: boolean): Combatant | null {
  const alive = candidates.filter((one) => one.alive);
  if (alive.length === 0) return null;
  if (!taunted) return alive[0];
  return rng.weighted(alive, (one) => (one.hero ? HEROES[one.hero].taunt : 1));
}

function useAbility(actor: Combatant, allies: Combatant[], foes: Combatant[], rng: Rng, events: CombatEvent[]): boolean {
  if (!actor.hero) return false;
  const shape = HEROES[actor.hero].ability;
  // Talents change what an ability does and how often, so the fighter carries
  // its own numbers rather than reading them back off the definition.
  const ability = { kind: shape.kind, power: actor.abilityPower ?? shape.power };
  if (actor.abilityTimer > 0) return false;

  switch (ability.kind) {
    case 'bulwark': {
      for (const ally of allies) if (ally.alive) ally.guard = BALANCE.guardWindow;
      events.push({ kind: 'guard', key: actor.key, amount: BALANCE.guardWindow });
      break;
    }
    case 'backstab': {
      // Finds whoever is closest to dropping and puts them down.
      const wounded = foes
        .filter((foe) => foe.alive)
        .sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp)[0];
      if (!wounded) return false;
      strike(actor, wounded, ability.power, rng, events);
      break;
    }
    case 'pierce': {
      const target = pickTarget(foes, rng, false);
      if (!target) return false;
      strike(actor, target, ability.power, rng, events);
      break;
    }
    case 'volley': {
      const targets = foes.filter((foe) => foe.alive);
      if (targets.length === 0) return false;
      for (const target of targets) strike(actor, target, ability.power, rng, events);
      break;
    }
    case 'mend': {
      const hurt = allies
        .filter((ally) => ally.alive && ally.hp < ally.stats.maxHp)
        .sort((a, b) => a.hp / a.stats.maxHp - b.hp / b.stats.maxHp)[0];
      if (!hurt) return false;
      const healed = Math.round(hurt.stats.maxHp * ability.power);
      hurt.hp = Math.min(hurt.stats.maxHp, hurt.hp + healed);
      events.push({ kind: 'heal', key: hurt.key, amount: healed, from: actor.key });
      break;
    }

    case 'rally': {
      // Somebody who has already gone down is worth more than somebody who is
      // merely hurt, and nobody else in the party can do this at all.
      const fallen = allies.find((ally) => !ally.alive && ally.hero);
      if (!fallen) return false;
      fallen.hp = Math.max(1, Math.round(fallen.stats.maxHp * ability.power));
      fallen.alive = true;
      fallen.action = 'idle';
      fallen.actionUntil = 0;
      fallen.timer = 0;
      events.push({ kind: 'heal', key: fallen.key, amount: fallen.hp, from: actor.key });
      break;
    }

    case 'fervour': {
      // Everything at once, and it is paid for out of the zealot's own hide.
      const targets = foes.filter((foe) => foe.alive);
      if (targets.length === 0) return false;
      for (const target of targets) strike(actor, target, ability.power, rng, events);
      const toll = Math.max(1, Math.round(actor.stats.maxHp * 0.08));
      actor.hp = Math.max(1, actor.hp - toll);
      events.push({ kind: 'hit', key: actor.key, amount: toll, from: actor.key });
      break;
    }

    case 'snare': {
      // Takes the speed out of the room for the rest of the encounter, which
      // is worth more against a crowd than any single blow.
      const caught = foes.filter((foe) => foe.alive && !foe.snared);
      if (caught.length === 0) return false;
      for (const foe of caught) {
        foe.snared = true;
        foe.stats = { ...foe.stats, speed: Math.max(20, Math.round(foe.stats.speed * (1 - ability.power))) };
      }
      events.push({ kind: 'guard', key: actor.key, amount: caught.length });
      break;
    }
  }

  actor.abilityTimer = actor.abilityCooldown ?? shape.cooldown;
  actor.action = 'attack';
  actor.actionUntil = 0.5;
  return true;
}

/** Advances one encounter. Returns events for the presentation layer. */
export function stepCombat(party: Combatant[], foes: Combatant[], dt: number, rng: Rng): CombatEvent[] {
  const events: CombatEvent[] = [];

  for (const side of [party, foes]) {
    for (const actor of side) {
      if (actor.actionUntil > 0) {
        actor.actionUntil -= dt;
        if (actor.actionUntil <= 0 && actor.alive) actor.action = 'idle';
      }
      if (!actor.alive) continue;
      if (actor.guard > 0) actor.guard = Math.max(0, actor.guard - dt);
      if (actor.abilityTimer > 0) actor.abilityTimer -= dt;

      actor.timer += dt;
      const wait = interval(actor);
      if (actor.timer < wait) continue;
      // Carrying the overshoot rather than dropping it is what makes the
      // resolver give the same answer at any step size. Zeroing it rounded
      // every swing up to the next tick, which cost a slow attacker a larger
      // share of its rate than a fast one, so replaying a night offline at a
      // coarser step quietly handed the fight to whoever swung fastest.
      actor.timer -= wait;

      const allies = actor.side === 'party' ? party : foes;
      const enemies = actor.side === 'party' ? foes : party;
      if (!enemies.some((one) => one.alive)) continue;

      if (useAbility(actor, allies, enemies, rng, events)) continue;

      const target = pickTarget(enemies, rng, actor.side === 'foe');
      if (!target) continue;
      strike(actor, target, 1, rng, events);
      actor.action = 'attack';
      actor.actionUntil = 0.45;
    }
  }

  return events;
}

export function encounterOver(party: Combatant[], foes: Combatant[]): 'won' | 'lost' | null {
  if (!foes.some((foe) => foe.alive)) return 'won';
  if (!party.some((hero) => hero.alive)) return 'lost';
  return null;
}

export function zoneIndexOf(id: string): number {
  return ZONES.findIndex((zone) => zone.id === id);
}

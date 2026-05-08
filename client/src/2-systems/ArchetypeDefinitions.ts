import { normalizeAvatarAppearance, type AvatarAppearance } from './gameplay/game/AvatarBuilder';
import type { SpawnLoadout } from './gameplay/game/GameModeSystem';
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  TROPICAL_HORROR_ARCHETYPE_IDS,
  TROPICAL_HORROR_ARCHETYPE_STORAGE_KEY,
  cloneTropicalHorrorArchetypeAppearance as cloneSharedTropicalHorrorArchetypeAppearance,
  getTropicalHorrorArchetype as getSharedTropicalHorrorArchetype,
  resolveTropicalHorrorArchetypeId,
  type TropicalHorrorArchetypeDefinition as SharedTropicalHorrorArchetypeDefinition,
  type TropicalHorrorArchetypeId,
  type TropicalHorrorDamageTheme,
  type TropicalHorrorHUDTheme,
} from '@shared/contracts';

export {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  TROPICAL_HORROR_ARCHETYPE_IDS,
  TROPICAL_HORROR_ARCHETYPE_STORAGE_KEY,
  resolveTropicalHorrorArchetypeId,
};
export type { TropicalHorrorArchetypeId, TropicalHorrorDamageTheme, TropicalHorrorHUDTheme };

export interface TropicalHorrorArchetypeDefinition extends Omit<SharedTropicalHorrorArchetypeDefinition, 'appearance'> {
  appearance: AvatarAppearance;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function cloneStartAmmo(startAmmo?: Record<string, { current: number; reserve: number }>): Record<string, { current: number; reserve: number }> | undefined {
  if (!startAmmo) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(startAmmo).map(([weaponId, ammo]) => [weaponId, { ...ammo }]),
  );
}

function toClientArchetypeDefinition(definition: SharedTropicalHorrorArchetypeDefinition): TropicalHorrorArchetypeDefinition {
  return {
    ...definition,
    appearance: normalizeAvatarAppearance(definition.appearance),
  };
}

export function cloneTropicalHorrorArchetypeAppearance(archetypeId: TropicalHorrorArchetypeId): AvatarAppearance {
  return normalizeAvatarAppearance(cloneSharedTropicalHorrorArchetypeAppearance(archetypeId));
}

export function listTropicalHorrorArchetypes(): TropicalHorrorArchetypeDefinition[] {
  return TROPICAL_HORROR_ARCHETYPE_IDS.map((id) => getTropicalHorrorArchetype(id));
}

export function getTropicalHorrorArchetype(archetypeId?: TropicalHorrorArchetypeId | null): TropicalHorrorArchetypeDefinition {
  return toClientArchetypeDefinition(getSharedTropicalHorrorArchetype(archetypeId));
}

export function persistTropicalHorrorArchetypeSelection(storage: StorageLike | null | undefined, archetypeId: TropicalHorrorArchetypeId): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(TROPICAL_HORROR_ARCHETYPE_STORAGE_KEY, archetypeId);
  } catch {
    // Ignore storage failures in restrictive browser contexts.
  }
}

export function resolveTropicalHorrorArchetypeSelection(search: string, storage?: StorageLike | null): TropicalHorrorArchetypeId {
  const params = new URLSearchParams(search);
  const queryCandidate = resolveTropicalHorrorArchetypeId(
    params.get('archetype') ?? params.get('class') ?? params.get('loadout'),
  );
  if (queryCandidate) {
    return queryCandidate;
  }

  const storageCandidate = resolveTropicalHorrorArchetypeId(
    storage?.getItem(TROPICAL_HORROR_ARCHETYPE_STORAGE_KEY) ?? null,
  );
  return storageCandidate ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
}

export function mergeSpawnLoadoutWithArchetype(baseLoadout: SpawnLoadout, archetypeId: TropicalHorrorArchetypeId): SpawnLoadout {
  const archetype = getTropicalHorrorArchetype(archetypeId);
  const preserveBaseWeapons = baseLoadout.weapons.length === 1 && baseLoadout.weapons[0] === 'pistol'
    ? []
    : baseLoadout.weapons;

  return {
    ...baseLoadout,
    weapons: uniqueStrings([...archetype.spawn.weapons, ...preserveBaseWeapons]),
    startAmmo: {
      ...(cloneStartAmmo(baseLoadout.startAmmo) ?? {}),
      ...(cloneStartAmmo(archetype.spawn.startAmmo) ?? {}),
    },
    maxHealth: archetype.stats.maxHealth,
    maxMana: archetype.stats.maxMana,
    maxShield: archetype.stats.maxShield,
    armor: archetype.stats.armor,
    moveSpeed: archetype.stats.moveSpeed,
    damageMultiplier: archetype.stats.damageMultiplier,
    attackSpeed: archetype.stats.attackSpeed,
    playerClass: archetype.stats.classLabel,
    archetypeId: archetype.id,
    appearance: cloneTropicalHorrorArchetypeAppearance(archetype.id),
    conditionTags: uniqueStrings([...(baseLoadout.conditionTags ?? []), ...archetype.spawn.conditionTags]),
  };
}
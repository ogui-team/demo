/**
 * PlayerStats.ts
 *
 * A fully-decorated runtime class that demonstrates the engine's Reflection &
 * Metadata System integrated with the GAS attribute layer.
 *
 * Decorators used
 * ───────────────
 *   @EngineClass     — registers the class in MetadataStore with a friendly name
 *   @EditorProperty  — exposes the field in the Details Panel with widget hints
 *   @Replicated      — marks the field for network-tick serialisation
 *   @SaveGame        — marks the field for save-file persistence
 *
 * Usage — Details Panel
 * ─────────────────────
 * ```ts
 * import { getEditorProperties, setEditorProperty } from '../../reflection';
 * import { PlayerStats } from './PlayerStats';
 *
 * const stats = new PlayerStats();
 * const props = getEditorProperties(stats);
 * // props is an array of { label, type, min, max, category, currentValue, … }
 * // Render each entry as a form control in the Details Panel.
 *
 * setEditorProperty(stats, 'maxHealth', 150);  // clamps to [50, 500]
 * ```
 *
 * Usage — Replication
 * ────────────────────
 * ```ts
 * import { getReplicatedState, applyReplicatedState } from '../../reflection';
 *
 * // Server → send to clients on every tick
 * const snapshot = getReplicatedState(stats);  // { health, maxHealth, mana, … }
 * ws.send(JSON.stringify(snapshot));
 *
 * // Client — on receive
 * applyReplicatedState(remoteStats, JSON.parse(msg));
 * ```
 *
 * Usage — Save/Load
 * ─────────────────
 * ```ts
 * import { getSaveGameState, applySaveGameState } from '../../reflection';
 *
 * const saved = getSaveGameState(stats);     // { level, xp, maxHealth, … }
 * localStorage.setItem('player', JSON.stringify(saved));
 *
 * const loaded = JSON.parse(localStorage.getItem('player')!);
 * applySaveGameState(stats, loaded);
 * ```
 */

import {
  EngineClass,
  EditorProperty,
  Replicated,
  SaveGame,
} from '../../../../0-foundation/reflection';
import {
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  getTropicalHorrorArchetype,
  TROPICAL_HORROR_ARCHETYPE_IDS,
  type TropicalHorrorArchetypeId,
} from '@engine/2-systems/ArchetypeDefinitions';

const DEFAULT_ARCHETYPE = getTropicalHorrorArchetype(DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID);

@EngineClass('Player Statistics')
export class PlayerStats {

  // ── Vitals ────────────────────────────────────────────────────────────────

  @EditorProperty({ type: 'number', label: 'Health', category: 'Vitals', min: 0, max: 500 })
  @Replicated()
  @SaveGame()
  health = DEFAULT_ARCHETYPE.stats.maxHealth;

  @EditorProperty({ type: 'number', label: 'Max Health', category: 'Vitals', min: 50, max: 500, step: 10 })
  @Replicated()
  @SaveGame()
  maxHealth = DEFAULT_ARCHETYPE.stats.maxHealth;

  @EditorProperty({ type: 'number', label: 'Mana', category: 'Vitals', min: 0, max: 300 })
  @Replicated()
  @SaveGame()
  mana = DEFAULT_ARCHETYPE.stats.maxMana;

  @EditorProperty({ type: 'number', label: 'Max Mana', category: 'Vitals', min: 0, max: 300, step: 10 })
  @Replicated()
  @SaveGame()
  maxMana = DEFAULT_ARCHETYPE.stats.maxMana;

  // ── Combat ────────────────────────────────────────────────────────────────

  @EditorProperty({ type: 'number', label: 'Damage ×', category: 'Combat', min: 0.1, max: 5.0, step: 0.05,
    tooltip: 'Global damage output multiplier (1.0 = base).' })
  @SaveGame()
  damageMultiplier = DEFAULT_ARCHETYPE.stats.damageMultiplier;

  @EditorProperty({ type: 'number', label: 'Attack Speed ×', category: 'Combat', min: 0.1, max: 3.0, step: 0.05 })
  @SaveGame()
  attackSpeed = DEFAULT_ARCHETYPE.stats.attackSpeed;

  @EditorProperty({ type: 'number', label: 'Armor', category: 'Combat', min: 0, max: 200 })
  @Replicated()
  @SaveGame()
  armor = DEFAULT_ARCHETYPE.stats.armor;

  // ── Movement ──────────────────────────────────────────────────────────────

  @EditorProperty({ type: 'number', label: 'Move Speed', category: 'Movement', min: 1, max: 30, step: 0.5,
    tooltip: 'Units per second.' })
  @Replicated()
  @SaveGame()
  moveSpeed = DEFAULT_ARCHETYPE.stats.moveSpeed;

  // ── Progression ───────────────────────────────────────────────────────────

  @EditorProperty({ type: 'number', label: 'Level', category: 'Progression', min: 1, max: 100, readOnly: true })
  @Replicated()
  @SaveGame()
  level = 1;

  @EditorProperty({ type: 'number', label: 'XP', category: 'Progression', min: 0 })
  @SaveGame()
  xp = 0;

  @EditorProperty({ type: 'enum', label: 'Class', category: 'Progression',
    enumValues: ['Soldier', 'Mage', 'Rogue', 'Necromancer'] })
  @SaveGame()
  playerClass: string = DEFAULT_ARCHETYPE.stats.classLabel;

  @EditorProperty({ type: 'enum', label: 'Archetype', category: 'Identity', enumValues: TROPICAL_HORROR_ARCHETYPE_IDS })
  @Replicated()
  @SaveGame()
  archetypeId: TropicalHorrorArchetypeId = DEFAULT_ARCHETYPE.id;

  @EditorProperty({ type: 'string', label: 'Archetype Title', category: 'Identity', readOnly: true })
  @SaveGame()
  archetypeName = DEFAULT_ARCHETYPE.displayName;

  // ── Identity ──────────────────────────────────────────────────────────────

  @EditorProperty({ type: 'string', label: 'Display Name', category: 'Identity' })
  @Replicated()
  displayName = 'Player';

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Apply damage, clamping at 0. */
  applyDamage(dmg: number): void {
    this.health = Math.max(0, this.health - dmg);
  }

  applyArchetype(archetypeId: TropicalHorrorArchetypeId, options: { displayName?: string } = {}): void {
    const archetype = getTropicalHorrorArchetype(archetypeId);
    this.archetypeId = archetype.id;
    this.archetypeName = archetype.displayName;
    this.maxHealth = archetype.stats.maxHealth;
    this.health = archetype.stats.maxHealth;
    this.maxMana = archetype.stats.maxMana;
    this.mana = archetype.stats.maxMana;
    this.damageMultiplier = archetype.stats.damageMultiplier;
    this.attackSpeed = archetype.stats.attackSpeed;
    this.armor = archetype.stats.armor;
    this.moveSpeed = archetype.stats.moveSpeed;
    this.playerClass = archetype.stats.classLabel;
    if (options.displayName) {
      this.displayName = options.displayName;
    }
  }

  /** Heal clamped to maxHealth. */
  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  get isAlive(): boolean {
    return this.health > 0;
  }
}

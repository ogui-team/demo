/**
 * PlayerAppearanceState.ts
 *
 * Replicated + editor-exposed appearance attributes for a player entity.
 * Mirrors the shape of AvatarAppearance so that the reflection system can
 * include colour and scale in network delta snapshots and save-game files.
 *
 * Decorators
 * ──────────
 *   @EngineClass    — registers the class in MetadataStore
 *   @EditorProperty — exposes fields in the Details Panel
 *   @Replicated     — marks fields for network-tick serialisation
 *   @SaveGame       — marks fields for save-file persistence
 *
 * Replication usage
 * ─────────────────
 * ```ts
 * import { getReplicatedState, applyReplicatedState } from '../../reflection';
 * import { PlayerAppearanceState } from './PlayerAppearanceState';
 *
 * // Sender — before broadcasting each delta:
 * const snapshot = getReplicatedState(appearanceState);
 * ws.send(JSON.stringify({ type: 'PLAYER_APPEARANCE', playerId, appearance: snapshot }));
 *
 * // Receiver — on incoming PLAYER_APPEARANCE message:
 * applyReplicatedState(remoteAppearanceState, incoming.appearance);
 * ```
 *
 * Valid ranges mirror the clamping applied in normalizeAvatarAppearance():
 *   scaleX  [0.10 – 1.60]
 *   scaleY  [0.10 – 1.50]
 *   scaleZ  [0.10 – 1.60]
 */

import {
  EngineClass,
  EditorProperty,
  Replicated,
  SaveGame,
} from '../../../../0-foundation/reflection';
import {
  cloneTropicalHorrorArchetypeAppearance,
  DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID,
  TROPICAL_HORROR_ARCHETYPE_IDS,
  type TropicalHorrorArchetypeId,
} from '@engine/2-systems/ArchetypeDefinitions';

import type { AvatarModelVariant, AvatarTextureStyle } from '../../game/AvatarBuilder';

const DEFAULT_ARCHETYPE_APPEARANCE = cloneTropicalHorrorArchetypeAppearance(DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID);

export const APPEARANCE_SCALE_MIN = 0.1;
export const APPEARANCE_SCALE_Y_MAX = 1.5;
export const APPEARANCE_SCALE_XZ_MAX = 1.6;

@EngineClass('Player Appearance')
export class PlayerAppearanceState {

  // ── Model ─────────────────────────────────────────────────────────────────

  @EditorProperty({
    type: 'enum',
    label: 'Archetype',
    category: 'Appearance',
    enumValues: TROPICAL_HORROR_ARCHETYPE_IDS,
  })
  @Replicated()
  @SaveGame()
  archetypeId: TropicalHorrorArchetypeId = DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;

  @EditorProperty({
    type: 'enum',
    label: 'Model Variant',
    category: 'Appearance',
    enumValues: ['operator', 'scout', 'heavy'],
  })
  @Replicated()
  @SaveGame()
  modelVariant: AvatarModelVariant = DEFAULT_ARCHETYPE_APPEARANCE.modelVariant;

  @EditorProperty({
    type: 'enum',
    label: 'Texture Style',
    category: 'Appearance',
    enumValues: ['flat', 'checker', 'stripes', 'digital'],
  })
  @Replicated()
  @SaveGame()
  textureStyle: AvatarTextureStyle = DEFAULT_ARCHETYPE_APPEARANCE.textureStyle;

  // ── Colour ────────────────────────────────────────────────────────────────

  /**
   * Body / torso colour as a 24-bit hex integer (e.g. 0xffff00 = yellow).
   * Default matches AvatarBuilder.DEFAULT_APPEARANCE so a fresh player is
   * always yellow, never the old "blue" palette slot.
   */
  @EditorProperty({
    type: 'number',
    label: 'Body Color (hex)',
    category: 'Appearance',
    min: 0,
    max: 0xffffff,
    tooltip: '24-bit hex colour integer for torso and arms.',
  })
  @Replicated()
  @SaveGame()
  bodyColor: number = DEFAULT_ARCHETYPE_APPEARANCE.bodyColor;

  @EditorProperty({
    type: 'number',
    label: 'Accent Color (hex)',
    category: 'Appearance',
    min: 0,
    max: 0xffffff,
  })
  @Replicated()
  @SaveGame()
  accentColor: number = DEFAULT_ARCHETYPE_APPEARANCE.accentColor;

  @EditorProperty({
    type: 'number',
    label: 'Skin Color (hex)',
    category: 'Appearance',
    min: 0,
    max: 0xffffff,
    tooltip: '24-bit hex colour integer for the head mesh.',
  })
  @Replicated()
  @SaveGame()
  skinColor: number = DEFAULT_ARCHETYPE_APPEARANCE.skinColor;

  @EditorProperty({
    type: 'number',
    label: 'Leg Color (hex)',
    category: 'Appearance',
    min: 0,
    max: 0xffffff,
  })
  @Replicated()
  @SaveGame()
  legColor: number = DEFAULT_ARCHETYPE_APPEARANCE.legColor;

  // ── Scale ─────────────────────────────────────────────────────────────────

  /**
   * X-axis scale multiplier applied to the avatar group.
   * Clamped to [0.10, 1.60] — same range as AvatarBuilder.normalizeAvatarAppearance().
   */
  @EditorProperty({
    type: 'number',
    label: 'Scale X',
    category: 'Appearance',
    min: APPEARANCE_SCALE_MIN,
    max: APPEARANCE_SCALE_XZ_MAX,
    step: 0.01,
    tooltip: 'Avatar X scale multiplier [0.10–1.60].',
  })
  @Replicated()
  @SaveGame()
  scaleX: number = DEFAULT_ARCHETYPE_APPEARANCE.scaleX;

  /**
   * Y-axis scale multiplier applied to the avatar group.
   * Clamped to [0.10, 1.50].
   */
  @EditorProperty({
    type: 'number',
    label: 'Scale Y',
    category: 'Appearance',
    min: APPEARANCE_SCALE_MIN,
    max: APPEARANCE_SCALE_Y_MAX,
    step: 0.01,
    tooltip: 'Avatar Y scale multiplier [0.10–1.50].',
  })
  @Replicated()
  @SaveGame()
  scaleY: number = DEFAULT_ARCHETYPE_APPEARANCE.scaleY;

  /**
   * Z-axis scale multiplier applied to the avatar group.
   * Clamped to [0.10, 1.60].
   */
  @EditorProperty({
    type: 'number',
    label: 'Scale Z',
    category: 'Appearance',
    min: APPEARANCE_SCALE_MIN,
    max: APPEARANCE_SCALE_XZ_MAX,
    step: 0.01,
    tooltip: 'Avatar Z scale multiplier [0.10–1.60].',
  })
  @Replicated()
  @SaveGame()
  scaleZ: number = DEFAULT_ARCHETYPE_APPEARANCE.scaleZ;

  applyArchetype(archetypeId: TropicalHorrorArchetypeId): void {
    const appearance = cloneTropicalHorrorArchetypeAppearance(archetypeId);
    this.archetypeId = archetypeId;
    this.modelVariant = appearance.modelVariant;
    this.textureStyle = appearance.textureStyle;
    this.bodyColor = appearance.bodyColor;
    this.accentColor = appearance.accentColor;
    this.skinColor = appearance.skinColor;
    this.legColor = appearance.legColor;
    this.scaleX = appearance.scaleX;
    this.scaleY = appearance.scaleY;
    this.scaleZ = appearance.scaleZ;
  }
}

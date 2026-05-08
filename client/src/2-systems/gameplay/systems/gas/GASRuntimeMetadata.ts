/**
 * GASRuntimeMetadata.ts
 *
 * Reflection-ready metadata carrier for new GAS runtime channels.
 *
 * This class is intentionally lightweight and serialisable so editor panels,
 * replication payload builders, and save/load snapshots can reuse the same
 * decorated fields.
 */

import {
  EngineClass,
  EditorProperty,
  Replicated,
  SaveGame,
} from '../../../../0-foundation/reflection';

@EngineClass('GAS Runtime Channels')
export class GASRuntimeMetadata {
  @EditorProperty({ type: 'string', label: 'Active Ability', category: 'Ability' })
  @Replicated()
  activeAbilityId = '';

  @EditorProperty({ type: 'string', label: 'Cooldown Groups', category: 'Ability',
    tooltip: 'Comma-separated active cooldown group names.' })
  @Replicated()
  @SaveGame()
  cooldownGroups = '';

  @EditorProperty({ type: 'string', label: 'Current Game Mode', category: 'Mode' })
  @Replicated()
  @SaveGame()
  activeGameMode = 'freeplay';

  @EditorProperty({ type: 'number', label: 'Health Channel', category: 'Vitals', min: 0, max: 9999 })
  @Replicated()
  @SaveGame()
  healthChannel = 100;

  @EditorProperty({ type: 'number', label: 'Shield Channel', category: 'Vitals', min: 0, max: 9999 })
  @Replicated()
  @SaveGame()
  shieldChannel = 0;

  @EditorProperty({ type: 'string', label: 'Summon Context', category: 'Summons',
    tooltip: 'pet, minion, totem, etc.' })
  @SaveGame()
  summonContext = 'minion';
}

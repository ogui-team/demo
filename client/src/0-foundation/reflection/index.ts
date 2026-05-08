/**
 * Reflection system barrel export.
 *
 * Import everything from here:
 * ```ts
 * import { EngineClass, EditorProperty, Replicated, SaveGame, getEditorProperties } from '../reflection';
 * ```
 */

export type {
  EditorPropertyType,
  EditorPropertyOptions,
  IPropertyMetadata,
  IClassMetadata,
} from './ReflectionSystem';

export { MetadataStore } from './ReflectionSystem';

export {
  EngineClass,
  EditorProperty,
  Replicated,
  SaveGame,
} from './Decorators';

export type {
  EditorPropertyValue,
  EditorPropertyCategory,
} from './SerializationUtils';

export {
  getEditorProperties,
  getEditorPropertiesByCategory,
  setEditorProperty,
  getReplicatedState,
  applyReplicatedState,
  getSaveGameState,
  applySaveGameState,
} from './SerializationUtils';

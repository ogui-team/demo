/**
 * Decorators.ts
 *
 * TypeScript class and property decorators for the engine reflection system.
 *
 * Decorators write metadata into `MetadataStore` at class-definition time
 * (before `main()` runs).  They have zero runtime cost after that.
 *
 * Requires `experimentalDecorators: true` and
 *           `emitDecoratorMetadata: true` in tsconfig.json.
 *
 * Usage:
 * ```ts
 * @EngineClass('Player Attributes')
 * class PlayerAttributes {
 *   @EditorProperty({ type: 'number', min: 0, max: 500, category: 'Combat' })
 *   @Replicated()
 *   @SaveGame()
 *   maxHealth = 100;
 *
 *   @EditorProperty({ type: 'number', min: 0.1, max: 5, step: 0.1 })
 *   damageMultiplier = 1.0;
 * }
 * ```
 */

import {
  MetadataStore,
  type EditorPropertyOptions,
} from './ReflectionSystem';

// ── Class decorator ───────────────────────────────────────────────────────────

/**
 * `@EngineClass(friendlyName?)`
 *
 * Registers a class with the `MetadataStore` under its constructor name.
 * If `friendlyName` is omitted the class name is used as the display string.
 *
 * @example
 * ```ts
 * @EngineClass('Enemy Grunt')
 * class EnemyGrunt { ... }
 * ```
 */
export function EngineClass(friendlyName?: string): ClassDecorator {
  // eslint-disable-next-line @typescript-eslint/ban-types
  return (target: Function): void => {
    const className = target.name;
    MetadataStore.registerClass(className, friendlyName ?? className);
  };
}

// ── Property decorators ───────────────────────────────────────────────────────

/**
 * `@EditorProperty(options)`
 *
 * Marks a property as visible in the engine's Details Panel and provides
 * widget hints (type, min/max, enum values, etc.).
 *
 * Multiple decorators on the same property are merged, so you can combine
 * `@EditorProperty`, `@Replicated`, and `@SaveGame` freely.
 *
 * @example
 * ```ts
 * @EditorProperty({ type: 'number', min: 0, max: 200, label: 'Max Health', category: 'Vitals' })
 * maxHealth = 100;
 * ```
 */
export function EditorProperty(options: EditorPropertyOptions = {}): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key       = String(propertyKey);
    const className = target.constructor.name;
    MetadataStore.registerProperty(className, key, {
      editorVisible: true,
      type:          options.type       ?? 'number',
      label:         options.label      ?? key,
      category:      options.category   ?? 'General',
      min:           options.min,
      max:           options.max,
      step:          options.step,
      enumValues:    options.enumValues,
      tooltip:       options.tooltip,
      readOnly:      options.readOnly   ?? false,
    });
  };
}

/**
 * `@Replicated()`
 *
 * Marks a property for inclusion in network-replication snapshots.
 * `SerializationUtils.getReplicatedState(instance)` collects only these.
 *
 * Keep the set small — this is called on every network tick.
 *
 * @example
 * ```ts
 * @Replicated()
 * health = 100;
 * ```
 */
export function Replicated(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key       = String(propertyKey);
    const className = target.constructor.name;
    MetadataStore.registerProperty(className, key, { replicated: true });
  };
}

/**
 * `@SaveGame()`
 *
 * Marks a property for inclusion in save-file serialization.
 * `SerializationUtils.getSaveGameState(instance)` collects these.
 *
 * @example
 * ```ts
 * @SaveGame()
 * level = 1;
 * ```
 */
export function SaveGame(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const key       = String(propertyKey);
    const className = target.constructor.name;
    MetadataStore.registerProperty(className, key, { saveGame: true });
  };
}

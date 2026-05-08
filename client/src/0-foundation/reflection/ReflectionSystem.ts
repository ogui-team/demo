/**
 * ReflectionSystem.ts
 *
 * Central metadata registry — modelled after Unreal's UObject / UPROPERTY system.
 *
 * At compile-time, `@EngineClass`, `@EditorProperty`, `@Replicated`, and
 * `@SaveGame` decorators write into this store.  At runtime, editor tooling,
 * network replication helpers, and the save/load system all read from it.
 *
 * Zero runtime dependencies.  Import freely everywhere.
 */

import { gameBus } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities } from '@engine/1-kernel/core/public-api';

// ── Public type aliases ───────────────────────────────────────────────────────

/** Every supported editor-widget type. */
export type EditorPropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'Vector3'
  | 'Color'
  | 'AssetKey'
  | 'enum';

/** Options accepted by `@EditorProperty`. */
export interface EditorPropertyOptions {
  /** Widget type; defaults to `'number'`. */
  type?:        EditorPropertyType;
  /** Human-readable label shown in the Details Panel. */
  label?:       string;
  /** Collapsible category in the Details Panel. */
  category?:    string;
  /** Minimum numeric value (number widgets). */
  min?:         number;
  /** Maximum numeric value (number widgets). */
  max?:         number;
  /** Slider step size. */
  step?:        number;
  /** String options for enum / select widgets. */
  enumValues?:  string[];
  /** Tooltip shown on hover. */
  tooltip?:     string;
  /** Whether the property is read-only in the editor. */
  readOnly?:    boolean;
}

// ── Metadata interfaces ───────────────────────────────────────────────────────

/**
 * Per-property metadata record stored in the registry.
 * A property can be tagged with any combination of editor-visible,
 * replicated, and savegame flags.
 */
export interface IPropertyMetadata {
  /** Name of the class that owns this property. */
  className:    string;
  /** Actual JavaScript property key. */
  propertyKey:  string;

  // ── EditorProperty flags ────────────────────────────────────────────────
  editorVisible:  boolean;
  type:           EditorPropertyType;
  label:          string;
  category:       string;
  min?:           number;
  max?:           number;
  step?:          number;
  enumValues?:    string[];
  tooltip?:       string;
  readOnly:       boolean;

  // ── Replication flag ────────────────────────────────────────────────────
  /** Whether this property is included in network-replication snapshots. */
  replicated:   boolean;

  // ── SaveGame flag ───────────────────────────────────────────────────────
  /** Whether this property is persisted in save files. */
  saveGame:     boolean;
}

/** Per-class metadata record stored in the registry. */
export interface IClassMetadata {
  /** Canonical JavaScript class name. */
  className:    string;
  /** Human-friendly display name (fallback: `className`). */
  friendlyName: string;
  /** All registered properties, keyed by property key. */
  properties:   Map<string, IPropertyMetadata>;
}

// ── MetadataStore ─────────────────────────────────────────────────────────────

/**
 * Global runtime metadata registry.
 *
 * All methods are static so there is exactly one store per application.
 * Decorator callbacks write here at class-definition time (before `main()`).
 */
export class MetadataStore {
  private static readonly classes = new Map<string, IClassMetadata>();

  static getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: true,
      usesSystemContext: false,
      usesNetworkFacade: false,
    };
  }

  static getDebugState(): Record<string, unknown> {
    const classes = MetadataStore.getAllClasses();
    return {
      status: 'active',
      active: true,
      metrics: {
        classCount: classes.length,
        propertyCount: classes.reduce((count, entry) => count + entry.properties.size, 0),
        sampleClasses: classes.slice(0, 12).map((entry) => entry.className),
      },
    };
  }

  // ── Class registration ──────────────────────────────────────────────────

  /**
   * Register a class with an optional friendly name.
   * Called by `@EngineClass`.
   */
  static registerClass(className: string, friendlyName: string): void {
    gameBus.emit('stateMutation', {
      source: 'metadataStore',
      path: `reflection.classes.${className}`,
      changedCount: 1,
    });
    const existing = MetadataStore.classes.get(className);
    if (existing) {
      existing.friendlyName = friendlyName;
    } else {
      MetadataStore.classes.set(className, {
        className,
        friendlyName,
        properties: new Map(),
      });
    }
  }

  /**
   * Return the metadata record for `className`, creating a stub if it does
   * not yet exist.  Property decorators call this so they can register
   * before the class decorator fires.
   */
  static ensureClass(className: string): IClassMetadata {
    let meta = MetadataStore.classes.get(className);
    if (!meta) {
      meta = { className, friendlyName: className, properties: new Map() };
      MetadataStore.classes.set(className, meta);
    }
    return meta;
  }

  /** Retrieve the metadata for `className`, or `undefined` if not found. */
  static getClass(className: string): IClassMetadata | undefined {
    return MetadataStore.classes.get(className);
  }

  /** Array of all registered classes (snapshot — safe to iterate). */
  static getAllClasses(): IClassMetadata[] {
    return [...MetadataStore.classes.values()];
  }

  // ── Property registration ───────────────────────────────────────────────

  /**
   * Register (or update) a property metadata record.
   * Merges with any previously registered data for the same property so
   * multiple decorators on one property compose cleanly.
   */
  static registerProperty(
    className:   string,
    propertyKey: string,
    partial:     Partial<IPropertyMetadata>,
  ): void {
    gameBus.emit('stateMutation', {
      source: 'metadataStore',
      path: `reflection.properties.${className}.${propertyKey}`,
      changedCount: 1,
    });
    const cls         = MetadataStore.ensureClass(className);
    const existing    = cls.properties.get(propertyKey);
    const defaults: IPropertyMetadata = {
      className,
      propertyKey,
      editorVisible:  false,
      type:           'number',
      label:          propertyKey,
      category:       'General',
      readOnly:       false,
      replicated:     false,
      saveGame:       false,
    };
    cls.properties.set(propertyKey, { ...defaults, ...existing, ...partial });
  }

  /**
   * Retrieve metadata for a single property, or `undefined` when not found.
   */
  static getProperty(
    className:   string,
    propertyKey: string,
  ): IPropertyMetadata | undefined {
    return MetadataStore.classes.get(className)?.properties.get(propertyKey);
  }

  /**
   * Return all properties for `className` that satisfy a predicate.
   * Convenience helper used by SerializationUtils.
   */
  static getPropertiesWhere(
    className: string,
    predicate: (p: IPropertyMetadata) => boolean,
  ): IPropertyMetadata[] {
    const cls = MetadataStore.classes.get(className);
    if (!cls) return [];
    return [...cls.properties.values()].filter(predicate);
  }
}

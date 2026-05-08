/**
 * SerializationUtils.ts
 *
 * Runtime helpers that consume the `MetadataStore` to drive:
 *
 *   • The editor Details Panel  — `getEditorProperties` / `setEditorProperty`
 *   • Network replication       — `getReplicatedState` / `applyReplicatedState`
 *   • Save-file serialization   — `getSaveGameState`   / `applySaveGameState`
 *
 * All functions are pure utilities (no class, no singleton) so they can be
 * tree-shaken independently by the bundler.
 */

import { MetadataStore, type IPropertyMetadata } from './ReflectionSystem';

// ── Editor Details Panel ──────────────────────────────────────────────────────

/**
 * A property descriptor enriched with the *current* live value from an
 * instance — ready to hydrate a Details Panel widget.
 */
export interface EditorPropertyValue extends IPropertyMetadata {
  currentValue: unknown;
}

/** Grouped editor metadata by category label for sectioned details UIs. */
export interface EditorPropertyCategory {
  category: string;
  properties: EditorPropertyValue[];
}

/**
 * Return all `@EditorProperty`-tagged properties on `instance`, each paired
 * with its current value.
 *
 * @example
 * ```ts
 * const props = getEditorProperties(enemy);
 * for (const p of props) {
 *   console.log(p.label, '=', p.currentValue);
 * }
 * ```
 */
export function getEditorProperties(instance: object): EditorPropertyValue[] {
  const className = instance.constructor.name;
  const props     = MetadataStore.getPropertiesWhere(
    className,
    (p) => p.editorVisible,
  );
  const rec = instance as Record<string, unknown>;
  return props.map((p) => ({
    ...p,
    currentValue: rec[p.propertyKey],
  }));
}

/**
 * Return editor properties grouped by category while preserving declaration
 * order inside each category.
 */
export function getEditorPropertiesByCategory(instance: object): EditorPropertyCategory[] {
  const grouped = new Map<string, EditorPropertyValue[]>();
  const props = getEditorProperties(instance);

  for (const prop of props) {
    const key = prop.category || 'General';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(prop);
  }

  return [...grouped.entries()].map(([category, properties]) => ({
    category,
    properties,
  }));
}

/**
 * Apply a new value to an `@EditorProperty` on `instance`.
 *
 * Performs basic type coercion:
 *   - `'number'` → `Number(value)`
 *   - `'boolean'` → `Boolean(value)`
 *   - everything else → `value` as-is
 *
 * Throws if the property is marked `readOnly`.
 */
export function setEditorProperty(
  instance:    object,
  propertyKey: string,
  value:       unknown,
): void {
  const className = instance.constructor.name;
  const meta      = MetadataStore.getProperty(className, propertyKey);

  if (!meta) {
    console.warn(
      `[SerializationUtils] setEditorProperty: property "${propertyKey}" ` +
      `is not registered for class "${className}".`,
    );
    return;
  }

  if (meta.readOnly) {
    throw new Error(
      `[SerializationUtils] Property "${propertyKey}" on "${className}" is read-only.`,
    );
  }

  let coerced: unknown = value;
  if (meta.type === 'number') {
    const n = Number(value);
    coerced = isNaN(n) ? 0 : (
      meta.min !== undefined ? Math.max(meta.min, meta.max !== undefined ? Math.min(meta.max, n) : n) : n
    );
  } else if (meta.type === 'boolean') {
    coerced = Boolean(value);
  }

  (instance as Record<string, unknown>)[propertyKey] = coerced;
}

// ── Network Replication ───────────────────────────────────────────────────────

/**
 * Collect all `@Replicated`-tagged property values from `instance` into a
 * plain JSON-serialisable object.
 *
 * This is called on **every network tick** — keep the set of replicated
 * properties small.
 *
 * @example
 * ```ts
 * // Server → broadcast to connected clients
 * const state = getReplicatedState(player);
 * ws.send(JSON.stringify(state));
 * ```
 */
export function getReplicatedState(instance: object): Record<string, unknown> {
  const className = instance.constructor.name;
  const props     = MetadataStore.getPropertiesWhere(
    className,
    (p) => p.replicated,
  );
  const rec = instance as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const p of props) {
    out[p.propertyKey] = rec[p.propertyKey];
  }
  return out;
}

/**
 * Apply a replicated-state snapshot to `instance`.
 * Only properties that are actually `@Replicated` are updated — unknown keys
 * are silently ignored so stale / extended server payloads are safe.
 *
 * @example
 * ```ts
 * // Client — on receiving a server update
 * applyReplicatedState(remotePlayer, JSON.parse(msg));
 * ```
 */
export function applyReplicatedState(
  instance: object,
  state:    Record<string, unknown>,
): void {
  const className = instance.constructor.name;
  const props     = MetadataStore.getPropertiesWhere(
    className,
    (p) => p.replicated,
  );
  const rec = instance as Record<string, unknown>;
  for (const p of props) {
    if (Object.prototype.hasOwnProperty.call(state, p.propertyKey)) {
      rec[p.propertyKey] = state[p.propertyKey];
    }
  }
}

// ── Save-file Serialization ───────────────────────────────────────────────────

/**
 * Collect all `@SaveGame`-tagged property values into a plain object suitable
 * for JSON serialization.
 */
export function getSaveGameState(instance: object): Record<string, unknown> {
  const className = instance.constructor.name;
  const props     = MetadataStore.getPropertiesWhere(
    className,
    (p) => p.saveGame,
  );
  const rec = instance as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const p of props) {
    out[p.propertyKey] = rec[p.propertyKey];
  }
  return out;
}

/**
 * Apply a saved-state snapshot back onto `instance`.
 * Only `@SaveGame`-tagged properties are touched.
 */
export function applySaveGameState(
  instance: object,
  state:    Record<string, unknown>,
): void {
  const className = instance.constructor.name;
  const props     = MetadataStore.getPropertiesWhere(
    className,
    (p) => p.saveGame,
  );
  const rec = instance as Record<string, unknown>;
  for (const p of props) {
    if (Object.prototype.hasOwnProperty.call(state, p.propertyKey)) {
      rec[p.propertyKey] = state[p.propertyKey];
    }
  }
}

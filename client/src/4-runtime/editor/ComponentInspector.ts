import {
  Entity,
  gameBus,
  type EditorComponentPathSegment,
  type EditorEntitySelectionPayload,
  type EditorEntityTransformSnapshot,
  type SystemCapabilities,
  type SystemContext,
} from '@engine/1-kernel/core/public-api';

interface SelectionSystemAdapter {
  onSelect(callback: (entityId: string) => void): () => void;
  onDeselect(callback: (entityId: string) => void): () => void;
  getSelected?(): string | null;
}

interface EntityManagerAdapter {
  getEntity(entityId: string): Entity | null | undefined;
}

interface EntityRendererAdapter {
  syncEntity?(entity: Entity): void;
}

export interface ComponentInspectorConfig {
  selectionSystem: SelectionSystemAdapter;
  entityManager: EntityManagerAdapter;
  enableLogging?: boolean;
}

type EditableSource = 'ui' | 'editor_inspector' | 'system';

export class ComponentInspector {
  private selectionSystem: SelectionSystemAdapter;
  private entityManager: EntityManagerAdapter;
  private readonly enableLogging: boolean;
  private readonly lifecycleDisposers: Array<() => void> = [];
  private systemContext: SystemContext | null = null;
  private selectedEntityId: string | null = null;

  constructor(config: ComponentInspectorConfig) {
    this.selectionSystem = config.selectionSystem;
    this.entityManager = config.entityManager;
    this.enableLogging = config.enableLogging ?? false;

    this.lifecycleDisposers.push(
      this.selectionSystem.onSelect((entityId) => this.handleSelection(entityId)),
      this.selectionSystem.onDeselect(() => this.handleDeselection()),
      gameBus.on('EDITOR_UPDATE_COMPONENT', (payload) => {
        this.handleComponentUpdate(
          payload.entityId,
          payload.componentName,
          payload.path,
          payload.value,
          payload.source ?? 'editor_inspector',
        );
      }),
      gameBus.on('ENGINE_RESET', () => this.handleDeselection()),
      gameBus.on('ROUND_TRANSITION', () => this.handleDeselection()),
    );

    const initialSelection = this.selectionSystem.getSelected?.() ?? null;
    if (initialSelection) {
      this.handleSelection(initialSelection);
    }
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.entityManager = (ctx.entityManager as EntityManagerAdapter | undefined) ?? this.entityManager;
    this.selectionSystem = (ctx.systems.selectionSystem as SelectionSystemAdapter | undefined) ?? this.selectionSystem;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  destroy(): void {
    while (this.lifecycleDisposers.length > 0) {
      this.lifecycleDisposers.pop()?.();
    }
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,
      usesReplication: false,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: false,
    };
  }

  update(_dt: number): void {
    // Selection publishing is event-driven; no per-frame work required.
  }

  getDebugState(): Record<string, unknown> {
    const entity = this.selectedEntityId ? this.entityManager.getEntity(this.selectedEntityId) : null;
    return {
      status: this.selectedEntityId ? 'selected' : 'idle',
      active: true,
      metrics: {
        selectedEntityId: this.selectedEntityId,
        selectedEntityType: entity?.type ?? null,
        componentCount: entity?.getComponents().length ?? 0,
        hasSystemContext: this.systemContext !== null,
      },
    };
  }

  getSelectedEntityId(): string | null {
    return this.selectedEntityId;
  }

  publishCurrentSelection(): boolean {
    if (!this.selectedEntityId) return false;
    return this.handleSelection(this.selectedEntityId);
  }

  private handleSelection(entityId: string): boolean {
    const entity = this.entityManager.getEntity(entityId);
    if (!entity) {
      this.handleDeselection();
      return false;
    }

    this.selectedEntityId = entity.id;
    const payload = this.buildSelectionPayload(entity);
    gameBus.emit('EDITOR_ENTITY_SELECTED', payload);
    this.log(`Published selection for ${entity.id}`);
    return true;
  }

  private handleDeselection(): void {
    const previousSelection = this.selectedEntityId;
    this.selectedEntityId = null;
    gameBus.emit('EDITOR_ENTITY_DESELECTED', {
      entityId: previousSelection,
      timestamp: Engine.time.now(),
    });
  }

  private buildSelectionPayload(entity: Entity): EditorEntitySelectionPayload {
    return {
      entityId: entity.id,
      entityType: entity.type,
      transform: this.readTransform(entity),
      components: entity.getComponents().map((component) => ({
        name: component.name,
        data: normalizeEditorValue(component.data),
      })),
      selectedAt: Engine.time.now(),
    };
  }

  private readTransform(entity: Entity): EditorEntityTransformSnapshot {
    return {
      position: entity.getPosition(),
      rotation: entity.getRotation(),
      scale: entity.getScale(),
    };
  }

  private handleComponentUpdate(
    entityId: string,
    componentName: string,
    path: EditorComponentPathSegment[] | string,
    nextValue: unknown,
    source: EditableSource,
  ): boolean {
    const entity = this.entityManager.getEntity(entityId);
    const normalizedPath = normalizeEditorPath(path);
    if (!entity) {
      this.emitUpdateFailed(entityId, componentName, normalizedPath, 'Entity not found', source);
      return false;
    }

    const component = entity.getComponent(componentName);
    if (!component) {
      this.emitUpdateFailed(entityId, componentName, normalizedPath, 'Component not found', source);
      return false;
    }

    if (this.tryApplySpecialCase(entity, componentName, normalizedPath, nextValue, source)) {
      return true;
    }

    const result = applyComponentValue(component, normalizedPath, nextValue);
    if (!result.ok) {
      this.emitUpdateFailed(entityId, componentName, normalizedPath, result.reason, source);
      return false;
    }

    entity.touch();
    this.syncEntity(entity);
    this.emitUpdateSucceeded(entity, componentName, normalizedPath, result.previousValue, result.nextValue, source);
    return true;
  }

  private tryApplySpecialCase(
    entity: Entity,
    componentName: string,
    path: EditorComponentPathSegment[],
    nextValue: unknown,
    source: EditableSource,
  ): boolean {
    if (componentName !== 'ai' || path.length !== 1 || path[0] !== 'state' || typeof nextValue !== 'string') {
      return false;
    }

    const previousValue = normalizeEditorValue(entity.getComponent(componentName)?.data?.state);
    gameBus.emit('AI_BEHAVIOR_STATE_SET_REQUESTED', {
      entityId: entity.id,
      state: nextValue,
      source: 'editor_inspector',
    });

    entity.touch();
    this.syncEntity(entity);
    this.emitUpdateSucceeded(entity, componentName, path, previousValue, nextValue, source);
    return true;
  }

  private syncEntity(entity: Entity): void {
    const entityRenderer = this.systemContext?.systems.entityRenderer as EntityRendererAdapter | undefined;
    entityRenderer?.syncEntity?.(entity);
  }

  private emitUpdateSucceeded(
    entity: Entity,
    componentName: string,
    path: EditorComponentPathSegment[],
    previousValue: unknown,
    nextValue: unknown,
    source: EditableSource,
  ): void {
    gameBus.emit('EDITOR_COMPONENT_UPDATED', {
      entityId: entity.id,
      componentName,
      path,
      previousValue,
      value: nextValue,
      source,
      timestamp: Engine.time.now(),
    });

    gameBus.emit('stateMutation', {
      source: 'ComponentInspector',
      path: formatMutationPath(entity.id, componentName, path),
      changedCount: 1,
    });

    if (this.selectedEntityId === entity.id) {
      this.handleSelection(entity.id);
    }
  }

  private emitUpdateFailed(
    entityId: string,
    componentName: string,
    path: EditorComponentPathSegment[],
    reason: string,
    source: EditableSource,
  ): void {
    gameBus.emit('EDITOR_COMPONENT_UPDATE_FAILED', {
      entityId,
      componentName,
      path,
      reason,
      source,
      timestamp: Engine.time.now(),
    });
  }

  private log(message: string): void {
    if (!this.enableLogging) return;
    console.log(`[ComponentInspector] ${message}`);
  }
}

function formatMutationPath(entityId: string, componentName: string, path: EditorComponentPathSegment[]): string {
  if (path.length === 0) {
    return `entities.${entityId}.components.${componentName}`;
  }
  const suffix = path
    .map((segment) => (typeof segment === 'number' ? `[${segment}]` : `.${segment}`))
    .join('');
  return `entities.${entityId}.components.${componentName}${suffix}`;
}

function normalizeEditorPath(path: EditorComponentPathSegment[] | string): EditorComponentPathSegment[] {
  if (Array.isArray(path)) {
    return path.slice();
  }

  const trimmed = path.trim();
  if (!trimmed) return [];

  return trimmed
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function applyComponentValue(
  component: { data: Record<string, any> },
  path: EditorComponentPathSegment[],
  rawValue: unknown,
): { ok: true; previousValue: unknown; nextValue: unknown } | { ok: false; reason: string } {
  const nextValue = cloneWritableValue(rawValue);

  if (path.length === 0) {
    if (!isPlainObject(nextValue)) {
      return { ok: false, reason: 'Root component updates require an object payload' };
    }
    const previousValue = normalizeEditorValue(component.data);
    component.data = nextValue as Record<string, any>;
    return { ok: true, previousValue, nextValue: normalizeEditorValue(component.data) };
  }

  let target: any = component.data;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];

    if (Array.isArray(target)) {
      if (typeof segment !== 'number') {
        return { ok: false, reason: `Invalid array access at segment ${String(segment)}` };
      }
      if (target[segment] == null) {
        target[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      if (typeof target[segment] !== 'object') {
        return { ok: false, reason: `Cannot descend into non-object value at index ${segment}` };
      }
      target = target[segment];
      continue;
    }

    if (!isObjectLike(target)) {
      return { ok: false, reason: `Cannot descend into non-object segment ${String(segment)}` };
    }

    const key = String(segment);
    if (target[key] == null) {
      target[key] = typeof nextSegment === 'number' ? [] : {};
    }
    if (!isObjectLike(target[key])) {
      return { ok: false, reason: `Cannot descend into non-object value at key ${key}` };
    }
    target = target[key];
  }

  const leaf = path[path.length - 1];
  if (Array.isArray(target)) {
    if (typeof leaf !== 'number') {
      return { ok: false, reason: `Invalid array leaf access at segment ${String(leaf)}` };
    }
    const previousValue = normalizeEditorValue(target[leaf]);
    target[leaf] = nextValue;
    return { ok: true, previousValue, nextValue: normalizeEditorValue(target[leaf]) };
  }

  if (!isObjectLike(target)) {
    return { ok: false, reason: `Cannot write leaf ${String(leaf)} into non-object target` };
  }

  const key = String(leaf);
  const previousValue = normalizeEditorValue(target[key]);
  target[key] = nextValue;
  return { ok: true, previousValue, nextValue: normalizeEditorValue(target[key]) };
}

function normalizeEditorValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeEditorValue(entry, seen));
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), normalizeEditorValue(entry, seen)]),
    );
  }

  if (value instanceof Set) {
    return [...value].map((entry) => normalizeEditorValue(entry, seen));
  }

  if (!isPlainObject(value) && !hasNumericVectorShape(value)) {
    return String(value);
  }

  if (seen.has(value as object)) {
    return '[Circular]';
  }
  seen.add(value as object);

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeEditorValue(entry, seen);
    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }
  seen.delete(value as object);
  return result;
}

function cloneWritableValue(value: unknown): unknown {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return new Date(value.getTime()).toISOString();
  if (Array.isArray(value)) return value.map((entry) => cloneWritableValue(entry));
  if (value instanceof Map) {
    return Object.fromEntries([...value.entries()].map(([key, entry]) => [String(key), cloneWritableValue(entry)]));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => cloneWritableValue(entry));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneWritableValue(entry)]),
    );
  }
  if (hasNumericVectorShape(value)) {
    return {
      ...('x' in (value as Record<string, unknown>) ? { x: cloneWritableValue((value as Record<string, unknown>).x) } : {}),
      ...('y' in (value as Record<string, unknown>) ? { y: cloneWritableValue((value as Record<string, unknown>).y) } : {}),
      ...('z' in (value as Record<string, unknown>) ? { z: cloneWritableValue((value as Record<string, unknown>).z) } : {}),
      ...('w' in (value as Record<string, unknown>) ? { w: cloneWritableValue((value as Record<string, unknown>).w) } : {}),
    };
  }
  return value;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasNumericVectorShape(value: unknown): value is Record<string, unknown> {
  if (!isObjectLike(value)) return false;
  const keys = ['x', 'y', 'z', 'w'];
  return keys.some((key) => key in value && typeof (value as Record<string, unknown>)[key] === 'number');
}
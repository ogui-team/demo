import type {
  GamePlugin,
  IInspectorService,
  IRuntimeMixerService,
  IStatePersistenceService,
  InspectorEntitySnapshot,
  InspectorFieldDescriptor,
  PluginInitContext,
  RuntimeMixerTrackState,
  StateImportResult,
} from '@shared/contracts';
import { MetadataStore } from '@engine/0-foundation/reflection/ReflectionSystem';
import type { HUDRuntimeControlDefinition, HUDRuntimePanelDefinition } from '@engine/2-systems/gameplay/systems/HUDSystem';

const MIXER_SERVICE_ID = 'runtime.mixer';
const INSPECTOR_SERVICE_ID = 'inspector';
const PERSISTENCE_SERVICE_ID = 'state.persistence';

interface HudRuntimeHost {
  upsertRuntimePanel(panelId: string, panel: HUDRuntimePanelDefinition): void;
  removeRuntimePanel(panelId: string): void;
  showNotification?(text: string, durationSeconds?: number): void;
}

interface SelectionSystemAdapter {
  getSelected?(): string | null;
  onSelect?(callback: (entityId: string) => void): () => void;
  onDeselect?(callback: (entityId: string) => void): () => void;
}

interface ComponentLike {
  name: string;
  data: Record<string, unknown>;
}

interface EntityLike {
  id: string;
  type: string;
  touch?(timestamp?: number): void;
  getComponent(name: string): ComponentLike | undefined;
  getComponents(): ComponentLike[];
}

interface EntityManagerAdapter {
  getEntity(id: string): EntityLike | undefined | null;
}

interface SaveLoadManagerAdapter {
  saveMap(name: string): boolean;
  loadMap(name: string): StateImportResult;
  listMaps(): string[];
  deleteMap(name: string): boolean;
  exportMap(name?: string): string;
  importMap(json: string, name?: string): StateImportResult;
}

interface UpdateWrapper {
  update: (...args: any[]) => unknown;
}

export class RuntimeMixerService implements IRuntimeMixerService {
  readonly id = MIXER_SERVICE_ID;

  private readonly trackIds: string[];
  private readonly disabledTracks = new Set<string>();
  private isolatedTrack: string | null = null;
  private readonly patchedSystems = new Map<string, { system: UpdateWrapper; originalUpdate: (...args: any[]) => unknown }>();

  constructor(private readonly context: PluginInitContext, private readonly hud: HudRuntimeHost | null) {
    this.trackIds = this.discoverTracks();
    this.renderHud();
  }

  listTracks(): RuntimeMixerTrackState[] {
    return this.trackIds.map((trackId) => ({
      id: trackId,
      enabled: !this.disabledTracks.has(trackId),
      isolated: this.isolatedTrack === trackId,
    }));
  }

  setTrackEnabled(trackId: string, enabled: boolean): boolean {
    if (!this.trackIds.includes(trackId)) {
      return false;
    }

    const system = this.context.systemRegistry.getSystem(trackId) as UpdateWrapper | undefined;
    if (!system || typeof system.update !== 'function') {
      return false;
    }

    const wasEnabled = !this.disabledTracks.has(trackId);
    if (enabled === wasEnabled) {
      return true;
    }

    if (enabled) {
      this.disabledTracks.delete(trackId);
      this.restoreTrack(trackId);
    } else {
      this.disabledTracks.add(trackId);
      this.patchTrack(trackId, system);
    }

    this.context.gameBus.emit('plugin:runtime-mixer:track-changed', {
      trackId,
      enabled,
      isolatedTrack: this.isolatedTrack,
    });
    this.renderHud();
    return true;
  }

  isolateTrack(trackId: string | null): void {
    if (trackId !== null && !this.trackIds.includes(trackId)) {
      return;
    }

    this.isolatedTrack = trackId;
    for (const id of this.trackIds) {
      const shouldEnable = trackId === null ? true : id === trackId;
      this.setTrackEnabled(id, shouldEnable);
    }

    this.context.gameBus.emit('plugin:runtime-mixer:isolation-changed', {
      isolatedTrack: this.isolatedTrack,
    });
    this.renderHud();
  }

  handleHudToggle(payload: any): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const controlId = typeof payload.controlId === 'string' ? payload.controlId : '';
    if (controlId === 'mixer:enable-all') {
      this.isolateTrack(null);
      return;
    }

    if (controlId === 'mixer:clear-isolation') {
      this.isolateTrack(null);
      return;
    }

    if (controlId.startsWith('track:')) {
      const trackId = controlId.slice('track:'.length);
      const enabled = payload.value === true;
      this.setTrackEnabled(trackId, enabled);
      return;
    }

    if (controlId.startsWith('isolate:')) {
      const trackId = controlId.slice('isolate:'.length);
      const shouldIsolate = payload.value === true;
      this.isolateTrack(shouldIsolate ? trackId : null);
    }
  }

  dispose(): void {
    for (const trackId of this.trackIds) {
      this.restoreTrack(trackId);
    }
    this.disabledTracks.clear();
    this.isolatedTrack = null;
    this.hud?.removeRuntimePanel('runtime-mixer');
  }

  private discoverTracks(): string[] {
    const excluded = new Set([
      'saveLoadManager',
      'stateManager',
      'entityManager',
      'multiplayerClient',
      'networkSyncSystem',
      'renderingPipeline',
      'debugOverlay',
      'hudSystem',
    ]);

    return this.context.systemRegistry
      .listSystems()
      .filter((id) => !excluded.has(id))
      .filter((id) => /System$|Manager$|Runtime$/.test(id))
      .filter((id) => {
        const system = this.context.systemRegistry.getSystem(id) as UpdateWrapper | undefined;
        return typeof system?.update === 'function';
      })
      .sort((a, b) => a.localeCompare(b));
  }

  private patchTrack(trackId: string, system: UpdateWrapper): void {
    if (this.patchedSystems.has(trackId)) {
      return;
    }

    const originalUpdate = system.update.bind(system);
    system.update = (...args: any[]) => {
      if (!this.disabledTracks.has(trackId)) {
        return originalUpdate(...args);
      }
      return this.getNeutralUpdateValue(trackId);
    };

    this.patchedSystems.set(trackId, { system, originalUpdate });
  }

  private restoreTrack(trackId: string): void {
    const patch = this.patchedSystems.get(trackId);
    if (!patch) {
      return;
    }

    patch.system.update = patch.originalUpdate;
    this.patchedSystems.delete(trackId);
  }

  private getNeutralUpdateValue(trackId: string): unknown {
    if (trackId === 'physicsSystem') {
      return new Map();
    }
    return undefined;
  }

  private renderHud(): void {
    if (!this.hud) {
      return;
    }

    const controls: HUDRuntimeControlDefinition[] = [
      {
        id: 'mixer:enable-all',
        label: 'Enable All Tracks',
        kind: 'action',
        emitEvent: 'plugin:runtime-mixer:toggle',
      },
      {
        id: 'mixer:clear-isolation',
        label: 'Clear Isolation',
        kind: 'action',
        emitEvent: 'plugin:runtime-mixer:toggle',
      },
    ];

    for (const track of this.listTracks()) {
      controls.push({
        id: `track:${track.id}`,
        label: track.id,
        kind: 'toggle',
        value: track.enabled,
        emitEvent: 'plugin:runtime-mixer:toggle',
      });
      controls.push({
        id: `isolate:${track.id}`,
        label: `Isolate ${track.id}`,
        kind: 'toggle',
        value: track.isolated,
        emitEvent: 'plugin:runtime-mixer:toggle',
      });
    }

    this.hud.upsertRuntimePanel('runtime-mixer', {
      title: 'Runtime Mixer',
      subtitle: 'Enable/disable gameplay update tracks.',
      controls,
    });
  }
}

export class InspectorService implements IInspectorService {
  readonly id = INSPECTOR_SERVICE_ID;

  private readonly disposers: Array<() => void> = [];
  private readonly selectionSystem: SelectionSystemAdapter | null;
  private readonly entityManager: EntityManagerAdapter | null;

  constructor(private readonly context: PluginInitContext, private readonly hud: HudRuntimeHost | null) {
    this.selectionSystem = this.resolveSelectionSystem();
    this.entityManager = this.resolveEntityManager();

    this.disposers.push(this.context.eventBus.on('plugin:inspector:apply', (payload) => {
      this.handleHudApply(payload);
    }));

    const onSelect = this.selectionSystem?.onSelect;
    if (typeof onSelect === 'function') {
      this.disposers.push(onSelect.call(this.selectionSystem, () => {
        this.renderSelectedEntityPanel();
      }));
    }

    const onDeselect = this.selectionSystem?.onDeselect;
    if (typeof onDeselect === 'function') {
      this.disposers.push(onDeselect.call(this.selectionSystem, () => {
        this.renderSelectedEntityPanel();
      }));
    }

    this.renderSelectedEntityPanel();
  }

  inspectSelectedEntity(): InspectorEntitySnapshot | null {
    const selectedId = this.selectionSystem?.getSelected?.() ?? null;
    if (!selectedId) {
      return null;
    }
    return this.inspectEntity(selectedId);
  }

  inspectEntity(entityId: string): InspectorEntitySnapshot | null {
    const entity = this.entityManager?.getEntity(entityId);
    if (!entity) {
      return null;
    }

    const fields: InspectorFieldDescriptor[] = [];
    for (const component of entity.getComponents()) {
      const componentFields = this.describeComponentFields(component);
      fields.push(...componentFields);
    }

    return {
      entityId: entity.id,
      entityType: entity.type,
      fields,
    };
  }

  applyFieldValue(entityId: string, componentName: string, path: string, value: unknown): boolean {
    const entity = this.entityManager?.getEntity(entityId);
    if (!entity) {
      return false;
    }

    const component = entity.getComponent(componentName);
    if (!component) {
      return false;
    }

    const metadata = this.getMetadataForPath(componentName, path);
    if (metadata?.readOnly) {
      return false;
    }

    const nextValue = this.coerceValue(value, metadata?.type, metadata?.min, metadata?.max);
    const didApply = assignPath(component.data, path, nextValue);
    if (!didApply) {
      return false;
    }

    entity.touch?.();
    this.context.gameBus.emit('plugin:inspector:updated', {
      entityId,
      componentName,
      path,
      value: nextValue,
    });
    this.renderSelectedEntityPanel();
    return true;
  }

  dispose(): void {
    while (this.disposers.length > 0) {
      this.disposers.pop()?.();
    }
    this.hud?.removeRuntimePanel('inspector');
  }

  private resolveSelectionSystem(): SelectionSystemAdapter | null {
    const system = this.context.systemRegistry.getSystem('selectionSystem') as SelectionSystemAdapter | undefined;
    return system ?? null;
  }

  private resolveEntityManager(): EntityManagerAdapter | null {
    const manager = this.context.systemRegistry.getSystem('entityManager') as EntityManagerAdapter | undefined;
    return manager ?? null;
  }

  private describeComponentFields(component: ComponentLike): InspectorFieldDescriptor[] {
    const out: InspectorFieldDescriptor[] = [];
    const pushPrimitive = (path: string, value: unknown): void => {
      if (!isPrimitiveEditorValue(value)) {
        return;
      }

      const metadata = this.getMetadataForPath(component.name, path);
      const normalized = normalizeKind(metadata?.type, value);
      out.push({
        id: `${component.name}:${path}`,
        label: metadata?.label ?? `${component.name}.${path}`,
        componentName: component.name,
        path,
        kind: normalized,
        value,
        min: metadata?.min,
        max: metadata?.max,
        step: metadata?.step,
        readOnly: metadata?.readOnly ?? false,
      });
    };

    for (const [key, value] of Object.entries(component.data)) {
      if (isPlainObject(value)) {
        for (const [childKey, childValue] of Object.entries(value)) {
          pushPrimitive(`${key}.${childKey}`, childValue);
        }
        continue;
      }
      pushPrimitive(key, value);
    }

    return out;
  }

  private getMetadataForPath(componentName: string, path: string): {
    label?: string;
    type?: string;
    min?: number;
    max?: number;
    step?: number;
    readOnly?: boolean;
  } | null {
    const classMeta = MetadataStore.getClass(componentName);
    if (!classMeta) {
      return null;
    }

    const leaf = path.split('.')[0];
    const propertyMeta = classMeta.properties.get(leaf);
    if (!propertyMeta) {
      return null;
    }

    return {
      label: propertyMeta.label,
      type: propertyMeta.type,
      min: propertyMeta.min,
      max: propertyMeta.max,
      step: propertyMeta.step,
      readOnly: propertyMeta.readOnly,
    };
  }

  private coerceValue(
    value: unknown,
    metadataType?: string,
    min?: number,
    max?: number,
  ): unknown {
    if (metadataType === 'boolean') {
      return value === true;
    }

    if (metadataType === 'number' || typeof value === 'number') {
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed)) {
        return min ?? 0;
      }

      let next = parsed;
      if (typeof min === 'number') next = Math.max(min, next);
      if (typeof max === 'number') next = Math.min(max, next);
      return next;
    }

    if (typeof value === 'string') {
      return value;
    }

    return value;
  }

  private handleHudApply(payload: any): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const entityId = typeof payload.entityId === 'string' ? payload.entityId : '';
    const componentName = typeof payload.componentName === 'string' ? payload.componentName : '';
    const path = typeof payload.path === 'string' ? payload.path : '';
    if (!entityId || !componentName || !path) {
      return;
    }

    const success = this.applyFieldValue(entityId, componentName, path, payload.value);
    if (success) {
      this.hud?.showNotification?.(`Inspector applied: ${componentName}.${path}`, 1.2);
    }
  }

  private renderSelectedEntityPanel(): void {
    if (!this.hud) {
      return;
    }

    const snapshot = this.inspectSelectedEntity();
    if (!snapshot) {
      this.hud.upsertRuntimePanel('inspector', {
        title: 'Inspector Service',
        subtitle: 'Select an entity to inspect and edit.',
        controls: [],
      });
      return;
    }

    const controls: HUDRuntimeControlDefinition[] = [];
    const editableFields = snapshot.fields.filter((field) => field.readOnly !== true).slice(0, 12);

    for (const field of editableFields) {
      controls.push({
        id: `inspector:${field.id}`,
        label: field.label,
        kind: field.kind === 'boolean' ? 'toggle' : field.kind === 'number' ? 'number' : 'text',
        value: field.value,
        min: field.min,
        max: field.max,
        step: field.step,
        emitEvent: 'plugin:inspector:apply',
        payload: {
          entityId: snapshot.entityId,
          componentName: field.componentName,
          path: field.path,
        },
      });
    }

    this.hud.upsertRuntimePanel('inspector', {
      title: 'Inspector Service',
      subtitle: `${snapshot.entityType} (${snapshot.entityId})`,
      controls,
    });
  }
}

export class StatePersistenceService implements IStatePersistenceService {
  readonly id = PERSISTENCE_SERVICE_ID;

  private readonly disposers: Array<() => void> = [];
  private mapName = 'runtime-snapshot';

  constructor(private readonly context: PluginInitContext, private readonly hud: HudRuntimeHost | null) {
    this.disposers.push(this.context.eventBus.on('plugin:state-persistence:set-name', (payload) => {
      if (payload && typeof payload.value === 'string' && payload.value.trim()) {
        this.mapName = payload.value.trim();
        this.renderHud();
      }
    }));

    this.disposers.push(this.context.eventBus.on('plugin:state-persistence:save', () => {
      this.saveMap(this.mapName);
      this.hud?.showNotification?.(`Saved map: ${this.mapName}`, 1.2);
    }));

    this.disposers.push(this.context.eventBus.on('plugin:state-persistence:load', () => {
      const result = this.loadMap(this.mapName);
      if (result.success) {
        this.hud?.showNotification?.(`Loaded map: ${this.mapName}`, 1.2);
      }
    }));

    this.disposers.push(this.context.eventBus.on('plugin:state-persistence:delete', () => {
      const deleted = this.deleteMap(this.mapName);
      if (deleted) {
        this.hud?.showNotification?.(`Deleted map: ${this.mapName}`, 1.2);
      }
    }));

    this.disposers.push(this.context.eventBus.on('plugin:state-persistence:export', () => {
      const exported = this.exportWorld(this.mapName);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && exported) {
        void navigator.clipboard.writeText(exported);
        this.hud?.showNotification?.('World JSON copied to clipboard', 1.5);
      }
    }));

    this.disposers.push(this.context.eventBus.on('plugin:state-persistence:import', () => {
      void this.importFromPicker();
    }));

    this.renderHud();
  }

  saveMap(name: string): boolean {
    const manager = this.getManager();
    const success = manager?.saveMap(name) ?? false;
    this.context.gameBus.emit('plugin:state-persistence:saved', { name, success });
    return success;
  }

  loadMap(name: string): StateImportResult {
    const manager = this.getManager();
    const result = manager?.loadMap(name) ?? { success: false, entitiesCreated: 0, settingsApplied: 0 };
    this.context.gameBus.emit('plugin:state-persistence:loaded', { name, ...result });
    return result;
  }

  listMaps(): string[] {
    return this.getManager()?.listMaps() ?? [];
  }

  deleteMap(name: string): boolean {
    const success = this.getManager()?.deleteMap(name) ?? false;
    this.context.gameBus.emit('plugin:state-persistence:deleted', { name, success });
    return success;
  }

  exportWorld(name?: string): string {
    const exported = this.getManager()?.exportMap(name) ?? '';
    this.context.gameBus.emit('plugin:state-persistence:exported', {
      name,
      bytes: exported.length,
      success: exported.length > 0,
    });
    return exported;
  }

  importWorld(json: string, name?: string): StateImportResult {
    const result = this.getManager()?.importMap(json, name) ?? {
      success: false,
      entitiesCreated: 0,
      settingsApplied: 0,
    };
    this.context.gameBus.emit('plugin:state-persistence:imported', {
      name,
      ...result,
    });
    return result;
  }

  dispose(): void {
    while (this.disposers.length > 0) {
      this.disposers.pop()?.();
    }
    this.hud?.removeRuntimePanel('state-persistence');
  }

  private getManager(): SaveLoadManagerAdapter | null {
    const manager = this.context.systemRegistry.getSystem('saveLoadManager') as SaveLoadManagerAdapter | undefined;
    return manager ?? null;
  }

  private async importFromPicker(): Promise<void> {
    const openPicker = (globalThis as any).showOpenFilePicker as undefined | ((options: any) => Promise<any[]>);
    if (typeof openPicker !== 'function') {
      this.hud?.showNotification?.('showOpenFilePicker unavailable', 1.5);
      return;
    }

    const [fileHandle] = await openPicker({
      types: [{
        description: 'JSON Files',
        accept: { 'application/json': ['.json'] },
      }],
      excludeAcceptAllOption: false,
      multiple: false,
    });

    if (!fileHandle) {
      return;
    }

    const file = await fileHandle.getFile();
    const text = await file.text();
    const result = this.importWorld(text, this.mapName);
    if (result.success) {
      this.hud?.showNotification?.(`Imported map: ${this.mapName}`, 1.4);
    }
  }

  private renderHud(): void {
    if (!this.hud) {
      return;
    }

    this.hud.upsertRuntimePanel('state-persistence', {
      title: 'State Persistence',
      subtitle: `Map: ${this.mapName}`,
      controls: [
        {
          id: 'state:name',
          label: 'Map Name',
          kind: 'text',
          value: this.mapName,
          emitEvent: 'plugin:state-persistence:set-name',
        },
        {
          id: 'state:save',
          label: 'Save',
          kind: 'action',
          emitEvent: 'plugin:state-persistence:save',
        },
        {
          id: 'state:load',
          label: 'Load',
          kind: 'action',
          emitEvent: 'plugin:state-persistence:load',
        },
        {
          id: 'state:delete',
          label: 'Delete',
          kind: 'action',
          emitEvent: 'plugin:state-persistence:delete',
        },
        {
          id: 'state:export',
          label: 'Export JSON',
          kind: 'action',
          emitEvent: 'plugin:state-persistence:export',
        },
        {
          id: 'state:import',
          label: 'Import JSON',
          kind: 'action',
          emitEvent: 'plugin:state-persistence:import',
        },
      ],
    });
  }
}

export class RuntimeMixerPlugin implements GamePlugin {
  readonly id = 'runtime-mixer-plugin';
  readonly name = 'Runtime Mixer Plugin';
  readonly version = '0.3.0';
  readonly description = 'Runtime mixer, metadata inspector, and state persistence services.';

  private context: PluginInitContext | null = null;
  private mixerService: RuntimeMixerService | null = null;
  private inspectorService: InspectorService | null = null;
  private persistenceService: StatePersistenceService | null = null;
  private readonly disposers: Array<() => void> = [];

  init(context: PluginInitContext): void {
    this.context = context;

    const hud = this.resolveHudHost(context);
    this.mixerService = new RuntimeMixerService(context, hud);
    this.inspectorService = new InspectorService(context, hud);
    this.persistenceService = new StatePersistenceService(context, hud);

    context.sdk.registerService(MIXER_SERVICE_ID, this.mixerService);
    context.sdk.registerService(INSPECTOR_SERVICE_ID, this.inspectorService);
    context.sdk.registerService(PERSISTENCE_SERVICE_ID, this.persistenceService);

    this.disposers.push(context.eventBus.on('plugin:runtime-mixer:toggle', (payload) => {
      this.mixerService?.handleHudToggle(payload);
    }));

    context.logger.log('[RuntimeMixerPlugin] Registered mixer, inspector, and persistence services');
  }

  dispose(): void {
    while (this.disposers.length > 0) {
      this.disposers.pop()?.();
    }

    if (!this.context) {
      return;
    }

    this.context.sdk.unregisterService(MIXER_SERVICE_ID);
    this.context.sdk.unregisterService(INSPECTOR_SERVICE_ID);
    this.context.sdk.unregisterService(PERSISTENCE_SERVICE_ID);

    this.mixerService = null;
    this.inspectorService = null;
    this.persistenceService = null;
    this.context = null;
  }

  private resolveHudHost(context: PluginInitContext): HudRuntimeHost | null {
    const candidates = ['hudSystem', 'gameHUD', 'hud'];
    for (const id of candidates) {
      const hud = context.systemRegistry.getSystem(id) as HudRuntimeHost | undefined;
      if (hud && typeof hud.upsertRuntimePanel === 'function') {
        return hud;
      }
    }
    return null;
  }
}

function normalizeKind(metadataType: string | undefined, value: unknown): 'number' | 'boolean' | 'text' {
  if (metadataType === 'boolean' || typeof value === 'boolean') {
    return 'boolean';
  }
  if (metadataType === 'number' || typeof value === 'number') {
    return 'number';
  }
  return 'text';
}

function isPrimitiveEditorValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assignPath(root: Record<string, unknown>, path: string, value: unknown): boolean {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);

  if (segments.length === 0) {
    return false;
  }

  let target: any = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const nextSegment = segments[index + 1];
    if (!isPlainObject(target) && !Array.isArray(target)) {
      return false;
    }

    if (Array.isArray(target)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex)) {
        return false;
      }
      if (target[arrayIndex] == null) {
        target[arrayIndex] = /^\d+$/.test(nextSegment) ? [] : {};
      }
      target = target[arrayIndex];
      continue;
    }

    if (target[segment] == null) {
      target[segment] = /^\d+$/.test(nextSegment) ? [] : {};
    }
    target = target[segment];
  }

  const leaf = segments[segments.length - 1];
  if (Array.isArray(target)) {
    const index = Number(leaf);
    if (!Number.isInteger(index)) {
      return false;
    }
    target[index] = value;
    return true;
  }

  if (!isPlainObject(target)) {
    return false;
  }

  target[leaf] = value;
  return true;
}

import type { DebugManager } from '../../../4-runtime/diagnostics/debug';
import { gameBus } from '@engine/1-kernel/core/public-api';
import type { GameEvents } from '@engine/1-kernel/core/public-api';
import { StateManager } from '../../../0-foundation/foundation/state/StateManager';
import {
  getEditorPropertiesByCategory,
  getReplicatedState,
  getSaveGameState,
} from '../../../0-foundation/reflection';
import type {
  AbilityTemplate,
  EffectTemplate,
  ItemTemplate,
} from './gas/CombatTypes';
import { GASRuntimeMetadata } from './gas/GASRuntimeMetadata';
import { DataRegistry } from './gas/DataRegistry';
import { PlayerStats } from './gas/PlayerStats';
import { PlayerAppearanceState } from './gas/PlayerAppearanceState';
import type { TropicalHorrorArchetypeId } from '@engine/2-systems/ArchetypeDefinitions';

export interface AdaptiveDerivedItemConfig {
  id: string;
  baseItemId: string;
  label?: string;
  labelPrefix?: string;
  passiveEffectIds?: string[];
  affixPool?: string[];
  descriptionSuffix?: string;
  meshKey?: string;
}

export interface AdaptiveEncounterProfile {
  id: string;
  tags: string[];
  enemyBudget: number;
  preferredEnemyTypes: string[];
}

export interface AdaptiveLootTheme {
  id: string;
  tags: string[];
  baseItems: string[];
  preferredAffixes: string[];
  labelPrefix?: string;
  maxSuggestions?: number;
}

export interface AdaptiveContentPack {
  id: string;
  tags?: string[];
  abilities?: AbilityTemplate[];
  effects?: EffectTemplate[];
  items?: ItemTemplate[];
  derivedItems?: AdaptiveDerivedItemConfig[];
  encounterProfiles?: AdaptiveEncounterProfile[];
  lootThemes?: AdaptiveLootTheme[];
}

export interface AdaptiveRuntimeSync {
  playerId: string;
  health: number;
  maxHealth: number;
  shield: number;
  activeGameMode: string;
  activeAbilityId?: string;
  cooldownGroups?: string[];
  displayName?: string;
}

interface AdaptiveEventMessage {
  channel: string;
  source: keyof GameEvents;
  priority: number;
  tags: string[];
  payload: unknown;
  timestamp: number;
}

interface AdaptiveEventSubscription {
  channel: string;
  priority: number;
  requiredTags: string[];
  handler: (event: AdaptiveEventMessage) => void;
}

interface ReplicationCandidate {
  id: string;
  priority: number;
  tags: string[];
  snapshot: Record<string, unknown>;
  timestamp: number;
}

interface InspectableRecord {
  instance: object;
  tags: string[];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export class AdaptiveRuntimeLayer {
  private readonly stateManager: StateManager;
  private readonly dataRegistry: DataRegistry;
  private readonly runtimeMetadata = new GASRuntimeMetadata();
  private readonly packs = new Map<string, AdaptiveContentPack>();
  private readonly derivedItemIds = new Set<string>();
  private readonly encounterProfiles = new Map<string, AdaptiveEncounterProfile>();
  private readonly lootThemes = new Map<string, AdaptiveLootTheme>();
  private readonly inspectables = new Map<string, InspectableRecord>();
  private readonly playerStats = new Map<string, PlayerStats>();
  private readonly playerAppearanceStates = new Map<string, PlayerAppearanceState>();
  private readonly subscriptions: Array<() => void> = [];
  private readonly channelSubscriptions: AdaptiveEventSubscription[] = [];
  private readonly eventCounts = new Map<string, number>();
  private readonly recentEvents: string[] = [];
  private readonly replicationQueue: ReplicationCandidate[] = [];

  private enabled = true;
  private replicationBudget = 6;
  private lastWeaponId = 'pistol';
  private lastLootSuggestions: string[] = [];
  private lastEncounterSuggestion: string | null = null;
  private lastFlushedReplication: ReplicationCandidate[] = [];

  constructor(stateManager: StateManager, dataRegistry: DataRegistry) {
    this.stateManager = stateManager;
    this.dataRegistry = dataRegistry;
    this.registerInspectable('adaptive.runtime.channels', this.runtimeMetadata, ['runtime', 'gas']);
    this.projectCoreEvents();
  }

  attachDebugControls(debugManager: DebugManager): void {
    debugManager.addParameter('Adaptive Runtime', {
      id: 'adaptive_runtime_enabled',
      name: 'Adaptive Runtime',
      type: 'checkbox',
      get: () => this.enabled,
      set: (value) => {
        this.enabled = Boolean(value);
      },
    });
    debugManager.addParameter('Adaptive Runtime', {
      id: 'adaptive_runtime_replication_budget',
      name: 'Replication Budget',
      type: 'slider',
      min: 1,
      max: 16,
      step: 1,
      get: () => this.replicationBudget,
      set: (value) => {
        this.replicationBudget = Math.max(1, Math.min(16, Number(value) || 6));
      },
    });
  }

  loadContentPack(pack: AdaptiveContentPack): void {
    this.packs.set(pack.id, pack);

    for (const ability of pack.abilities ?? []) {
      if (!this.dataRegistry.getAbility(ability.id)) {
        this.dataRegistry.patchAbility(ability);
      }
    }
    for (const effect of pack.effects ?? []) {
      if (!this.dataRegistry.getEffect(effect.id)) {
        this.dataRegistry.patchEffect(effect);
      }
    }
    for (const item of pack.items ?? []) {
      if (!this.dataRegistry.getItem(item.id)) {
        this.dataRegistry.patchItem(item);
      }
    }

    for (const theme of pack.lootThemes ?? []) {
      this.lootThemes.set(theme.id, theme);
    }
    for (const profile of pack.encounterProfiles ?? []) {
      this.encounterProfiles.set(profile.id, profile);
    }
    for (const derived of pack.derivedItems ?? []) {
      this.registerDerivedItem(derived);
    }
  }

  onChannel(channel: string, handler: (event: AdaptiveEventMessage) => void, options: {
    priority?: number;
    requiredTags?: string[];
  } = {}): () => void {
    const subscription: AdaptiveEventSubscription = {
      channel,
      priority: options.priority ?? 0,
      requiredTags: options.requiredTags ?? [],
      handler,
    };
    this.channelSubscriptions.push(subscription);
    return () => {
      const index = this.channelSubscriptions.indexOf(subscription);
      if (index >= 0) this.channelSubscriptions.splice(index, 1);
    };
  }

  registerInspectable(id: string, instance: object, tags: string[] = []): void {
    this.inspectables.set(id, { instance, tags: uniqueStrings(tags) });
  }

  syncRuntimeState(sync: AdaptiveRuntimeSync): void {
    const stats = this.ensurePlayerStats(sync.playerId);
    stats.health = sync.health;
    stats.maxHealth = Math.max(sync.maxHealth, 1);
    stats.displayName = sync.displayName ?? stats.displayName;

    this.runtimeMetadata.activeAbilityId = sync.activeAbilityId ?? this.runtimeMetadata.activeAbilityId;
    this.runtimeMetadata.cooldownGroups = (sync.cooldownGroups ?? []).join(', ');
    this.runtimeMetadata.activeGameMode = sync.activeGameMode;
    this.runtimeMetadata.healthChannel = sync.health;
    this.runtimeMetadata.shieldChannel = sync.shield;

    this.registerInspectable(`adaptive.player.${sync.playerId}`, stats, ['player', 'stats', sync.activeGameMode]);
    this.queueReplicationSnapshot(`adaptive.player.${sync.playerId}`, stats, 90, ['player', 'stats']);
    this.queueReplicationSnapshot('adaptive.runtime.channels', this.runtimeMetadata, 70, ['runtime', 'gas']);

    this.refreshRecommendations(sync.activeGameMode, sync.health / Math.max(1, sync.maxHealth));
  }

  applyPlayerArchetype(playerId: string, archetypeId: TropicalHorrorArchetypeId, displayName?: string): void {
    const stats = this.ensurePlayerStats(playerId);
    stats.applyArchetype(archetypeId, displayName ? { displayName } : {});

    const appearance = this.ensurePlayerAppearanceState(playerId);
    appearance.applyArchetype(archetypeId);

    this.registerInspectable(`adaptive.player.${playerId}`, stats, ['player', 'stats', archetypeId]);
    this.registerInspectable(`adaptive.player.${playerId}.appearance`, appearance, ['player', 'appearance', archetypeId]);
    this.queueReplicationSnapshot(`adaptive.player.${playerId}`, stats, 92, ['player', 'stats', archetypeId]);
    this.queueReplicationSnapshot(`adaptive.player.${playerId}.appearance`, appearance, 78, ['player', 'appearance', archetypeId]);
  }

  update(): void {
    const flushed = this.flushReplicationQueue();
    const inspectableSummaries = [...this.inspectables.entries()].slice(0, 6).map(([id, record]) => ({
      id,
      tags: record.tags,
      editorCategories: getEditorPropertiesByCategory(record.instance).map((category) => category.category),
      replicatedKeys: Object.keys(getReplicatedState(record.instance)),
      saveKeys: Object.keys(getSaveGameState(record.instance)),
    }));

    this.stateManager.set('diagnostics.adaptiveRuntime', {
      enabled: this.enabled,
      packs: [...this.packs.keys()],
      derivedItems: [...this.derivedItemIds],
      lootSuggestions: this.lastLootSuggestions,
      encounterSuggestion: this.lastEncounterSuggestion,
      recentEvents: [...this.recentEvents],
      channelCounts: Object.fromEntries(this.eventCounts.entries()),
      replicationBudget: this.replicationBudget,
      queuedReplication: this.replicationQueue.map((candidate) => ({
        id: candidate.id,
        priority: candidate.priority,
        tags: candidate.tags,
      })),
      flushedReplication: flushed.map((candidate) => ({
        id: candidate.id,
        priority: candidate.priority,
        keys: Object.keys(candidate.snapshot),
      })),
      inspectables: inspectableSummaries,
    });
  }

  destroy(): void {
    this.subscriptions.forEach((dispose) => dispose());
    this.subscriptions.length = 0;
  }

  private projectCoreEvents(): void {
    this.subscriptions.push(
      gameBus.on('weaponFired', (payload) => {
        this.lastWeaponId = payload.weaponId;
        this.emitChannel('combat.weapon', 'weaponFired', payload, 90, ['combat', 'weapon', payload.weaponId]);
      }),
    );
    this.subscriptions.push(
      gameBus.on('healthChanged', (payload) => {
        const healthTag = payload.hp <= payload.maxHp * 0.35 ? 'low_health' : 'stable_health';
        this.emitChannel('vitals.health', 'healthChanged', payload, 75, ['vitals', healthTag]);
      }),
    );
    this.subscriptions.push(
      gameBus.on('stateChanged', (payload) => {
        this.emitChannel('runtime.state', 'stateChanged', payload, 65, ['state', payload.to]);
      }),
    );
    this.subscriptions.push(
      gameBus.on('gameModeStarted', (payload) => {
        this.emitChannel('runtime.mode', 'gameModeStarted', payload, 70, ['mode', payload.modeName]);
      }),
    );
  }

  private emitChannel<K extends keyof GameEvents>(
    channel: string,
    source: K,
    payload: GameEvents[K],
    priority: number,
    tags: string[],
  ): void {
    const message: AdaptiveEventMessage = {
      channel,
      source,
      priority,
      tags: uniqueStrings(tags),
      payload,
      timestamp: Date.now(),
    };
    this.eventCounts.set(channel, (this.eventCounts.get(channel) ?? 0) + 1);
    this.recentEvents.unshift(`${channel}:${message.tags.join('|')}`);
    this.recentEvents.splice(6);

    const subscribers = this.channelSubscriptions
      .filter((subscription) => subscription.channel === channel)
      .sort((left, right) => right.priority - left.priority);

    for (const subscription of subscribers) {
      if (!subscription.requiredTags.every((tag) => message.tags.includes(tag))) continue;
      subscription.handler(message);
    }
  }

  private registerDerivedItem(config: AdaptiveDerivedItemConfig): void {
    const base = this.dataRegistry.getItem(config.baseItemId);
    if (!base || this.dataRegistry.getItem(config.id)) return;

    const derived: ItemTemplate = {
      ...base,
      id: config.id,
      label: config.label ?? `${config.labelPrefix ?? 'Adaptive'} ${base.label}`,
      passiveEffectIds: uniqueStrings([...(base.passiveEffectIds ?? []), ...(config.passiveEffectIds ?? [])]),
      affixPool: uniqueStrings([...(base.affixPool ?? []), ...(config.affixPool ?? [])]),
      description: `${base.description ?? base.label}${config.descriptionSuffix ? ` ${config.descriptionSuffix}` : ''}`,
      meshKey: config.meshKey ?? base.meshKey,
    };

    this.dataRegistry.patchItem(derived);
    this.derivedItemIds.add(derived.id);
  }

  private ensurePlayerStats(playerId: string): PlayerStats {
    const existing = this.playerStats.get(playerId);
    if (existing) return existing;
    const created = new PlayerStats();
    this.playerStats.set(playerId, created);
    return created;
  }

  private ensurePlayerAppearanceState(playerId: string): PlayerAppearanceState {
    const existing = this.playerAppearanceStates.get(playerId);
    if (existing) return existing;
    const created = new PlayerAppearanceState();
    this.playerAppearanceStates.set(playerId, created);
    return created;
  }

  private queueReplicationSnapshot(id: string, instance: object, priority: number, tags: string[]): void {
    if (!this.enabled) return;
    const snapshot = getReplicatedState(instance);
    if (Object.keys(snapshot).length === 0) return;
    this.replicationQueue.push({
      id,
      priority,
      tags: uniqueStrings(tags),
      snapshot,
      timestamp: Date.now(),
    });
    this.replicationQueue.sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return right.timestamp - left.timestamp;
    });
    if (this.replicationQueue.length > 24) {
      this.replicationQueue.length = 24;
    }
  }

  private flushReplicationQueue(): ReplicationCandidate[] {
    if (!this.enabled) {
      this.lastFlushedReplication = [];
      return this.lastFlushedReplication;
    }
    this.lastFlushedReplication = this.replicationQueue.splice(0, this.replicationBudget);
    return this.lastFlushedReplication;
  }

  private refreshRecommendations(activeGameMode: string, healthRatio: number): void {
    const tags = uniqueStrings([
      activeGameMode,
      this.lastWeaponId,
      healthRatio <= 0.35 ? 'low_health' : 'stable_health',
      this.lastWeaponId === 'pistol' ? 'precision' : 'burst',
    ]);

    this.lastLootSuggestions = this.buildLootSuggestions(tags).map((item) => item.id);
    this.lastEncounterSuggestion = this.buildEncounterSuggestion(tags)?.id ?? null;
  }

  private buildLootSuggestions(tags: string[]): ItemTemplate[] {
    const ranked: Array<{ score: number; item: ItemTemplate }> = [];
    for (const theme of this.lootThemes.values()) {
      const overlap = theme.tags.filter((tag) => tags.includes(tag)).length;
      if (overlap === 0) continue;

      const candidateIds = new Set<string>();
      theme.baseItems.forEach((id) => candidateIds.add(id));
      for (const derivedId of this.derivedItemIds) {
        const item = this.dataRegistry.getItem(derivedId);
        if (!item) continue;
        if (theme.baseItems.includes(item.id) || item.label.toLowerCase().includes(theme.labelPrefix?.toLowerCase() ?? '')) {
          candidateIds.add(derivedId);
        }
      }

      for (const candidateId of candidateIds) {
        const item = this.dataRegistry.getItem(candidateId);
        if (!item) continue;
        const affixMatches = (item.affixPool ?? []).filter((affix) => theme.preferredAffixes.includes(affix)).length;
        ranked.push({
          score: overlap * 10 + affixMatches * 3,
          item,
        });
      }
    }

    ranked.sort((left, right) => right.score - left.score);
    return ranked.slice(0, 3).map((entry) => entry.item);
  }

  private buildEncounterSuggestion(tags: string[]): AdaptiveEncounterProfile | null {
    let best: { score: number; profile: AdaptiveEncounterProfile } | null = null;
    for (const profile of this.encounterProfiles.values()) {
      const overlap = profile.tags.filter((tag) => tags.includes(tag)).length;
      if (overlap === 0) continue;
      const score = overlap * 10 + profile.enemyBudget;
      if (!best || score > best.score) {
        best = { score, profile };
      }
    }
    return best?.profile ?? null;
  }

  dispose(): void {
    // Clear all event subscriptions
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions.length = 0;
    // Clear data structures
    this.packs.clear();
    this.derivedItemIds.clear();
    this.encounterProfiles.clear();
    this.lootThemes.clear();
    this.inspectables.clear();
    this.playerStats.clear();
    this.playerAppearanceStates.clear();
    this.channelSubscriptions.length = 0;
    this.eventCounts.clear();
    this.recentEvents.length = 0;
    this.replicationQueue.length = 0;
    this.lastFlushedReplication.length = 0;
    this.lastLootSuggestions = [];
    this.lastEncounterSuggestion = null;
    this.enabled = false;
  }
}
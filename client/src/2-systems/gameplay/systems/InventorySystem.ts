import { Entity, Vector3 } from '@engine/1-kernel/core/public-api';
import type { SystemCapabilities, SystemContext } from '@engine/1-kernel/core/public-api';
import { gameBus } from '@engine/1-kernel/core/public-api';
import { AnalyticsService } from './AnalyticsService';
import { createPlayerInventoryComponent, InventorySlotState, PlayerInventoryComponent } from './components/InventoryComponent';
import { PickupComponent, PickupKind } from './components/PickupComponent';
import type { PlayerRef } from './WeaponSystem';

interface StateStoreAdapter {
  set(path: string, value: unknown): void;
}

interface HealthComponentAdapter {
  armor: number;
}

interface HealthSystemAdapter {
  heal(entityId: string, amount: number): number;
  get(entityId: string): HealthComponentAdapter | undefined;
}

interface WeaponSystemAdapter {
  equip(playerId: string, weaponId: string): boolean;
  pickupWeapon(playerId: string, weaponId: string, reserveAmmo: number, autoEquip: boolean): boolean;
  addAmmo(playerId: string, weaponId: string, amount: number): boolean;
}

interface PrefabSystemAdapter {
  create(prefabName: string, position: Vector3): { id: string };
  remove(entityId: string): boolean;
}

export type ItemType = 'health' | 'armor' | 'ammo' | 'weapon' | 'key' | 'misc' | 'prefab';
export type { PlayerRef } from './WeaponSystem';

export interface ItemDefinition {
  id: string;
  type: ItemType;
  label: string;
  icon?: string;
  description?: string;
  maxStack?: number;
  quickSlot?: number;
  healAmount?: number;
  armorAmount?: number;
  weapon?: string;
  amount?: number;
  weaponKey?: string;
  keyId?: string;
  prefabName?: string;
  pickupRadius?: number;
  respawnTime?: number;
  autoEquip?: boolean;
  data?: Record<string, unknown>;
}

export interface InventoryItemStack extends InventorySlotState {
  itemType: ItemType;
  label: string;
}

export interface PickupRecord {
  id: string;
  itemId: string;
  entityId: string | null;
  position: Vector3;
  active: boolean;
  respawnTimer: number;
  component: PickupComponent;
}

function toPlayerId(player: PlayerRef): string {
  if (typeof player === 'string') return player;
  if (player instanceof Entity) return player.id;
  return player.id;
}

export class InventorySystem {
  private readonly definitions = new Map<string, ItemDefinition>();
  private readonly inventories = new Map<string, PlayerInventoryComponent>();
  private readonly pickups = new Map<string, PickupRecord>();
  private health: HealthSystemAdapter | null;
  private weapons: WeaponSystemAdapter | null;
  private state: StateStoreAdapter | null;
  private prefabSystem: PrefabSystemAdapter | null;
  private readonly enableLogging: boolean;
  private pickupCounter = 0;
  private readonly defaultMaxSlots: number;
  private readonly defaultMaxStackPerSlot: number;
  private onPickupCallbacks: Array<(playerId: string, item: ItemDefinition, pickupId: string) => void> = [];
  private systemContext: SystemContext | null = null;
  private eventBusUnsubscribers: Array<() => void> = [];
  private activePhase: string = 'BOOT';
  private isPlayActive = false;
  private didEmitForceInventoryRefresh = false;

  constructor(config: {
    health?: HealthSystemAdapter;
    weapons?: WeaponSystemAdapter;
    state?: StateStoreAdapter;
    prefabSystem?: PrefabSystemAdapter;
    maxSlots?: number;
    maxStackPerSlot?: number;
    enableLogging?: boolean;
  } = {}) {
    this.health = config.health ?? null;
    this.weapons = config.weapons ?? null;
    this.state = config.state ?? null;
    this.prefabSystem = config.prefabSystem ?? null;
    this.enableLogging = config.enableLogging ?? false;
    this.defaultMaxSlots = config.maxSlots ?? 8;
    this.defaultMaxStackPerSlot = config.maxStackPerSlot ?? 99;

    // BRIDGE: Subscribe to network inventory sync events from gameBus
    // This fixes the "Inventory Silo" by allowing the gameplay domain (InventorySystem)
    // to receive inventory sync events from the network domain (MultiplayerClient)
    this.eventBusUnsubscribers.push(
      gameBus.on('networkInventorySyncReceived', (payload) => {
        this.onNetworkInventorySync(payload.inventory);
      })
    );

    this.eventBusUnsubscribers.push(
      gameBus.on('FULL_SYNC_DATA', () => {
        this.isPlayActive = false;
        this.activePhase = 'NETWORK_SYNC';
        this.didEmitForceInventoryRefresh = false;
        this.inventories.clear();
      }),
      gameBus.on('LIFECYCLE_CHANGED', ({ to }) => {
        this.activePhase = to;
      }),
      gameBus.on('LIFECYCLE_PLAY_ACTIVE', () => {
        this.activePhase = 'PLAY_ACTIVE';
        this.isPlayActive = true;
        if (!this.didEmitForceInventoryRefresh) {
          this.didEmitForceInventoryRefresh = true;
          gameBus.emit('FORCE_INVENTORY_REFRESH', {
            phase: this.activePhase,
            timestamp: Date.now(),
          });
        }
      }),
      gameBus.on('ENGINE_RESET', () => {
        this.activePhase = 'BOOT';
        this.isPlayActive = false;
        this.didEmitForceInventoryRefresh = false;
      }),
    );

    // BRIDGE: Subscribe to ammo state sync events from WeaponSystem via gameBus
    // This fixes the "Ammo State Silo" by allowing InventorySystem to receive
    // ammo updates from WeaponSystem without tight coupling
    this.eventBusUnsubscribers.push(
      gameBus.on('ammoStateSyncBridge', (payload) => {
        this.onAmmoStateSync(payload.playerId, payload.weaponId, {
          current: payload.currentAmmo,
          reserve: payload.reserveAmmo,
          isReloading: payload.isReloading,
        });
      })
    );
  }

  init(ctx: SystemContext): void {
    this.systemContext = ctx;
    this.health = (ctx.systems.healthSystem as HealthSystemAdapter | undefined) ?? this.health;
    this.weapons = (ctx.systems.weaponSystem as WeaponSystemAdapter | undefined) ?? this.weapons;
    this.prefabSystem = (ctx.systems.prefabSystem as PrefabSystemAdapter | undefined) ?? this.prefabSystem;
  }

  setSystemContext(ctx: SystemContext): void {
    this.init(ctx);
  }

  getCapabilities(): SystemCapabilities {
    return {
      usesEventBus: true,  // NOW: Subscribes to gameBus for network inventory sync events
      usesReplication: true,
      exposesDebug: true,
      hasDebugIntegration: true,
      deterministic: false,
      usesSystemContext: this.systemContext !== null,
      usesNetworkFacade: true,
    };
  }

  getDebugState(): Record<string, unknown> {
    return {
      status: 'ok',
      active: true,
      metrics: {
        hasSystemContext: this.systemContext !== null,
        definitionCount: this.definitions.size,
        inventoryCount: this.inventories.size,
        pickupCount: this.pickups.size,
      },
    };
  }

  /**
   * Handle network inventory sync payload from MultiplayerClient via gameBus.
   * This bridges the network domain (MultiplayerClient) and gameplay domain (InventorySystem).
   */
  private onNetworkInventorySync(inventory: Record<string, unknown>): void {
    // Navigate the network sync payload and apply inventory updates
    for (const [playerId, inventoryData] of Object.entries(inventory)) {
      if (!inventoryData || typeof inventoryData !== 'object') {
        continue;
      }
      
      // If it's a player inventory component, import it
      if ('slots' in inventoryData && Array.isArray((inventoryData as any).slots)) {
        const playerInv = inventoryData as PlayerInventoryComponent;
        this.inventories.set(playerId, {
          type: 'inventory',
          ownerId: playerId,
          slots: [...playerInv.slots],
          maxSlots: playerInv.maxSlots,
          maxStackPerSlot: playerInv.maxStackPerSlot,
          equippedSlotIndex: playerInv.equippedSlotIndex,
          quickSlots: playerInv.quickSlots ? [...playerInv.quickSlots] : [0, 1, 2, 3],
        });
        this.syncInventory(playerId);
      }
    }
  }

  /**
   * Handle ammo state sync from WeaponSystem via gameBus.
   * This bridges the gameplay domain (WeaponSystem ammo state) with InventorySystem
   * so that ammo counts are visible to the player and UI.
   */
  private onAmmoStateSync(
    playerId: string,
    weaponId: string,
    ammoState: {
      current: number;
      reserve: number;
      isReloading: boolean;
    }
  ): void {
    // Log for debugging state flow
    if (this.enableLogging) {
      console.log(`[InventorySystem] Ammo sync bridge: ${playerId}/${weaponId} = ${ammoState.current}/${ammoState.reserve}`, ammoState);
    }
    
    // Emit state mutation so UI and other systems can react to ammo changes
    gameBus.emit('stateMutation', {
      source: 'inventorySystem.ammoSync',
      path: `ammo.${playerId}.${weaponId}`,
      changedCount: 1,
    });
  }

  defineItem(id: string, definition: Omit<ItemDefinition, 'id'>): void {
    this.definitions.set(id, { id, maxStack: definition.maxStack ?? 1, ...definition });
    gameBus.emit('stateMutation', {
      source: 'inventorySystem',
      path: `inventory.definitions.${id}`,
      changedCount: 1,
    });
  }

  defineDefaults(): void {
    this.defineItem('health_small', { type: 'health', label: 'Health Pack', icon: '+', healAmount: 25, maxStack: 3, pickupRadius: 1.8, prefabName: 'pickup_medkit' });
    this.defineItem('health_large', { type: 'health', label: 'Trauma Kit', icon: '++', healAmount: 60, maxStack: 2, pickupRadius: 1.8, prefabName: 'pickup_medkit' });
    this.defineItem('shotgun_shells', { type: 'ammo', label: 'Shotgun Shells', icon: 'SG', weapon: 'shotgun', amount: 8, maxStack: 6, pickupRadius: 1.8, prefabName: 'pickup_ammo_box' });
    this.defineItem('rifle_rounds', { type: 'ammo', label: 'Rifle Rounds', icon: 'RF', weapon: 'rifle', amount: 30, maxStack: 6, pickupRadius: 1.8, prefabName: 'pickup_ammo_box' });
    this.defineItem('weapon_macuahuitl', { type: 'weapon', label: 'Macuahuitl', icon: 'MAC', weaponKey: 'macuahuitl', autoEquip: true, maxStack: 1 });
    this.defineItem('weapon_flareGun', { type: 'weapon', label: 'Flare Gun', icon: 'FLR', weaponKey: 'flareGun', autoEquip: true, maxStack: 1 });
    this.defineItem('weapon_spiritSwarmStaff', { type: 'weapon', label: 'Spirit-Swarm Staff', icon: 'SWS', weaponKey: 'spiritSwarmStaff', autoEquip: true, maxStack: 1 });
    this.defineItem('weapon_poisonBlowgun', { type: 'weapon', label: 'Poison Blowgun', icon: 'PBG', weaponKey: 'poisonBlowgun', autoEquip: true, maxStack: 1 });
    this.defineItem('weapon_shotgun', { type: 'weapon', label: 'Shotgun', icon: 'SG', weaponKey: 'shotgun', autoEquip: true, maxStack: 1, pickupRadius: 1.8, prefabName: 'pickup_shotgun' });
    this.defineItem('weapon_rifle', { type: 'weapon', label: 'Rifle', icon: 'RF', weaponKey: 'rifle', autoEquip: true, maxStack: 1 });
  }

  getDefinition(id: string): ItemDefinition | undefined {
    return this.definitions.get(id);
  }

  initPlayer(player: PlayerRef, maxSlots = this.defaultMaxSlots, maxStackPerSlot = this.defaultMaxStackPerSlot): PlayerInventoryComponent {
    const playerId = toPlayerId(player);
    const existing = this.inventories.get(playerId);
    if (existing) return existing;
    const inventory = createPlayerInventoryComponent(playerId, maxSlots, maxStackPerSlot);
    this.inventories.set(playerId, inventory);
    this.syncInventory(playerId);
    return inventory;
  }

  getInventoryComponent(player: PlayerRef): PlayerInventoryComponent {
    return this.initPlayer(player);
  }

  getInventory(player: PlayerRef): InventoryItemStack[] {
    const inventory = this.initPlayer(player);
    return inventory.slots.map((slot) => ({
      ...slot,
      itemType: this.definitions.get(slot.itemId)?.type ?? 'misc',
      label: this.definitions.get(slot.itemId)?.label ?? slot.itemId,
    }));
  }

  addItem(player: PlayerRef, itemOrId: string | { itemId: string; quantity?: number }, quantity = 1): boolean {
    const playerId = toPlayerId(player);
    const itemId = typeof itemOrId === 'string' ? itemOrId : itemOrId.itemId;
    const stackQuantity = typeof itemOrId === 'string' ? quantity : (itemOrId.quantity ?? quantity);
    const definition = this.definitions.get(itemId);
    if (!definition) return false;

    const inventory = this.initPlayer(playerId);
    const maxStack = Math.max(1, Math.min(definition.maxStack ?? 1, inventory.maxStackPerSlot));
    let remaining = Math.max(1, stackQuantity);

    while (remaining > 0) {
      const existing = inventory.slots.find((slot) => slot.itemId === itemId && slot.quantity < maxStack);
      if (existing) {
        const transfer = Math.min(maxStack - existing.quantity, remaining);
        existing.quantity += transfer;
        remaining -= transfer;
        continue;
      }

      if (inventory.slots.length >= inventory.maxSlots) {
        this.syncInventory(playerId);
        return false;
      }

      const transfer = Math.min(maxStack, remaining);
      inventory.slots.push({ itemId, quantity: transfer });
      remaining -= transfer;
    }

    if (definition.quickSlot !== undefined && inventory.equippedSlotIndex < 0) {
      inventory.equippedSlotIndex = Math.min(definition.quickSlot, inventory.slots.length - 1);
    }

    this.syncInventory(playerId);
    return true;
  }

  giveItem(player: PlayerRef, itemId: string, quantity = 1): boolean {
    return this.addItem(player, itemId, quantity);
  }

  removeItem(player: PlayerRef, slotIndex: number, quantity = 1): boolean {
    const playerId = toPlayerId(player);
    const inventory = this.inventories.get(playerId);
    if (!inventory || slotIndex < 0 || slotIndex >= inventory.slots.length) return false;
    const slot = inventory.slots[slotIndex];
    slot.quantity -= Math.max(1, quantity);
    if (slot.quantity <= 0) {
      inventory.slots.splice(slotIndex, 1);
      if (inventory.equippedSlotIndex === slotIndex) {
        inventory.equippedSlotIndex = inventory.slots.length > 0 ? 0 : -1;
      }
    }
    this.syncInventory(playerId);
    return true;
  }

  equipSlot(player: PlayerRef, slotIndex: number): boolean {
    const playerId = toPlayerId(player);
    const inventory = this.initPlayer(playerId);
    if (slotIndex < 0 || slotIndex >= inventory.slots.length) return false;
    inventory.equippedSlotIndex = slotIndex;

    const slot = inventory.slots[slotIndex];
    const definition = this.definitions.get(slot.itemId);
    if (definition?.type === 'weapon' && definition.weaponKey && this.weapons) {
      this.weapons.equip(playerId, definition.weaponKey);
    }

    this.syncInventory(playerId);
    return true;
  }

  quickSwap(player: PlayerRef, direction: 1 | -1): boolean {
    const playerId = toPlayerId(player);
    const inventory = this.initPlayer(playerId);
    if (inventory.slots.length === 0) return false;
    const nextIndex = inventory.equippedSlotIndex < 0
      ? 0
      : (inventory.equippedSlotIndex + direction + inventory.slots.length) % inventory.slots.length;
    return this.equipSlot(playerId, nextIndex);
  }

  exportState(): { inventories: Record<string, PlayerInventoryComponent>; pickups: PickupRecord[] } {
    const inventories: Record<string, PlayerInventoryComponent> = {};
    for (const [playerId, inventory] of this.inventories) {
      inventories[playerId] = {
        ...inventory,
        slots: inventory.slots.map((slot) => ({ ...slot })),
      };
    }
    return {
      inventories,
      pickups: [...this.pickups.values()].map((pickup) => ({
        ...pickup,
        position: { ...pickup.position },
        component: { ...pickup.component },
      })),
    };
  }

  clearAll(): void {
    this.inventories.clear();
    this.pickups.clear();
  }

  importState(snapshot: { inventories?: Record<string, PlayerInventoryComponent>; pickups?: PickupRecord[] } | undefined): void {
    this.inventories.clear();
    this.pickups.clear();

    for (const [playerId, inventory] of Object.entries(snapshot?.inventories ?? {})) {
      this.inventories.set(playerId, {
        ...inventory,
        slots: (inventory.slots ?? []).map((slot) => ({ ...slot })),
      });
      this.syncInventory(playerId);
    }

    for (const pickup of snapshot?.pickups ?? []) {
      this.pickups.set(pickup.id, {
        ...pickup,
        position: { ...pickup.position },
        component: { ...pickup.component },
      });
    }
  }

  useItem(player: PlayerRef, slotIndex: number): boolean {
    const playerId = toPlayerId(player);
    const inventory = this.inventories.get(playerId);
    if (!inventory || slotIndex < 0 || slotIndex >= inventory.slots.length) return false;
    const slot = inventory.slots[slotIndex];
    const definition = this.definitions.get(slot.itemId);
    if (!definition) return false;

    const used = this.applyItemEffect(playerId, definition, slotIndex);
    if (used) {
      AnalyticsService.track('item_used', { playerId, itemId: definition.id, type: definition.type });
      if (definition.type !== 'weapon') {
        this.removeItem(playerId, slotIndex, 1);
      }
    }
    return used;
  }

  hasKey(player: PlayerRef, keyId: string): boolean {
    const inventory = this.inventories.get(toPlayerId(player));
    if (!inventory) return false;
    return inventory.slots.some((slot) => this.definitions.get(slot.itemId)?.keyId === keyId);
  }

  createPickup(itemId: string, position: Vector3, override?: Partial<PickupComponent>): string {
    const definition = this.definitions.get(itemId);
    if (!definition) {
      throw new Error(`Unknown inventory item: ${itemId}`);
    }

    const pickupId = `pickup_${++this.pickupCounter}`;
    let entityId: string | null = null;

    const component: PickupComponent = {
      type: 'pickup',
      pickupKind: this.mapItemTypeToPickupKind(definition.type),
      itemId,
      prefabName: definition.prefabName,
      weaponName: definition.weaponKey ?? definition.weapon,
      amount: definition.amount,
      autoEquip: definition.autoEquip ?? false,
      autoPickup: true,
      respawnSeconds: definition.respawnTime,
      highlightColor: 0xd4a850,
      ...override,
    };

    if (this.prefabSystem && component.prefabName) {
      entityId = this.prefabSystem.create(component.prefabName, position).id;
    }

    this.pickups.set(pickupId, {
      id: pickupId,
      itemId,
      entityId,
      position: { ...position },
      active: true,
      respawnTimer: 0,
      component,
    });

    this.syncPickups();
    return pickupId;
  }

  spawnPickup(itemId: string, position: Vector3): string {
    return this.createPickup(itemId, position);
  }

  removePickup(pickupId: string): void {
    const pickup = this.pickups.get(pickupId);
    if (!pickup) return;
    if (pickup.entityId) {
      this.prefabSystem?.remove(pickup.entityId);
    }
    this.pickups.delete(pickupId);
    this.syncPickups();
  }

  getPickups(): PickupRecord[] {
    return [...this.pickups.values()].map((pickup) => ({ ...pickup, position: { ...pickup.position }, component: { ...pickup.component } }));
  }

  showInventory(player: PlayerRef): string {
    const playerId = toPlayerId(player);
    const inventory = this.getInventory(playerId);
    const summary = inventory.length === 0
      ? 'Inventory empty'
      : inventory.map((slot, index) => `${index}: ${slot.label} x${slot.quantity}${this.inventories.get(playerId)?.equippedSlotIndex === index ? ' [equipped]' : ''}`).join('\n');
    console.log(summary);
    return summary;
  }

  update(dt: number, entityPositions: Map<string, Vector3>, playerIds: Set<string>): void {
    for (const pickup of this.pickups.values()) {
      if (!pickup.active) {
        pickup.respawnTimer = Math.max(0, pickup.respawnTimer - dt);
        if (pickup.respawnTimer === 0) {
          pickup.active = true;
        }
        continue;
      }

      const definition = this.definitions.get(pickup.itemId);
      if (!definition) continue;
      const radius = definition.pickupRadius ?? 1.5;

      for (const playerId of playerIds) {
        const playerPosition = entityPositions.get(playerId);
        if (!playerPosition) continue;
        const dx = playerPosition.x - pickup.position.x;
        const dz = playerPosition.z - pickup.position.z;
        if (Math.sqrt(dx * dx + dz * dz) <= radius) {
          this.consumePickup(playerId, pickup, definition);
          break;
        }
      }
    }
  }

  onPickup(callback: (playerId: string, item: ItemDefinition, pickupId: string) => void): void {
    this.onPickupCallbacks.push(callback);
  }

  private consumePickup(playerId: string, pickup: PickupRecord, definition: ItemDefinition): void {
    const consumed = this.applyPickup(playerId, definition, pickup.component);
    if (!consumed) return;

    pickup.active = false;
    if (definition.respawnTime && definition.respawnTime > 0) {
      pickup.respawnTimer = definition.respawnTime;
    } else {
      if (pickup.entityId) {
        this.prefabSystem?.remove(pickup.entityId);
      }
      this.pickups.delete(pickup.id);
    }

    AnalyticsService.track('item_picked_up', { playerId, itemId: definition.id, type: definition.type });
    this.onPickupCallbacks.forEach((callback) => callback(playerId, definition, pickup.id));
    this.syncPickups();
  }

  private applyPickup(playerId: string, definition: ItemDefinition, pickup: PickupComponent): boolean {
    switch (definition.type) {
      case 'health':
        return (definition.healAmount ?? 0) > 0 && (this.health?.heal(playerId, definition.healAmount ?? 0) ?? 0) > 0;
      case 'armor': {
        const component = this.health?.get(playerId);
        if (!component || !definition.armorAmount) return false;
        component.armor = Math.min(1, component.armor + definition.armorAmount);
        return true;
      }
      case 'ammo':
        return !!definition.weapon && !!definition.amount && !!this.weapons?.addAmmo(playerId, definition.weapon, definition.amount);
      case 'weapon': {
        if (!definition.weaponKey || !this.weapons) return false;
        const added = this.weapons.pickupWeapon(playerId, definition.weaponKey, definition.amount ?? -1, pickup.autoEquip ?? definition.autoEquip ?? true);
        if (added) {
          this.addItem(playerId, definition.id, 1);
          const inventory = this.inventories.get(playerId);
          if (inventory) {
            inventory.equippedSlotIndex = inventory.slots.findIndex((slot) => slot.itemId === definition.id);
            this.syncInventory(playerId);
          }
        }
        return added;
      }
      case 'prefab':
      case 'key':
      case 'misc':
        return this.addItem(playerId, definition.id, 1);
      default:
        return false;
    }
  }

  private applyItemEffect(playerId: string, definition: ItemDefinition, slotIndex: number): boolean {
    switch (definition.type) {
      case 'health':
        return (this.health?.heal(playerId, definition.healAmount ?? 0) ?? 0) > 0;
      case 'armor': {
        const component = this.health?.get(playerId);
        if (!component || !definition.armorAmount) return false;
        component.armor = Math.min(1, component.armor + definition.armorAmount);
        return true;
      }
      case 'ammo':
        return !!definition.weapon && !!definition.amount && !!this.weapons?.addAmmo(playerId, definition.weapon, definition.amount);
      case 'weapon': {
        const equipped = !!definition.weaponKey && !!this.weapons?.equip(playerId, definition.weaponKey);
        if (equipped) {
          this.equipSlot(playerId, slotIndex);
        }
        return equipped;
      }
      case 'prefab':
        if (!definition.prefabName || !this.prefabSystem) return false;
        this.prefabSystem.create(definition.prefabName, { x: 0, y: 0, z: 0 });
        return true;
      case 'key':
      case 'misc':
        return true;
      default:
        return false;
    }
  }

  private syncInventory(playerId: string): void {
    const inventory = this.inventories.get(playerId);
    if (!inventory || !this.state) return;
    if (!this.isPlayActive) {
      inventory.slots = [];
      inventory.equippedSlotIndex = -1;
      return;
    }
    this.state.set(`inventory.${playerId}`, {
      ...inventory,
      slots: inventory.slots.map((slot) => ({ ...slot })),
    });
    gameBus.emit('stateMutation', {
      source: 'inventorySystem',
      path: `inventory.${playerId}`,
      changedCount: inventory.slots.length,
    });
  }

  private syncPickups(): void {
    if (!this.state) return;
    this.state.set('pickups', [...this.pickups.values()].map((pickup) => ({
      ...pickup,
      position: { ...pickup.position },
      component: { ...pickup.component },
    })));
    gameBus.emit('stateMutation', {
      source: 'inventorySystem',
      path: 'pickups',
      changedCount: this.pickups.size,
    });
  }

  private mapItemTypeToPickupKind(type: ItemType): PickupKind {
    switch (type) {
      case 'weapon': return 'weapon';
      case 'ammo': return 'ammo';
      case 'health':
      case 'armor': return 'health';
      case 'prefab': return 'prefab';
      default: return 'misc';
    }
  }
}
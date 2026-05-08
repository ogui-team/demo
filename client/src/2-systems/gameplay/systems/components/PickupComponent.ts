export type PickupKind = 'weapon' | 'ammo' | 'health' | 'prefab' | 'misc';

export interface PickupComponent {
  readonly type: 'pickup';
  pickupKind: PickupKind;
  itemId?: string;
  prefabName?: string;
  weaponName?: string;
  amount?: number;
  autoEquip?: boolean;
  autoPickup?: boolean;
  respawnSeconds?: number;
  highlightColor?: number;
}

export function createPickupComponent(config: Omit<PickupComponent, 'type'>): PickupComponent {
  return {
    type: 'pickup',
    autoEquip: false,
    autoPickup: true,
    highlightColor: 0xd4a850,
    ...config,
  };
}
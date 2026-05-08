export interface InventorySlotState {
  itemId: string;
  quantity: number;
  equipped?: boolean;
}

export interface PlayerInventoryComponent {
  readonly type: 'inventory';
  ownerId: string;
  slots: InventorySlotState[];
  maxSlots: number;
  maxStackPerSlot: number;
  equippedSlotIndex: number;
  quickSlots: number[];
}

export function createPlayerInventoryComponent(
  ownerId: string,
  maxSlots = 8,
  maxStackPerSlot = 99,
): PlayerInventoryComponent {
  return {
    type: 'inventory',
    ownerId,
    slots: [],
    maxSlots,
    maxStackPerSlot,
    equippedSlotIndex: -1,
    quickSlots: [0, 1, 2, 3],
  };
}
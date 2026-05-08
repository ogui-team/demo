/**
 * InventoryStorage - DOD Buffer for Player Inventory
 * 
 * CONSTRAINT: Zero-Object-Creation
 * - Grid is contiguous Uint16Array (ItemIDs only)
 * - No object instantiation for grid slots
 * - Direct buffer index operations for O(1) drop/pickup
 * 
 * Memory Layout:
 * - ammoValues:     Uint32Array[capacity] - current ammo in equipped weapon
 * - itemIdValues:   Uint32Array[capacity] - equipped item type
 * - gridBuffer:     Uint16Array[capacity * 40] - inventory grid (10x4 slots per player)
 * - gridMetadata:   Uint32Array[capacity] - selected/equipped slot indices
 */

export class InventoryStorage {
  private readonly capacity: number;
  private readonly ammoValues: Uint32Array;
  private readonly itemIdValues: Uint32Array;
  private readonly gridBuffer: Uint16Array;
  private readonly gridMetadata: Uint32Array;

  private readonly GRID_COLUMNS = 10;
  private readonly GRID_ROWS = 4;
  private readonly SLOTS_PER_PLAYER = this.GRID_COLUMNS * this.GRID_ROWS; // 40
  private readonly SELECTED_SLOT_MASK = 0xFF;
  private readonly EQUIPPED_SLOT_MASK = 0xFF00;
  private readonly EQUIPPED_SLOT_SHIFT = 8;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('InventoryStorage capacity must be a positive integer');
    }
    this.capacity = capacity;
    this.ammoValues = new Uint32Array(capacity);
    this.itemIdValues = new Uint32Array(capacity);
    this.gridBuffer = new Uint16Array(capacity * this.SLOTS_PER_PLAYER); // Zero-initialization
    this.gridMetadata = new Uint32Array(capacity); // Zero-initialization (all slots empty)
  }

  get maxCapacity(): number {
    return this.capacity;
  }

  getAmmoBuffer(): Uint32Array {
    return this.ammoValues;
  }

  getItemIdBuffer(): Uint32Array {
    return this.itemIdValues;
  }

  /**
   * Get grid buffer for inventory items (Uint16Array of ItemIDs)
   * Direct zero-copy access to grid for CRC32 hashing and bulk operations
   */
  getGridBuffer(): Uint16Array {
    return this.gridBuffer;
  }

  /**
   * Get grid metadata buffer (selected/equipped slot indices)
   */
  getGridMetadataBuffer(): Uint32Array {
    return this.gridMetadata;
  }

  setAmmo(denseIndex: number, ammo: number): void {
    this.ammoValues[denseIndex] = ammo;
  }

  setItemId(denseIndex: number, itemId: number): void {
    this.itemIdValues[denseIndex] = itemId;
  }

  getAmmo(denseIndex: number): number {
    return this.ammoValues[denseIndex];
  }

  getItemId(denseIndex: number): number {
    return this.itemIdValues[denseIndex];
  }

  /**
   * Get item at grid slot (O(1) direct buffer access)
   * @param playerDenseIndex - player's dense index
   * @param slotIndex - slot index (0-39)
   * @returns ItemID (0 = empty)
   */
  getGridItem(playerDenseIndex: number, slotIndex: number): number {
    const baseOffset = playerDenseIndex * this.SLOTS_PER_PLAYER;
    return this.gridBuffer[baseOffset + slotIndex];
  }

  /**
   * Set item at grid slot (O(1) direct buffer mutation)
   * @param playerDenseIndex - player's dense index
   * @param slotIndex - slot index (0-39)
   * @param itemId - ItemID to place (0 = empty)
   */
  setGridItem(playerDenseIndex: number, slotIndex: number, itemId: number): void {
    const baseOffset = playerDenseIndex * this.SLOTS_PER_PLAYER;
    this.gridBuffer[baseOffset + slotIndex] = itemId & 0xFFFF; // Ensure Uint16
  }

  /**
   * Get selected slot index for player
   * @param playerDenseIndex - player's dense index
   * @returns slot index (0-39)
   */
  getSelectedSlot(playerDenseIndex: number): number {
    const metadata = this.gridMetadata[playerDenseIndex];
    return metadata & this.SELECTED_SLOT_MASK;
  }

  /**
   * Set selected slot for player
   * @param playerDenseIndex - player's dense index
   * @param slotIndex - slot index (0-39)
   */
  setSelectedSlot(playerDenseIndex: number, slotIndex: number): void {
    const metadata = this.gridMetadata[playerDenseIndex];
    const newMetadata = (metadata & ~this.SELECTED_SLOT_MASK) | (slotIndex & 0xFF);
    this.gridMetadata[playerDenseIndex] = newMetadata;
  }

  /**
   * Get equipped slot index for player
   * @param playerDenseIndex - player's dense index
   * @returns slot index (0-39) or 255 if none equipped
   */
  getEquippedSlot(playerDenseIndex: number): number {
    const metadata = this.gridMetadata[playerDenseIndex];
    return (metadata & this.EQUIPPED_SLOT_MASK) >> this.EQUIPPED_SLOT_SHIFT;
  }

  /**
   * Set equipped slot for player (weapon currently held)
   * @param playerDenseIndex - player's dense index
   * @param slotIndex - slot index (0-39) or 255 for unequip
   */
  setEquippedSlot(playerDenseIndex: number, slotIndex: number): void {
    const metadata = this.gridMetadata[playerDenseIndex];
    const newMetadata = (metadata & ~this.EQUIPPED_SLOT_MASK) | ((slotIndex & 0xFF) << this.EQUIPPED_SLOT_SHIFT);
    this.gridMetadata[playerDenseIndex] = newMetadata;
  }

  /**
   * Find first empty slot in grid (linear O(40) search)
   * @param playerDenseIndex - player's dense index
   * @returns first empty slot index (0-39) or -1 if full
   */
  findFirstEmptySlot(playerDenseIndex: number): number {
    const baseOffset = playerDenseIndex * this.SLOTS_PER_PLAYER;
    for (let i = 0; i < this.SLOTS_PER_PLAYER; i++) {
      if (this.gridBuffer[baseOffset + i] === 0) {
        return i;
      }
    }
    return -1; // No empty slots
  }

  /**
   * Clear all inventory state for entity range
   * @param activeCount - number of active entities to clear
   */
  clear(activeCount: number): void {
    this.ammoValues.fill(0, 0, activeCount);
    this.itemIdValues.fill(0, 0, activeCount);
    this.gridBuffer.fill(0, 0, activeCount * this.SLOTS_PER_PLAYER);
    this.gridMetadata.fill(0, 0, activeCount);
  }
}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InventoryGridManager } from '../../../../../client/src/engine/gameplay/systems/InventoryGridManager';
import type { GridInventory, GridItem } from '../../../../../client/src/engine/gameplay/systems/InventoryGridManager';

describe('InventoryGridManager: Physgun & Drop Functionality', () => {
  let manager: InventoryGridManager;
  const playerId = 'test-player';
  const serverBase = 'http://localhost:3000';

  beforeEach(() => {
    manager = new InventoryGridManager(serverBase);
  });

  describe('Offline Initialization - Physgun Inclusion', () => {
    it('includes physgun_tool in offline inventory when initialized', async () => {
      await manager.initOffline(playerId, ['physgun_tool', 'weapon_pistol', 'health_small']);

      const inv = manager.getInventory();
      expect(inv).not.toBeNull();
      expect(inv?.items.length).toBe(3);

      const itemIds = inv!.items.map((item) => item.itemId);
      expect(itemIds).toContain('physgun_tool');
      expect(itemIds).toContain('weapon_pistol');
      expect(itemIds).toContain('health_small');
    });

    it('physgun_tool has catalog entry in fallback', async () => {
      await manager.initOffline(playerId, ['physgun_tool']);

      const physgunDef = manager.getItemInfo('physgun_tool');
      expect(physgunDef).not.toBeNull();
      expect(physgunDef?.label).toBe('Physics Gun');
      expect(physgunDef?.type).toBe('misc');
      expect(physgunDef?.symbol).toBe('PHY');
      expect(physgunDef?.color).toBe('#081828');
    });

    it('init with server unreachable includes physgun in fallback items', async () => {
      // Spy on initOffline to capture what items are passed
      const initOfflineSpy = vi.spyOn(manager, 'initOffline');

      // Mock fetch to simulate server unreachable
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

      await manager.init(playerId);

      // Verify initOffline was called with physgun_tool included
      expect(initOfflineSpy).toHaveBeenCalled();
      const [calledPlayerId, calledItems] = initOfflineSpy.mock.calls[0];
      expect(calledPlayerId).toBe(playerId);
      expect(calledItems).toContain('physgun_tool');
      expect(calledItems).toContain('weapon_pistol');

      vi.unstubAllGlobals();
    });
  });

  describe('Drop Functionality - Offline Mode', () => {
    it('optimistically removes item from inventory on drop', async () => {
      await manager.initOffline(playerId, ['physgun_tool', 'weapon_pistol', 'health_small']);

      const inv = manager.getInventory();
      expect(inv?.items.length).toBe(3);

      const itemToDropId = inv!.items[0].instanceId;
      const result = await manager.dropItem(itemToDropId);

      // Should be removed from inventory
      expect(inv?.items.length).toBe(2);
      const remainingIds = inv!.items.map((i) => i.instanceId);
      expect(remainingIds).not.toContain(itemToDropId);
    });

    it('accepts drop in offline mode when server unreachable', async () => {
      await manager.initOffline(playerId, ['weapon_pistol', 'health_small']);

      const inv = manager.getInventory();
      const itemToDropId = inv!.items[0].instanceId;

      // Mock fetch to simulate network error
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new Error('Failed to fetch')),
      );

      const result = await manager.dropItem(itemToDropId);

      // Should succeed in offline mode
      expect(result).toBe(true);
      // Item should still be removed
      expect(inv!.items.map((i) => i.instanceId)).not.toContain(itemToDropId);

      vi.unstubAllGlobals();
    });

    it('accepts drop even when server returns error (offline resilience)', async () => {
      await manager.initOffline(playerId, ['weapon_pistol', 'health_small']);

      const inv = manager.getInventory();
      const initialItems = [...inv!.items];
      const itemToDropId = inv!.items[0].instanceId;

      // Mock fetch to simulate server error (not a network error)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const result = await manager.dropItem(itemToDropId);

      // Should succeed (accept offline drop)
      expect(result).toBe(true);
      // Items should NOT be reverted - drop is accepted in offline mode
      expect(inv!.items.length).toBe(initialItems.length - 1);

      vi.unstubAllGlobals();
    });

    it('reverts pending drop when server rejects it while online', async () => {
      await manager.initOffline(playerId, ['weapon_pistol', 'health_small']);
      (manager as any).offlineMode = false;

      const inv = manager.getInventory();
      const initialItems = [...inv!.items];
      const itemToDropId = inv!.items[0].instanceId;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const result = await manager.dropItem(itemToDropId);

      expect(result).toBe(false);
      expect(inv!.items.length).toBe(initialItems.length);
      expect(inv!.items.map((i) => i.instanceId)).toContain(itemToDropId);

      vi.unstubAllGlobals();
    });

    it('reverts an equipped item when drop fails while online', async () => {
      await manager.initOffline(playerId, ['weapon_pistol', 'health_small']);
      (manager as any).offlineMode = false;

      const inv = manager.getInventory();
      const itemToDropId = inv!.items[0].instanceId;
      inv!.equippedWeapon = itemToDropId;

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 409,
        }),
      );

      const result = await manager.dropItem(itemToDropId);

      expect(result).toBe(false);
      expect(inv!.items.map((i) => i.instanceId)).toContain(itemToDropId);
      expect(inv!.equippedWeapon).toBe(itemToDropId);

      vi.unstubAllGlobals();
    });

    it('handles drop of non-existent item gracefully', async () => {
      await manager.initOffline(playerId, ['weapon_pistol']);

      const result = await manager.dropItem('nonexistent-instance-id');

      expect(result).toBe(false);
    });
  });

  describe('Toolbar Integration', () => {
    it('physgun_tool can be retrieved from catalog for toolbar display', async () => {
      await manager.initOffline(playerId, ['physgun_tool', 'weapon_pistol']);

      const physgunDef = manager.getItemInfo('physgun_tool');
      expect(physgunDef).toBeDefined();

      // Verify all fields needed for toolbar icon rendering exist
      expect(physgunDef?.id).toBe('physgun_tool');
      expect(physgunDef?.label).toBe('Physics Gun');
      expect(physgunDef?.symbol).toBe('PHY');
      expect(physgunDef?.color).toBeDefined();
      expect(physgunDef?.gridW).toBeGreaterThan(0);
      expect(physgunDef?.gridH).toBeGreaterThan(0);
    });
  });
});

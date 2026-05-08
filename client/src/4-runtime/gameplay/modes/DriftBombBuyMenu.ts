/**
 * DRIFT BOMB BUY MENU SYSTEM
 * Counter-Strike style weapon and equipment purchasing
 */

export interface BuyableItem {
  id: string;
  name: string;
  category: 'primary' | 'secondary' | 'utility' | 'armor';
  cost: number;
  canMultiPurchase: boolean;
}

export const BUYABLE_ITEMS: Record<string, BuyableItem> = {
  // Primary weapons
  'rifle_ar': {
    id: 'rifle_ar',
    name: 'Assault Rifle',
    category: 'primary',
    cost: 2900,
    canMultiPurchase: false,
  },
  'rifle_awp': {
    id: 'rifle_awp',
    name: 'AWP Sniper',
    category: 'primary',
    cost: 4750,
    canMultiPurchase: false,
  },
  'smg_mp7': {
    id: 'smg_mp7',
    name: 'MP7 SMG',
    category: 'primary',
    cost: 1900,
    canMultiPurchase: false,
  },
  'shotgun_mag7': {
    id: 'shotgun_mag7',
    name: 'MAG-7 Shotgun',
    category: 'primary',
    cost: 2050,
    canMultiPurchase: false,
  },

  // Secondary weapons
  'pistol_standard': {
    id: 'pistol_standard',
    name: 'Standard Pistol',
    category: 'secondary',
    cost: 500,
    canMultiPurchase: false,
  },
  'pistol_heavy': {
    id: 'pistol_heavy',
    name: 'Desert Eagle',
    category: 'secondary',
    cost: 700,
    canMultiPurchase: false,
  },

  // Utility
  'grenade_frag': {
    id: 'grenade_frag',
    name: 'Frag Grenade',
    category: 'utility',
    cost: 300,
    canMultiPurchase: true,
  },
  'grenade_smoke': {
    id: 'grenade_smoke',
    name: 'Smoke Grenade',
    category: 'utility',
    cost: 200,
    canMultiPurchase: true,
  },
  'utility_flashbang': {
    id: 'utility_flashbang',
    name: 'Flashbang',
    category: 'utility',
    cost: 200,
    canMultiPurchase: true,
  },
  'utility_defuse_kit': {
    id: 'utility_defuse_kit',
    name: 'Defuse Kit (Defenders)',
    category: 'utility',
    cost: 400,
    canMultiPurchase: false,
  },

  // Armor
  'armor_light': {
    id: 'armor_light',
    name: 'Light Armor',
    category: 'armor',
    cost: 400,
    canMultiPurchase: false,
  },
  'armor_heavy': {
    id: 'armor_heavy',
    name: 'Heavy Armor + Helmet',
    category: 'armor',
    cost: 1000,
    canMultiPurchase: false,
  },
};

export interface PlayerLoadout {
  entityId: string;
  weapons: string[];
  armor: string | null;
  utility: string[];
  totalSpent: number;
}

export interface BuyMenuState {
  playerId: string;
  budget: number;
  currentLoadout: PlayerLoadout;
  availableBudget: number;
}

export class DriftBombBuyMenu {
  private state: BuyMenuState;
  private container: HTMLElement | null = null;
  private isVisible: boolean = false;

  constructor(playerId: string, initialBudget: number, entityId: string) {
    this.state = {
      playerId,
      budget: initialBudget,
      currentLoadout: {
        entityId,
        weapons: ['pistol_standard'],
        armor: null,
        utility: [],
        totalSpent: 0,
      },
      availableBudget: initialBudget,
    };
  }

  initialize(containerId: string = 'game-container'): void {
    const parent = document.getElementById(containerId) ?? document.body;

    this.container = document.createElement('div');
    this.container.id = 'drift-bomb-buy-menu';
    this.container.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      max-height: 60vh;
      background: rgba(0, 20, 40, 0.95);
      border: 2px solid #00ff00;
      border-radius: 8px;
      padding: 12px;
      font-family: monospace;
      color: #00ff00;
      font-size: 12px;
      z-index: 100;
      overflow-y: auto;
      display: none;
    `;

    parent.appendChild(this.container);
  }

  show(): void {
    if (!this.container) return;
    this.isVisible = true;
    this.container.style.display = 'block';
    this.render();
  }

  hide(): void {
    if (!this.container) return;
    this.isVisible = false;
    this.container.style.display = 'none';
  }

  toggleVisibility(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Attempt to purchase an item
   */
  purchaseItem(itemId: string): boolean {
    const item = BUYABLE_ITEMS[itemId];
    if (!item) return false;

    // Check budget
    if (this.state.availableBudget < item.cost) {
      console.warn(`[BuyMenu] Insufficient budget for ${item.name}`);
      return false;
    }

    // Check if already have (for non-multipurchase items)
    if (!item.canMultiPurchase && this.hasItem(itemId)) {
      console.warn(`[BuyMenu] Already own ${item.name}`);
      return false;
    }

    // Apply purchase
    this.state.availableBudget -= item.cost;
    this.state.currentLoadout.totalSpent += item.cost;

    if (item.category === 'primary' || item.category === 'secondary') {
      // Replace existing weapon in category
      const existingIdx = this.state.currentLoadout.weapons.findIndex(
        (w) => BUYABLE_ITEMS[w]?.category === item.category,
      );
      if (existingIdx >= 0) {
        this.state.currentLoadout.weapons[existingIdx] = itemId;
      } else {
        this.state.currentLoadout.weapons.push(itemId);
      }
    } else if (item.category === 'armor') {
      this.state.currentLoadout.armor = itemId;
    } else if (item.category === 'utility') {
      this.state.currentLoadout.utility.push(itemId);
    }

    this.render();
    return true;
  }

  /**
   * Complete purchase and lock loadout
   */
  confirmPurchase(): PlayerLoadout {
    return { ...this.state.currentLoadout };
  }

  /**
   * Reset to initial state
   */
  resetPurchase(): void {
    this.state.currentLoadout = {
      entityId: this.state.currentLoadout.entityId,
      weapons: ['pistol_standard'],
      armor: null,
      utility: [],
      totalSpent: 0,
    };
    this.state.availableBudget = this.state.budget;
    this.render();
  }

  getState(): Readonly<BuyMenuState> {
    return { ...this.state };
  }

  private hasItem(itemId: string): boolean {
    const item = BUYABLE_ITEMS[itemId];
    if (!item) return false;

    if (item.category === 'primary' || item.category === 'secondary') {
      return this.state.currentLoadout.weapons.includes(itemId);
    } else if (item.category === 'armor') {
      return this.state.currentLoadout.armor === itemId;
    } else if (item.category === 'utility') {
      return this.state.currentLoadout.utility.includes(itemId);
    }

    return false;
  }

  private render(): void {
    if (!this.container) return;

    const primaryItems = Object.values(BUYABLE_ITEMS).filter((item) => item.category === 'primary');
    const secondaryItems = Object.values(BUYABLE_ITEMS).filter((item) => item.category === 'secondary');
    const utilityItems = Object.values(BUYABLE_ITEMS).filter((item) => item.category === 'utility');
    const armorItems = Object.values(BUYABLE_ITEMS).filter((item) => item.category === 'armor');

    let html = `
      <div style="border-bottom: 1px solid #00ff00; padding-bottom: 8px; margin-bottom: 8px;">
        <div><strong>BUY MENU</strong></div>
        <div>Budget: $${this.state.availableBudget} / $${this.state.budget}</div>
        <div>Spent: $${this.state.currentLoadout.totalSpent}</div>
      </div>
    `;

    // Primary weapons
    if (primaryItems.length > 0) {
      html += '<div style="margin-bottom: 8px;"><strong>PRIMARY:</strong></div>';
      for (const item of primaryItems) {
        const equipped = this.state.currentLoadout.weapons.includes(item.id) ? ' ✓' : '';
        const canBuy = this.state.availableBudget >= item.cost ? '' : ' [NO FUNDS]';
        html += `<div style="cursor: pointer; padding: 2px 4px; ${this.state.availableBudget >= item.cost ? '' : 'opacity: 0.5;'}" 
          onclick="window.driftBombBuyMenu?.purchaseItem('${item.id}')">
          ${item.name} $${item.cost}${equipped}${canBuy}
        </div>`;
      }
    }

    // Secondary weapons
    if (secondaryItems.length > 0) {
      html += '<div style="margin-top: 8px; margin-bottom: 8px;"><strong>SECONDARY:</strong></div>';
      for (const item of secondaryItems) {
        const equipped = this.state.currentLoadout.weapons.includes(item.id) ? ' ✓' : '';
        const canBuy = this.state.availableBudget >= item.cost ? '' : ' [NO FUNDS]';
        html += `<div style="cursor: pointer; padding: 2px 4px; ${this.state.availableBudget >= item.cost ? '' : 'opacity: 0.5;'}" 
          onclick="window.driftBombBuyMenu?.purchaseItem('${item.id}')">
          ${item.name} $${item.cost}${equipped}${canBuy}
        </div>`;
      }
    }

    // Armor
    if (armorItems.length > 0) {
      html += '<div style="margin-top: 8px; margin-bottom: 8px;"><strong>ARMOR:</strong></div>';
      for (const item of armorItems) {
        const equipped = this.state.currentLoadout.armor === item.id ? ' ✓' : '';
        const canBuy = this.state.availableBudget >= item.cost ? '' : ' [NO FUNDS]';
        html += `<div style="cursor: pointer; padding: 2px 4px; ${this.state.availableBudget >= item.cost ? '' : 'opacity: 0.5;'}" 
          onclick="window.driftBombBuyMenu?.purchaseItem('${item.id}')">
          ${item.name} $${item.cost}${equipped}${canBuy}
        </div>`;
      }
    }

    // Utility
    if (utilityItems.length > 0) {
      html += '<div style="margin-top: 8px; margin-bottom: 8px;"><strong>UTILITY:</strong></div>';
      for (const item of utilityItems) {
        const count = this.state.currentLoadout.utility.filter((u) => u === item.id).length;
        const equipped = count > 0 ? ` (${count})` : '';
        const canBuy = this.state.availableBudget >= item.cost ? '' : ' [NO FUNDS]';
        html += `<div style="cursor: pointer; padding: 2px 4px; ${this.state.availableBudget >= item.cost ? '' : 'opacity: 0.5;'}" 
          onclick="window.driftBombBuyMenu?.purchaseItem('${item.id}')">
          ${item.name} $${item.cost}${equipped}${canBuy}
        </div>`;
      }
    }

    html += `
      <div style="margin-top: 12px; border-top: 1px solid #00ff00; padding-top: 8px; display: flex; gap: 4px;">
        <button style="flex: 1; padding: 4px; background: #00ff00; color: #000; cursor: pointer; font-family: monospace; font-size: 11px;"
          onclick="window.driftBombBuyMenu?.confirmPurchase(); this.textContent='✓ LOCKED'">
          CONFIRM
        </button>
        <button style="flex: 1; padding: 4px; background: #ff0000; color: #fff; cursor: pointer; font-family: monospace; font-size: 11px;"
          onclick="window.driftBombBuyMenu?.resetPurchase()">
          RESET
        </button>
      </div>
    `;

    this.container.innerHTML = html;

    // Make global for onclick handlers
    (window as any).driftBombBuyMenu = this;
  }

  destroy(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
  }
}

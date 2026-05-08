/**
 * Item Catalog
 *
 * Single source of truth for every item that can appear in the grid inventory.
 * gridW / gridH are in inventory grid cells (1 cell = 44 × 44 px on the client).
 * color is a CSS colour string used as the icon background.
 * symbol is the short text shown inside the icon.
 */

export type ItemCategory = 'weapon' | 'armor' | 'consumable' | 'ammo' | 'key' | 'misc';

export interface CatalogItem {
  id:          string;
  label:       string;
  type:        ItemCategory;
  gridW:       number;       // columns in grid
  gridH:       number;       // rows in grid
  maxStack:    number;
  description: string;
  stats?:      Record<string, number>;
  /** CSS background colour for the icon */
  color:       string;
  /** Short text / symbol drawn on the icon */
  symbol:      string;
}

export const ITEM_CATALOG: CatalogItem[] = [
  // ── Consumables ──────────────────────────────────────────────────────────
  {
    id: 'health_potion_sm', label: 'Health Potion', type: 'consumable',
    gridW: 1, gridH: 2, maxStack: 3,
    description: 'Restores 25 HP.', stats: { heal: 25 },
    color: '#2e0808', symbol: 'HP',
  },
  {
    id: 'health_potion_lg', label: 'Full Heal Vial', type: 'consumable',
    gridW: 1, gridH: 2, maxStack: 2,
    description: 'Restores 60 HP.', stats: { heal: 60 },
    color: '#4a0c0c', symbol: 'H+',
  },
  {
    id: 'stim_pack', label: 'Stim Pack', type: 'consumable',
    gridW: 1, gridH: 1, maxStack: 4,
    description: 'Instantly restores 10 HP.', stats: { heal: 10 },
    color: '#3a1020', symbol: 'STM',
  },

  // ── Weapons ──────────────────────────────────────────────────────────────
  {
    id: 'weapon_pistol', label: 'Pistol', type: 'weapon',
    gridW: 2, gridH: 1, maxStack: 1,
    description: '9 mm sidearm. Accurate at medium range.',
    stats: { damage: 20, range: 30, rateOfFire: 3 },
    color: '#101828', symbol: 'PST',
  },
  {
    id: 'weapon_shotgun', label: 'Shotgun', type: 'weapon',
    gridW: 2, gridH: 3, maxStack: 1,
    description: 'Pump-action scatter gun. Devastating at close range.',
    stats: { damage: 60, range: 10, rateOfFire: 1 },
    color: '#1a1a28', symbol: 'SHG',
  },
  {
    id: 'weapon_rifle', label: 'Assault Rifle', type: 'weapon',
    gridW: 2, gridH: 3, maxStack: 1,
    description: 'Full-auto rifle. Reliable across distances.',
    stats: { damage: 35, range: 60, rateOfFire: 8 },
    color: '#0c1820', symbol: 'RFL',
  },
  {
    id: 'weapon_rifle_ar', label: 'Assault Rifle', type: 'weapon',
    gridW: 2, gridH: 3, maxStack: 1,
    description: 'Drift Bomb attacker rifle loadout.',
    stats: { damage: 35, range: 60, rateOfFire: 8 },
    color: '#0c1820', symbol: 'RFL',
  },
  {
    id: 'weapon_knife', label: 'Combat Knife', type: 'weapon',
    gridW: 1, gridH: 2, maxStack: 1,
    description: 'Silent melee. One-hit kill from behind.',
    stats: { damage: 45, range: 1, rateOfFire: 2 },
    color: '#101a1a', symbol: 'KNF',
  },
  {
    id: 'weapon_smg', label: 'SMG', type: 'weapon',
    gridW: 2, gridH: 2, maxStack: 1,
    description: 'Compact submachine gun. High rate of fire.',
    stats: { damage: 22, range: 25, rateOfFire: 12 },
    color: '#181828', symbol: 'SMG',
  },

  // ── Armor ─────────────────────────────────────────────────────────────────
  {
    id: 'armor_vest', label: 'Kevlar Vest', type: 'armor',
    gridW: 2, gridH: 3, maxStack: 1,
    description: 'Ballistic vest. +50 armor points.',
    stats: { armor: 50 },
    color: '#0c0c1e', symbol: 'VES',
  },
  {
    id: 'armor_helmet', label: 'Helmet', type: 'armor',
    gridW: 2, gridH: 2, maxStack: 1,
    description: 'Ballistic helmet. +20 armor points.',
    stats: { armor: 20 },
    color: '#0c0c1e', symbol: 'HLM',
  },

  // ── Ammo ──────────────────────────────────────────────────────────────────
  {
    id: 'ammo_9mm', label: '9mm Rounds', type: 'ammo',
    gridW: 1, gridH: 1, maxStack: 4,
    description: '15-round box of 9 mm pistol ammo.',
    stats: { rounds: 15 },
    color: '#1e180a', symbol: '9MM',
  },
  {
    id: 'ammo_shells', label: 'Shotgun Shells', type: 'ammo',
    gridW: 1, gridH: 1, maxStack: 6,
    description: '8-shell box of 12-gauge buckshot.',
    stats: { rounds: 8 },
    color: '#1e1408', symbol: 'SHL',
  },
  {
    id: 'ammo_rifle_mag', label: 'Rifle Magazine', type: 'ammo',
    gridW: 1, gridH: 2, maxStack: 4,
    description: '30-round magazine, 5.56 mm.',
    stats: { rounds: 30 },
    color: '#141e10', symbol: 'MAG',
  },
  {
    id: 'ammo_smg_mag', label: 'SMG Magazine', type: 'ammo',
    gridW: 1, gridH: 2, maxStack: 4,
    description: '25-round SMG magazine, 9 mm.',
    stats: { rounds: 25 },
    color: '#141a1e', symbol: 'SMG',
  },

  // ── Keys ──────────────────────────────────────────────────────────────────
  {
    id: 'key_red', label: 'Red Key', type: 'key',
    gridW: 1, gridH: 1, maxStack: 1,
    description: 'Opens red-coded security doors.',
    color: '#280000', symbol: 'KEY',
  },
  {
    id: 'key_blue', label: 'Blue Key', type: 'key',
    gridW: 1, gridH: 1, maxStack: 1,
    description: 'Opens blue-coded security doors.',
    color: '#000028', symbol: 'KEY',
  },
  {
    id: 'key_yellow', label: 'Yellow Key', type: 'key',
    gridW: 1, gridH: 1, maxStack: 1,
    description: 'Opens yellow-coded security doors.',
    color: '#1e1800', symbol: 'KEY',
  },

  // ── Client pickup aliases (prefab itemId → catalog entry) ────────────────
  // These ids are used by pickup prefab JSONs and must exist in the catalog.
  {
    id: 'health_small', label: 'Health Pack', type: 'consumable',
    gridW: 1, gridH: 1, maxStack: 3,
    description: 'Restores 25 HP.',
    stats: { heal: 25 },
    color: '#2e1010', symbol: 'HP',
  },
  {
    id: 'shotgun_shells', label: 'Shotgun Shells', type: 'ammo',
    gridW: 1, gridH: 1, maxStack: 6,
    description: '8-shell box of 12-gauge buckshot.',
    stats: { rounds: 8 },
    color: '#1e1408', symbol: 'SHL',
  },

  // ── Tools ──────────────────────────────────────────────────────────────────
  {
    id: 'physgun_tool', label: 'Physics Gun', type: 'misc',
    gridW: 2, gridH: 1, maxStack: 1,
    description: 'Gravity manipulation tool. Hold G to grab objects.',
    stats: {},
    color: '#081828', symbol: 'PHY',
  },

  // ── Misc ──────────────────────────────────────────────────────────────────
  {
    id: 'data_chip', label: 'Data Chip', type: 'misc',
    gridW: 1, gridH: 1, maxStack: 5,
    description: 'Encrypted data chip. High value.',
    color: '#081808', symbol: 'DAT',
  },
  {
    id: 'drift_bomb_device', label: 'Drift Bomb', type: 'misc',
    gridW: 2, gridH: 2, maxStack: 1,
    description: 'Objective charge carried by attackers and planted at the bomb site.',
    color: '#281808', symbol: 'BMB',
  },
  {
    id: 'gold_coin', label: 'Gold', type: 'misc',
    gridW: 1, gridH: 1, maxStack: 99,
    description: 'Currency unit.',
    color: '#1e1600', symbol: 'GLD',
  },
  {
    id: 'grenade', label: 'Frag Grenade', type: 'misc',
    gridW: 1, gridH: 1, maxStack: 3,
    description: 'Explosive device. Cook and throw.',
    stats: { damage: 80, blastRadius: 4 },
    color: '#1a1a10', symbol: 'GRN',
  },
];

/** Index of catalog by id for O(1) lookup. */
export const CATALOG_MAP = new Map<string, CatalogItem>(
  ITEM_CATALOG.map((item) => [item.id, item]),
);

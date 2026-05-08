export type TropicalHorrorArchetypeId = 'obsidian-ravager' | 'tattered-shaman' | 'jungle-stalker';

export interface TropicalHorrorHUDTheme {
  healthFull: string;
  healthMid: string;
  healthLow: string;
  text: string;
  background: string;
  accent: string;
  panel: string;
  border: string;
  shadow: string;
  damageFlash: string;
  crosshair: string;
  notification: string;
  atmosphere: string;
}

export interface TropicalHorrorDamageTheme {
  fill: string;
  stroke: string;
  shadow: string;
  fontFamily: string;
  fontSize: number;
}

export interface TropicalHorrorAvatarAppearance {
  modelVariant?: 'operator' | 'scout' | 'heavy';
  textureStyle?: 'flat' | 'checker' | 'stripes' | 'digital';
  bodyColor?: number;
  accentColor?: number;
  skinColor?: number;
  legColor?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  heightScale?: number;
  widthScale?: number;
}

export interface TropicalHorrorArchetypeStats {
  maxHealth: number;
  maxMana: number;
  maxShield: number;
  armor: number;
  moveSpeed: number;
  damageMultiplier: number;
  attackSpeed: number;
  classLabel: string;
}

export interface TropicalHorrorArchetypeSpawn {
  weapons: string[];
  startAmmo?: Record<string, { current: number; reserve: number }>;
  conditionTags: string[];
}

export interface TropicalHorrorArchetypeDefinition {
  id: TropicalHorrorArchetypeId;
  displayName: string;
  title: string;
  subtitle: string;
  description: string;
  stats: TropicalHorrorArchetypeStats;
  spawn: TropicalHorrorArchetypeSpawn;
  appearance: TropicalHorrorAvatarAppearance;
  hudTheme: TropicalHorrorHUDTheme;
  damageTheme: TropicalHorrorDamageTheme;
}

export const TROPICAL_HORROR_ARCHETYPE_IDS: TropicalHorrorArchetypeId[] = [
  'obsidian-ravager',
  'tattered-shaman',
  'jungle-stalker',
];

export const DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID: TropicalHorrorArchetypeId = 'obsidian-ravager';
export const TROPICAL_HORROR_ARCHETYPE_STORAGE_KEY = 'tropical-horror.selected-archetype';

const TROPICAL_HORROR_ARCHETYPES: Record<TropicalHorrorArchetypeId, TropicalHorrorArchetypeDefinition> = {
  'obsidian-ravager': {
    id: 'obsidian-ravager',
    displayName: 'Obsidian Ravager',
    title: 'The Ember Maw',
    subtitle: 'Ritual vanguard of basalt and blood',
    description: 'A close-range breaker clad in volcanic lacquer, fed by impact and fear.',
    stats: {
      maxHealth: 165,
      maxMana: 40,
      maxShield: 18,
      armor: 0.18,
      moveSpeed: 5.7,
      damageMultiplier: 1.22,
      attackSpeed: 0.96,
      classLabel: 'Ravager',
    },
    spawn: {
      weapons: ['macuahuitl', 'flareGun'],
      startAmmo: {
        flareGun: { current: 1, reserve: 6 },
      },
      conditionTags: ['archetype_ravager', 'ritual_frenzy', 'obsidian_guard'],
    },
    appearance: {
      modelVariant: 'heavy',
      textureStyle: 'stripes',
      bodyColor: 0x231612,
      accentColor: 0xff7a1a,
      skinColor: 0x7d563f,
      legColor: 0x130907,
      scaleX: 1.12,
      scaleY: 1.08,
      scaleZ: 1.08,
    },
    hudTheme: {
      healthFull: '#e39a42',
      healthMid: '#c45b28',
      healthLow: '#8a2017',
      text: '#f4d7b1',
      background: 'rgba(17, 9, 7, 0.86)',
      accent: '#ff7a1a',
      panel: 'rgba(27, 12, 8, 0.82)',
      border: 'rgba(181, 94, 43, 0.75)',
      shadow: 'rgba(255, 122, 26, 0.3)',
      damageFlash: 'rgba(145, 30, 14, 0.62)',
      crosshair: '#ffb26b',
      notification: '#ffd7ac',
      atmosphere: 'radial-gradient(circle at 16% 84%, rgba(130, 38, 9, 0.25) 0%, rgba(130, 38, 9, 0) 38%), linear-gradient(180deg, rgba(43, 17, 10, 0.08) 0%, rgba(0, 0, 0, 0) 32%)',
    },
    damageTheme: {
      fill: '#ff8a3d',
      stroke: '#31110a',
      shadow: 'rgba(255, 103, 31, 0.45)',
      fontFamily: 'Georgia, serif',
      fontSize: 26,
    },
  },
  'tattered-shaman': {
    id: 'tattered-shaman',
    displayName: 'Tattered Shaman',
    title: 'The Bone Choir',
    subtitle: 'A hex-bearer draped in reeds and ash',
    description: 'A spectral channeler whose staff wakes swarms of spiteful spirits from the canopy.',
    stats: {
      maxHealth: 96,
      maxMana: 150,
      maxShield: 30,
      armor: 0.08,
      moveSpeed: 6.1,
      damageMultiplier: 1.14,
      attackSpeed: 0.92,
      classLabel: 'Shaman',
    },
    spawn: {
      weapons: ['spiritSwarmStaff'],
      conditionTags: ['archetype_shaman', 'spirit_attunement', 'ritual_ward'],
    },
    appearance: {
      modelVariant: 'operator',
      textureStyle: 'checker',
      bodyColor: 0x36452c,
      accentColor: 0xd6b96b,
      skinColor: 0xa37c58,
      legColor: 0x182018,
      scaleX: 0.94,
      scaleY: 1.12,
      scaleZ: 0.94,
    },
    hudTheme: {
      healthFull: '#8dc480',
      healthMid: '#c0a95e',
      healthLow: '#7d4330',
      text: '#e8e3cd',
      background: 'rgba(11, 16, 11, 0.84)',
      accent: '#d6b96b',
      panel: 'rgba(16, 22, 15, 0.82)',
      border: 'rgba(131, 146, 91, 0.72)',
      shadow: 'rgba(166, 186, 106, 0.26)',
      damageFlash: 'rgba(65, 88, 47, 0.52)',
      crosshair: '#d6d39c',
      notification: '#f0e5bd',
      atmosphere: 'radial-gradient(circle at 82% 18%, rgba(112, 130, 68, 0.2) 0%, rgba(112, 130, 68, 0) 34%), linear-gradient(180deg, rgba(40, 52, 33, 0.14) 0%, rgba(0, 0, 0, 0) 42%)',
    },
    damageTheme: {
      fill: '#dccc7b',
      stroke: '#23311d',
      shadow: 'rgba(138, 159, 90, 0.42)',
      fontFamily: 'Georgia, serif',
      fontSize: 25,
    },
  },
  'jungle-stalker': {
    id: 'jungle-stalker',
    displayName: 'Jungle Stalker',
    title: 'The Venom Reed',
    subtitle: 'A hunter moving between roots and rot',
    description: 'A fast poison skirmisher that turns the canopy into a blind of needles and whispers.',
    stats: {
      maxHealth: 112,
      maxMana: 72,
      maxShield: 10,
      armor: 0.12,
      moveSpeed: 7.35,
      damageMultiplier: 0.98,
      attackSpeed: 1.24,
      classLabel: 'Stalker',
    },
    spawn: {
      weapons: ['poisonBlowgun', 'macuahuitl'],
      startAmmo: {
        poisonBlowgun: { current: 6, reserve: 42 },
      },
      conditionTags: ['archetype_stalker', 'venom_drawn', 'canopy_step'],
    },
    appearance: {
      modelVariant: 'scout',
      textureStyle: 'stripes',
      bodyColor: 0x2c5b37,
      accentColor: 0x77d69c,
      skinColor: 0x8e6c48,
      legColor: 0x162d1d,
      scaleX: 0.96,
      scaleY: 1.04,
      scaleZ: 0.96,
    },
    hudTheme: {
      healthFull: '#7ecb7f',
      healthMid: '#5fa56d',
      healthLow: '#4b3f28',
      text: '#d7f2d9',
      background: 'rgba(8, 18, 11, 0.84)',
      accent: '#77d69c',
      panel: 'rgba(13, 26, 16, 0.8)',
      border: 'rgba(69, 141, 94, 0.72)',
      shadow: 'rgba(95, 187, 123, 0.26)',
      damageFlash: 'rgba(26, 103, 53, 0.46)',
      crosshair: '#9be7ba',
      notification: '#d7f2d9',
      atmosphere: 'radial-gradient(circle at 72% 78%, rgba(39, 99, 58, 0.2) 0%, rgba(39, 99, 58, 0) 36%), linear-gradient(180deg, rgba(13, 42, 20, 0.14) 0%, rgba(0, 0, 0, 0) 44%)',
    },
    damageTheme: {
      fill: '#8ce38d',
      stroke: '#0f2215',
      shadow: 'rgba(72, 171, 97, 0.42)',
      fontFamily: 'Georgia, serif',
      fontSize: 24,
    },
  },
};

export function cloneTropicalHorrorArchetypeAppearance(archetypeId: TropicalHorrorArchetypeId): TropicalHorrorAvatarAppearance {
  return { ...getTropicalHorrorArchetype(archetypeId).appearance };
}

export function listTropicalHorrorArchetypes(): TropicalHorrorArchetypeDefinition[] {
  return TROPICAL_HORROR_ARCHETYPE_IDS.map((id) => getTropicalHorrorArchetype(id));
}

export function resolveTropicalHorrorArchetypeId(raw: unknown): TropicalHorrorArchetypeId | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case 'obsidian-ravager':
    case 'obsidian_ravager':
    case 'obsidianravager':
    case 'ravager':
      return 'obsidian-ravager';
    case 'tattered-shaman':
    case 'tattered_shaman':
    case 'tatteredshaman':
    case 'shaman':
      return 'tattered-shaman';
    case 'jungle-stalker':
    case 'jungle_stalker':
    case 'junglestalker':
    case 'stalker':
      return 'jungle-stalker';
    default:
      return null;
  }
}

export function getTropicalHorrorArchetype(archetypeId?: TropicalHorrorArchetypeId | null): TropicalHorrorArchetypeDefinition {
  const resolvedId = archetypeId ?? DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID;
  return TROPICAL_HORROR_ARCHETYPES[resolvedId] ?? TROPICAL_HORROR_ARCHETYPES[DEFAULT_TROPICAL_HORROR_ARCHETYPE_ID];
}
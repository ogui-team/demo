/**
 * DataRegistry.ts
 *
 * The single read-only registry of all item templates, ability templates,
 * and effect templates.  This is the "data layer" — no runtime state lives
 * here.  In production, each sub-registry can be loaded from a JSON file
 * fetched over HTTP so a GUI editor can write it without touching source code.
 *
 * Structure:
 *   DATA_REGISTRY.abilities   — AbilityTemplate[]
 *   DATA_REGISTRY.effects     — EffectTemplate[]
 *   DATA_REGISTRY.items       — ItemTemplate[]
 *
 * A companion `DataRegistry` class wraps the arrays in O(1) lookup maps and
 * supports hot-patching individual entries (useful for mod support / the GUI).
 */

import type {
  AbilityTemplate,
  EffectTemplate,
  ItemTemplate,
  ItemInstance,
  ItemAffix,
  AffixTier,
  Rarity,
} from './CombatTypes';

// ─────────────────────────────────────────────────────────────────────────────
// 1.  EFFECT TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

const EFFECTS: EffectTemplate[] = [

  // ── Base passive stats (equipped-item bonuses) ────────────────────────────

  {
    id:          'stat_base_health',
    label:       'Base Vitality',
    kind:        'Passive',
    modifiers:   [{ attribute: 'MaxHealth', op: 'Add', value: 50 }],
    description: '+50 Max Health',
    iconKey:     'icon_heart',
  },
  {
    id:          'stat_pistol_accuracy',
    label:       'Pistol Training',
    kind:        'Passive',
    modifiers:   [{ attribute: 'DamageMultiplier', op: 'MultiplyBase', value: 1.05 }],
    description: '+5% Damage',
    iconKey:     'icon_pistol',
  },
  {
    id:          'stat_tome_mana_bonus',
    label:       'Tome Resonance',
    kind:        'Passive',
    modifiers:   [{ attribute: 'MaxMana', op: 'Add', value: 30 }],
    description: '+30 Max Mana',
    iconKey:     'icon_mana',
  },

  // ── Affix effects — Savage (+15 % Damage) ─────────────────────────────────
  {
    id:          'affix_savage',
    label:       'Savage',
    kind:        'Passive',
    modifiers:   [{ attribute: 'DamageMultiplier', op: 'MultiplyBase', value: 1.15 }],
    tags:        ['Damage'],
    description: '+15% Damage',
    iconKey:     'icon_savage',
  },

  // ── Affix effects — Swift (+20 % AttackSpeed / CooldownReduction) ─────────
  {
    id:          'affix_swift',
    label:       'Swift',
    kind:        'Passive',
    modifiers:   [
      { attribute: 'AttackSpeed',      op: 'MultiplyBase', value: 1.20 },
      { attribute: 'CooldownReduction', op: 'Add',          value: 0.20 },
    ],
    tags:        ['Speed'],
    description: '+20% Attack Speed, +20% Cooldown Reduction',
    iconKey:     'icon_swift',
  },

  // ── Affix effects — Reinforced (+20 Armor) ────────────────────────────────
  {
    id:          'affix_reinforced',
    label:       'Reinforced',
    kind:        'Passive',
    modifiers:   [{ attribute: 'Armor', op: 'Add', value: 20 }],
    tags:        ['Defense'],
    description: '+20 Armor',
    iconKey:     'icon_shield',
  },

  // ── Affix effects — Vampiric (heals on hit; Instant applied to caster) ────
  {
    id:          'affix_vampiric',
    label:       'Vampiric',
    kind:        'Instant',   // delivered as onHitEffect to the caster
    modifiers:   [{ attribute: 'Health', op: 'Add', value: 5 }],
    tags:        ['Lifesteal'],
    description: 'Restore 5 Health on hit',
    iconKey:     'icon_vampire',
  },

  // ── Status effects — Burning (DoT) ────────────────────────────────────────
  {
    id:           'status_burning',
    label:        'Burning',
    kind:         'Duration',
    duration:     4,
    tickInterval: 0.5,
    modifiers:    [{ attribute: 'Health', op: 'Add', value: -5 }],   // -5 hp per tick
    tags:         ['OnFire'],
    description:  '−5 Health every 0.5 s for 4 s',
    iconKey:      'icon_fire',
  },

  // ── Status effects — Rooted ────────────────────────────────────────────────
  {
    id:        'status_rooted',
    label:     'Rooted',
    kind:      'Duration',
    duration:  2,
    modifiers: [{ attribute: 'MoveSpeed', op: 'MultiplyTotal', value: 0 }],
    tags:      ['Rooted', 'Crowd Control'],
    description: 'Cannot move for 2 s',
    iconKey:   'icon_root',
  },

  // ── Status effects — Poisoned (DoT) ───────────────────────────────────────
  {
    id:           'status_poisoned',
    label:        'Poisoned',
    kind:         'Duration',
    duration:     6,
    tickInterval: 0.75,
    modifiers:    [{ attribute: 'Health', op: 'Add', value: -4 }],
    tags:         ['Poisoned', 'DoT'],
    description:  '−4 Health every 0.75 s for 6 s',
    iconKey:      'icon_poison',
  },

  // ── Status effects — Chilled (slow) ──────────────────────────────────────
  {
    id:        'status_chilled',
    label:     'Chilled',
    kind:      'Duration',
    duration:  3,
    modifiers: [{ attribute: 'MoveSpeed', op: 'MultiplyTotal', value: 0.5 }],
    tags:      ['Chilled', 'Crowd Control'],
    description: 'Movement speed halved for 3 s',
    iconKey:   'icon_ice',
  },

  // ── Status effects — Electrocuted (brief stun) ────────────────────────────
  {
    id:        'status_electrocuted',
    label:     'Electrocuted',
    kind:      'Duration',
    duration:  0.8,
    modifiers: [
      { attribute: 'MoveSpeed',    op: 'MultiplyTotal', value: 0 },
      { attribute: 'AttackSpeed',  op: 'MultiplyTotal', value: 0 },
    ],
    tags:      ['Stunned', 'Electrocuted', 'Crowd Control'],
    description: 'Stunned for 0.8 s',
    iconKey:   'icon_lightning',
  },

  // ── Status effects — Exhausted (attack speed reduced) ─────────────────────
  {
    id:        'status_exhausted',
    label:     'Exhausted',
    kind:      'Duration',
    duration:  2,
    modifiers: [{ attribute: 'AttackSpeed', op: 'MultiplyTotal', value: 0.4 }],
    tags:      ['Exhausted', 'Debuff'],
    description: '−60% Attack Speed for 2 s',
    iconKey:   'icon_tired',
  },

  // ── Buffs — Regenerating ─────────────────────────────────────────────────
  {
    id:           'buff_regen',
    label:        'Regenerating',
    kind:         'Duration',
    duration:     5,
    tickInterval: 0.5,
    modifiers:    [{ attribute: 'Health', op: 'Add', value: 8 }],
    tags:         ['Healing', 'Buff'],
    description:  '+8 Health every 0.5 s for 5 s',
    iconKey:      'icon_heart_up',
  },

  // ── Buffs — Empowered (+30% damage for 8 s) ──────────────────────────────
  {
    id:        'buff_empowered',
    label:     'Empowered',
    kind:      'Duration',
    duration:  8,
    modifiers: [{ attribute: 'DamageMultiplier', op: 'MultiplyBase', value: 1.30 }],
    tags:      ['Empowered', 'Buff'],
    description: '+30% Damage for 8 s',
    iconKey:   'icon_power',
  },

  // ── Buffs — Shielded (absorb layer) ──────────────────────────────────────
  {
    id:        'buff_shielded',
    label:     'Shielded',
    kind:      'Duration',
    duration:  10,
    modifiers: [{ attribute: 'Shield', op: 'Add', value: 80 }],
    tags:      ['Shield', 'Buff'],
    description: '+80 Shield for 10 s',
    iconKey:   'icon_shield_up',
  },

  // ── Affix effects — Piercing (−20 Armor to target) ────────────────────────
  {
    id:        'affix_piercing',
    label:     'Piercing',
    kind:      'Duration',
    duration:  4,
    modifiers: [{ attribute: 'Armor', op: 'Add', value: -20 }],
    tags:      ['ArmorBreak', 'Debuff'],
    description: '−20 Armor for 4 s (applied to target on hit)',
    iconKey:   'icon_pierce',
  },

  // ── Affix effects — Chilling (apply Chill on hit) ─────────────────────────
  // Proxy affix: the actual slow is delivered via status_chilled. This affix
  // just gives the item the tag; AbilitySystem reads onHitEffectIds.
  {
    id:        'affix_chilling',
    label:     'Chilling',
    kind:      'Passive',
    modifiers: [{ attribute: 'CritChance', op: 'Add', value: 0.04 }],
    tags:      ['Chill'],
    description: 'Hits apply Chill; +4% Crit Chance',
    iconKey:   'icon_ice',
  },

  // ── Affix effects — Fortified (+40 Max Shield) ────────────────────────────
  {
    id:        'affix_fortified',
    label:     'Fortified',
    kind:      'Passive',
    modifiers: [{ attribute: 'MaxShield', op: 'Add', value: 40 }],
    tags:      ['Defense', 'Shield'],
    description: '+40 Max Shield',
    iconKey:   'icon_fortify',
  },

  // ── Affix effects — Staggering (apply Exhaustion on hit) ─────────────────
  {
    id:        'affix_staggering',
    label:     'Staggering',
    kind:      'Passive',
    modifiers: [{ attribute: 'Armor', op: 'Add', value: 5 }],
    tags:      ['Stagger'],
    description: 'Hits apply Exhaustion; +5 Armor',
    iconKey:   'icon_stagger',
  },

  // ── Affix effects — Volatile (+10% Fire Damage, AoE on kill) ─────────────
  {
    id:        'affix_volatile',
    label:     'Volatile',
    kind:      'Passive',
    modifiers: [{ attribute: 'DamageMultiplier', op: 'MultiplyBase', value: 1.10 }],
    tags:      ['Explosion', 'OnKill'],
    description: '+10% Damage; enemies explode on kill',
    iconKey:   'icon_volatile',
  },

  // ── Affix effects — Lifesurge (+6% Lifesteal) ────────────────────────────
  {
    id:        'affix_lifesurge',
    label:     'Lifesurge',
    kind:      'Passive',
    modifiers: [{ attribute: 'LifeSteal', op: 'Add', value: 0.06 }],
    tags:      ['Lifesteal'],
    description: '+6% Lifesteal',
    iconKey:   'icon_vampire',
  },

  // ── Affix effects — Corrupted (Shadow damage bonus, −10 Armor penalty) ────
  {
    id:        'affix_corrupted',
    label:     'Corrupted',
    kind:      'Passive',
    modifiers: [
      { attribute: 'DamageMultiplier', op: 'MultiplyBase', value: 1.20 },
      { attribute: 'Armor',            op: 'Add',          value: -10 },
    ],
    tags:      ['Shadow', 'Corrupted'],
    description: '+20% Damage, −10 Armor',
    iconKey:   'icon_corrupt',
  },

  // ── Affix effects — Overclocked (burst windows + conditional cooldowns) ─
  {
    id:        'affix_overclocked',
    label:     'Overclocked',
    kind:      'Passive',
    modifiers: [
      { attribute: 'AttackSpeed',       op: 'MultiplyBase', value: 1.12 },
      { attribute: 'CooldownReduction', op: 'Add',          value: 0.08 },
    ],
    tags:      ['Overclocked', 'Speed'],
    description: '+12% Attack Speed, +8% Cooldown Reduction',
    iconKey:   'icon_lightning',
  },

  // ── Affix effects — Bastion (shield channel support) ────────────────────
  {
    id:        'affix_bastion',
    label:     'Bastion',
    kind:      'Passive',
    modifiers: [
      { attribute: 'MaxShield', op: 'Add', value: 65 },
      { attribute: 'Armor',     op: 'Add', value: 10 },
    ],
    tags:      ['Defense', 'Shield', 'Bastion'],
    description: '+65 Max Shield, +10 Armor',
    iconKey:   'icon_shield',
  },

  // ── Status effects — Marked (amplifies incoming damage) ─────────────────
  {
    id:        'status_marked',
    label:     'Marked',
    kind:      'Duration',
    duration:  5,
    modifiers: [
      { attribute: 'Armor', op: 'Add', value: -15 },
    ],
    tags:      ['Marked', 'Debuff'],
    description: 'Marked target suffers reduced armor for 5 s',
    iconKey:   'icon_target',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2.  ABILITY TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

const ABILITIES: AbilityTemplate[] = [

  // ── Shoot Pistol ──────────────────────────────────────────────────────────
  {
    id:         'ability_shoot_pistol',
    label:      'Shoot Pistol',
    delivery:   'Hitscan',
    damage:     50,
    damageType: 'Physical',
    cost:       1,
    costType:   'Ammo',
    cooldown:   0.4,
    hitscan: { range: 90, spread: 0.01, pellets: 1 },
    animClip:    'pistol_fire',
    iconKey:     'icon_pistol',
    description: 'A quick accurate shot.',
  },

  // ── Shoot Shotgun ─────────────────────────────────────────────────────────
  {
    id:         'ability_shoot_shotgun',
    label:      'Shoot Shotgun',
    delivery:   'Hitscan',
    damage:     14,
    damageType: 'Physical',
    cost:       1,
    costType:   'Ammo',
    cooldown:   1.05,
    hitscan: { range: 34, spread: 0.09, pellets: 8 },
    animClip:    'shotgun_fire',
    iconKey:     'icon_shotgun',
    description: '8 pellets in a wide cone.',
  },

  // ── Launch Grenade ────────────────────────────────────────────────────────
  {
    id:         'ability_launch_grenade',
    label:      'Launch Grenade',
    delivery:   'Projectile',
    damage:     85,
    damageType: 'Explosion',
    cost:       1,
    costType:   'Ammo',
    cooldown:   1.33,
    projectile: {
      speed:        18,
      lifetime:     3.5,
      radius:       0.18,
      splashRadius: 4.5,
      splashDamage: 85,
      gravityScale: 0.55,
      assetKey:     'model_barrel_rust',
    },
    animClip:    'grenade_fire',
    onHitEffectIds: ['status_burning'],
    iconKey:     'icon_grenade',
    description: 'Arcing explosive with fire DoT on blast.',
  },

  // ── Flare Shot ────────────────────────────────────────────────────────────
  {
    id:         'ability_flare_shot',
    label:      'Flare Shot',
    delivery:   'Projectile',
    damage:     40,
    damageType: 'Fire',
    cost:       1,
    costType:   'Ammo',
    cooldown:   1.0,
    projectile: {
      speed:       22,
      lifetime:    2.6,
      radius:      0.12,
      gravityScale:0.1,
      assetKey:    'model_hanging_light',
    },
    onHitEffectIds: ['status_burning'],
    animClip:    'flare_fire',
    iconKey:     'icon_flare',
    description: 'Sets targets on fire.',
  },

  // ── Arcane Burst (AoE) ────────────────────────────────────────────────────
  {
    id:         'ability_arcane_burst',
    label:      'Arcane Burst',
    delivery:   'AoE',
    damage:     60,
    damageType: 'Arcane',
    cost:       35,
    costType:   'Mana',
    cooldown:   5,
    aoe: { radius: 6, duration: 0, falloff: 'linear' },
    onHitEffectIds: ['status_rooted'],
    animClip:   'tome_cast',
    iconKey:    'icon_arcane',
    description: 'Instant arcane explosion that roots all nearby enemies.',
  },

  // ── Summon Skeleton ───────────────────────────────────────────────────────
  {
    id:         'ability_summon_skeleton',
    label:      'Summon Skeleton',
    delivery:   'Summon',
    damage:     0,
    damageType: 'Physical',
    cost:       40,
    costType:   'Mana',
    cooldown:   8,
    summon: {
      assetKey:     'model_skeleton',
      maxCount:     3,
      lifetime:     60,
      maxHealth:    80,
      damagePerHit: 12,
      attackRange:  2,
      moveSpeed:    3.5,
    },
    animClip:    'tome_summon',
    iconKey:     'icon_skull',
    description: 'Raises an undead skeleton warrior (max 3 active).',
  },

  // ── Assault Rifle (fast hitscan) ──────────────────────────────────────────
  {
    id:         'ability_assault_rifle',
    label:      'Assault Rifle',
    delivery:   'Hitscan',
    damage:     18,
    damageType: 'Physical',
    cost:       1,
    costType:   'Ammo',
    cooldown:   0.12,
    hitscan: { range: 70, spread: 0.03, pellets: 1 },
    animClip:    'rifle_fire',
    iconKey:     'icon_rifle',
    description: 'High-rate automatic fire.',
  },

  // ── Sniper Shot (high-damage, slow, long-range) ───────────────────────────
  {
    id:         'ability_sniper_shot',
    label:      'Sniper Shot',
    delivery:   'Hitscan',
    damage:     140,
    damageType: 'Physical',
    cost:       1,
    costType:   'Ammo',
    cooldown:   2.5,
    hitscan: { range: 300, spread: 0.002, pellets: 1 },
    onHitEffectIds: ['status_exhausted'],
    animClip:    'sniper_fire',
    iconKey:     'icon_sniper',
    description: 'Precision shot that exhausts the target.',
  },

  // ── Lightning Chain (hitscan arc, bounces 3 targets) ─────────────────────
  {
    id:         'ability_lightning_chain',
    label:      'Lightning Chain',
    delivery:   'Hitscan',
    damage:     45,
    damageType: 'Lightning',
    cost:       30,
    costType:   'Mana',
    cooldown:   3.5,
    hitscan: { range: 18, spread: 0, pellets: 1 },
    onHitEffectIds: ['status_electrocuted'],
    animClip:   'tome_cast',
    iconKey:    'icon_lightning',
    description: 'Arc of lightning that stuns on impact.',
  },

  // ── Poison Nova (AoE Poison cloud) ───────────────────────────────────────
  {
    id:         'ability_poison_nova',
    label:      'Poison Nova',
    delivery:   'AoE',
    damage:     25,
    damageType: 'Poison',
    cost:       25,
    costType:   'Mana',
    cooldown:   7,
    aoe: { radius: 7, duration: 4, tickInterval: 1, falloff: 'none' },
    onHitEffectIds: ['status_poisoned'],
    animClip:   'tome_cast',
    iconKey:    'icon_poison',
    description: 'Persistent poison cloud that applies Poisoned on each tick.',
  },

  // ── Ice Lance (projectile, applies Chill) ─────────────────────────────────
  {
    id:         'ability_ice_lance',
    label:      'Ice Lance',
    delivery:   'Projectile',
    damage:     55,
    damageType: 'Ice',
    cost:       20,
    costType:   'Mana',
    cooldown:   2.2,
    projectile: { speed: 28, lifetime: 2.0, radius: 0.15, gravityScale: 0 },
    onHitEffectIds: ['status_chilled'],
    animClip:   'tome_cast',
    iconKey:    'icon_ice',
    description: 'Fast ice projectile that chills the target.',
  },

  // ── Shield Dash (instant self-buff, no damage) ────────────────────────────
  {
    id:         'ability_shield_dash',
    label:      'Shield Dash',
    delivery:   'AoE',
    damage:     0,
    damageType: 'Physical',
    cost:       20,
    costType:   'Mana',
    cooldown:   6,
    aoe: { radius: 0, duration: 0, falloff: 'none' },
    onCastEffectIds: ['buff_empowered', 'buff_shielded'],
    animClip:   'dash',
    iconKey:    'icon_dash',
    description: 'Surge forward — grants Empowered and a Shield for 8/10 s.',
  },

  // ── Holy Smite (AoE burst, heals allies) ─────────────────────────────────
  {
    id:         'ability_holy_smite',
    label:      'Holy Smite',
    delivery:   'AoE',
    damage:     40,
    damageType: 'Holy',
    cost:       40,
    costType:   'Mana',
    cooldown:   6,
    aoe: { radius: 5, duration: 0, falloff: 'linear' },
    onCastEffectIds: ['buff_regen'],
    animClip:   'tome_cast',
    iconKey:    'icon_holy',
    description: 'Holy burst. Hurts enemies, grants Regen to caster.',
  },

  // ── Summon Fire Imp ───────────────────────────────────────────────────────
  {
    id:         'ability_summon_fire_imp',
    label:      'Summon Fire Imp',
    delivery:   'Summon',
    damage:     0,
    damageType: 'Fire',
    cost:       35,
    costType:   'Mana',
    cooldown:   12,
    summon: {
      assetKey:     'model_fire_imp',
      maxCount:     2,
      lifetime:     45,
      maxHealth:    50,
      damagePerHit: 18,
      attackRange:  2.5,
      moveSpeed:    5,
      spawnEffectIds: ['status_burning'],
    },
    animClip:    'tome_summon',
    iconKey:     'icon_fire',
    description: 'Summons a fire imp (max 2). Its attacks apply Burning.',
  },

  // ── Summon Ice Golem ─────────────────────────────────────────────────────
  {
    id:         'ability_summon_ice_golem',
    label:      'Summon Ice Golem',
    delivery:   'Summon',
    damage:     0,
    damageType: 'Ice',
    cost:       60,
    costType:   'Mana',
    cooldown:   20,
    summon: {
      assetKey:     'model_ice_golem',
      maxCount:     1,
      lifetime:     90,
      maxHealth:    220,
      damagePerHit: 25,
      attackRange:  2,
      moveSpeed:    2.5,
    },
    animClip:    'tome_summon',
    iconKey:     'icon_ice',
    description: 'Slow but tanky ice golem (max 1). High HP, applies Chill.',
  },

  // ── Summon Shadow Wraith ──────────────────────────────────────────────────
  {
    id:         'ability_summon_shadow_wraith',
    label:      'Summon Shadow Wraith',
    delivery:   'Summon',
    damage:     0,
    damageType: 'Shadow',
    cost:       55,
    costType:   'Mana',
    cooldown:   18,
    summon: {
      assetKey:     'model_shadow_wraith',
      maxCount:     1,
      lifetime:     60,
      maxHealth:    90,
      damagePerHit: 30,
      attackRange:  3,
      moveSpeed:    6.5,
    },
    animClip:    'tome_summon',
    iconKey:     'icon_shadow',
    description: 'Fast shadow wraith (max 1). High single-target damage.',
  },

  // ── Incineration Cone (directional AoE) ─────────────────────────────────
  {
    id:         'ability_incineration_cone',
    label:      'Incineration Cone',
    delivery:   'AoE',
    damage:     48,
    damageType: 'Fire',
    cost:       22,
    costType:   'Mana',
    cooldown:   4.2,
    cooldownGroup: 'elemental_burst',
    cooldownTagMultipliers: {
      Overclocked: 0.85,
      Exhausted:   1.2,
    },
    aoe: {
      shape: 'cone',
      radius: 0,
      range: 10,
      angleDeg: 68,
      duration: 0,
      falloff: 'linear',
    },
    onHitEffectIds: ['status_burning'],
    animClip:   'tome_cast',
    iconKey:    'icon_fire',
    description: 'Directional cone that burns targets in front of the caster.',
  },

  // ── Fireball (debug GAS ability) ────────────────────────────────────────
  {
    id:         'ability_fireball',
    label:      'Fireball',
    delivery:   'Projectile',
    damage:     56,
    damageType: 'Fire',
    cost:       0,
    costType:   'Mana',
    cooldown:   0.9,
    requiredTags: ['HasFireball'],
    projectile: {
      speed:        40,
      lifetime:     2.5,
      radius:       0.18,
      gravityScale: 0,
      splashRadius: 2.2,
      splashDamage: 56,
    },
    animClip:    'tome_cast',
    iconKey:     'icon_fire',
    description: 'Launches a fireball that explodes on impact, scorching nearby enemies.',
  },

  // ── Arc Ring Burst (ring AoE) ───────────────────────────────────────────
  {
    id:         'ability_arc_ring',
    label:      'Arc Ring',
    delivery:   'AoE',
    damage:     52,
    damageType: 'Lightning',
    cost:       26,
    costType:   'Mana',
    cooldown:   5.4,
    cooldownGroup: 'elemental_burst',
    linkedCooldownGroups: ['defensive_cast'],
    aoe: {
      shape: 'ring',
      radius: 9,
      innerRadius: 3,
      duration: 0,
      falloff: 'none',
    },
    onHitEffectIds: ['status_electrocuted', 'status_marked'],
    animClip:   'tome_cast',
    iconKey:    'icon_lightning',
    description: 'Lightning ring that skips close targets and strikes the outer arc.',
  },

  // ── Summon Guardian Drone (pet context) ──────────────────────────────────
  {
    id:         'ability_summon_guardian_drone',
    label:      'Summon Guardian Drone',
    delivery:   'Summon',
    damage:     0,
    damageType: 'Arcane',
    cost:       38,
    costType:   'Mana',
    cooldown:   14,
    cooldownGroup: 'defensive_cast',
    summon: {
      assetKey:     'model_hanging_light',
      spawnContext: 'pet',
      maxCount:     2,
      lifetime:     55,
      maxHealth:    105,
      damagePerHit: 16,
      attackRange:  8,
      moveSpeed:    4.2,
      spawnEffectIds: ['buff_shielded'],
    },
    animClip:    'tome_summon',
    iconKey:     'icon_arcane',
    description: 'Summons arcane drones that protect and harass targets.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3.  ITEM TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS: ItemTemplate[] = [

  // ── Base Pistol ───────────────────────────────────────────────────────────
  {
    id:               'base_pistol',
    label:            'Pistol',
    category:         'Weapon',
    equipSlot:        'Primary',
    activeAbilityId:  'ability_shoot_pistol',
    passiveEffectIds: ['stat_pistol_accuracy'],
    affixPool:        ['affix_savage', 'affix_swift', 'affix_vampiric'],
    magazineSize:     12,
    reserveAmmoCap:   96,
    reloadTime:       1.2,
    dropWeight:       10,
    minLevel:         1,
    iconKey:          'icon_pistol',
    meshKey:          'model_pistol',
    description:      'A reliable sidearm.',
  },

  // ── Base Shotgun ──────────────────────────────────────────────────────────
  {
    id:               'base_shotgun',
    label:            'Shotgun',
    category:         'Weapon',
    equipSlot:        'Primary',
    activeAbilityId:  'ability_shoot_shotgun',
    passiveEffectIds: [],
    affixPool:        ['affix_savage', 'affix_swift', 'affix_reinforced'],
    magazineSize:     6,
    reserveAmmoCap:   36,
    reloadTime:       2.35,
    dropWeight:       7,
    minLevel:         3,
    iconKey:          'icon_shotgun',
    meshKey:          'model_shotgun',
    description:      'Devastating at close range.',
  },

  // ── Base Grenade Launcher ─────────────────────────────────────────────────
  {
    id:               'base_grenade_launcher',
    label:            'Grenade Launcher',
    category:         'Weapon',
    equipSlot:        'Primary',
    activeAbilityId:  'ability_launch_grenade',
    passiveEffectIds: [],
    affixPool:        ['affix_savage', 'affix_reinforced'],
    magazineSize:     4,
    reserveAmmoCap:   24,
    reloadTime:       2.8,
    dropWeight:       3,
    minLevel:         8,
    iconKey:          'icon_grenade_launcher',
    meshKey:          'model_grenade_launcher',
    description:      'Bounces explosive projectiles.',
  },

  // ── Base Flare Gun ───────────────────────────────────────────────────────
  {
    id:               'base_flare_gun',
    label:            'Flare Gun',
    category:         'Weapon',
    equipSlot:        'Secondary',
    activeAbilityId:  'ability_flare_shot',
    passiveEffectIds: [],
    affixPool:        ['affix_swift', 'affix_vampiric'],
    magazineSize:     8,
    reserveAmmoCap:   32,
    reloadTime:       1.6,
    dropWeight:       3,
    minLevel:         4,
    iconKey:          'icon_flare',
    meshKey:          'model_pistol',
    description:      'Fires incendiary flares that ignite targets.',
  },

  // ── Base Necromancy Tome ──────────────────────────────────────────────────
  {
    id:               'base_necromancy_tome',
    label:            'Necromancy Tome',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_summon_skeleton',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_swift', 'affix_savage'],
    dropWeight:       4,
    minLevel:         5,
    iconKey:          'icon_skull',
    meshKey:          'model_tome_dark',
    description:      'Binds the restless dead to your will.',
  },

  // ── Base Arcane Offhand ───────────────────────────────────────────────────
  {
    id:               'base_arcane_offhand',
    label:            'Arcane Focus',
    category:         'Offhand',
    equipSlot:        'Secondary',
    activeAbilityId:  'ability_arcane_burst',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_swift', 'affix_reinforced'],
    dropWeight:       4,
    minLevel:         6,
    iconKey:          'icon_arcane',
    meshKey:          'model_arcane_orb',
    description:      'Channels raw arcane energy into an explosive burst.',
  },

  // ── Ice Lance Tome ───────────────────────────────────────────────────────
  {
    id:               'tome_ice_lance',
    label:            'Tome of Ice',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_ice_lance',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_fortified', 'affix_chilling'],
    dropWeight:       3,
    minLevel:         7,
    iconKey:          'icon_ice',
    meshKey:          'model_tome_dark',
    description:      'Launches a chilling ice lance that freezes foes.',
  },

  // ── Summon Fire Imp Tome ─────────────────────────────────────────────────
  {
    id:               'tome_fire_imp',
    label:            'Infernal Grimoire',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_summon_fire_imp',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_overclocked', 'affix_vampiric'],
    dropWeight:       2,
    minLevel:         9,
    iconKey:          'icon_fire',
    meshKey:          'model_tome_dark',
    description:      'Summons fire imps to scorch your enemies.',
  },

  // ── Summon Ice Golem Tome ───────────────────────────────────────────────
  {
    id:               'tome_ice_golem',
    label:            'Frostbound Grimoire',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_summon_ice_golem',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_fortified', 'affix_chilling'],
    dropWeight:       2,
    minLevel:         11,
    iconKey:          'icon_ice',
    meshKey:          'model_tome_dark',
    description:      'Summons a powerful ice golem to fight for you.',
  },

  // ── Fireball Tome (GAS pickup template) ───────────────────────────────────
  {
    id:               'debug_fireball',
    label:            'Fireball Tome',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_fireball',
    passiveEffectIds: [],
    affixPool:        [],
    dropWeight:       1,
    minLevel:         0,
    iconKey:          'icon_fire',
    meshKey:          'model_tome_dark',
    description:      'Spellbook granting the Fireball ability.',
  },

  // ── Assault Rifle ─────────────────────────────────────────────────────────
  {
    id:               'base_assault_rifle',
    label:            'Assault Rifle',
    category:         'Weapon',
    equipSlot:        'Primary',
    activeAbilityId:  'ability_assault_rifle',
    passiveEffectIds: [],
    affixPool:        ['affix_savage', 'affix_swift', 'affix_vampiric', 'affix_volatile', 'affix_staggering'],
    magazineSize:     30,
    reserveAmmoCap:   150,
    reloadTime:       2.5,
    dropWeight:       6,
    minLevel:         5,
    iconKey:          'icon_rifle',
    meshKey:          'model_assault_rifle',
    description:      'Full-auto rifle with high magazine capacity.',
  },

  // ── Sniper Rifle ──────────────────────────────────────────────────────────
  {
    id:               'base_sniper_rifle',
    label:            'Sniper Rifle',
    category:         'Weapon',
    equipSlot:        'Primary',
    activeAbilityId:  'ability_sniper_shot',
    passiveEffectIds: [],
    affixPool:        ['affix_piercing', 'affix_savage', 'affix_chilling', 'affix_corrupted'],
    magazineSize:     5,
    reserveAmmoCap:   30,
    reloadTime:       3.0,
    dropWeight:       3,
    minLevel:         8,
    iconKey:          'icon_sniper',
    meshKey:          'model_sniper_rifle',
    description:      'High-calibre precision rifle. Exhausts targets on hit.',
  },

  // ── Advanced Arcane Tome (Spellbook) ──────────────────────────────────────
  {
    id:               'tome_arcane_advanced',
    label:            'Grand Arcane Tome',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_lightning_chain',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_swift', 'affix_fortified', 'affix_chilling'],
    dropWeight:       3,
    minLevel:         10,
    iconKey:          'icon_tome',
    meshKey:          'model_arcane_orb',
    description:      'Channels lightning through a chain of enemies.',
  },

  // ── Poison Tome (Spellbook) ───────────────────────────────────────────────
  {
    id:               'tome_poison',
    label:            'Tome of Plagues',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_poison_nova',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_swift', 'affix_staggering', 'affix_vampiric'],
    dropWeight:       3,
    minLevel:         7,
    iconKey:          'icon_poison',
    meshKey:          'model_arcane_orb',
    description:      'Unleashes a persistent toxic cloud.',
  },

  // ── Holy Tome (Spellbook) ─────────────────────────────────────────────────
  {
    id:               'tome_holy',
    label:            'Holy Scripture',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_holy_smite',
    passiveEffectIds: ['stat_base_health', 'stat_tome_mana_bonus'],
    affixPool:        ['affix_reinforced', 'affix_fortified', 'affix_lifesurge'],
    dropWeight:       2,
    minLevel:         12,
    iconKey:          'icon_holy',
    meshKey:          'model_arcane_orb',
    description:      'Holy burst that heals self while damaging enemies.',
  },

  // ── Dash Ring (Accessory) ─────────────────────────────────────────────────
  {
    id:               'accessory_dash_ring',
    label:            'Ring of Momentum',
    category:         'Accessory',
    equipSlot:        'None',
    activeAbilityId:  'ability_shield_dash',
    passiveEffectIds: [],
    affixPool:        ['affix_swift', 'affix_fortified', 'affix_lifesurge'],
    dropWeight:       2,
    minLevel:         5,
    iconKey:          'icon_ring',
    meshKey:          'model_ring',
    description:      'Grants Shield Dash ability. Empowers and shields on use.',
  },

  // ── Summoner Ring (Accessory) ─────────────────────────────────────────────
  {
    id:               'accessory_summoner_ring',
    label:            "Necromancer's Seal",
    category:         'Accessory',
    equipSlot:        'None',
    activeAbilityId:  'ability_summon_shadow_wraith',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_corrupted', 'affix_vampiric', 'affix_staggering'],
    dropWeight:       1,
    minLevel:         15,
    iconKey:          'icon_skull',
    meshKey:          'model_ring',
    description:      "Summons a Shadow Wraith. Channelling dark energy.",
  },

  // ── Incinerator Gauntlet (cone caster weapon) ───────────────────────────
  {
    id:               'weapon_incinerator_gauntlet',
    label:            'Incinerator Gauntlet',
    category:         'Weapon',
    equipSlot:        'Primary',
    activeAbilityId:  'ability_incineration_cone',
    passiveEffectIds: ['affix_overclocked'],
    affixPool:        ['affix_overclocked', 'affix_savage', 'affix_bastion'],
    dropWeight:       2,
    minLevel:         11,
    iconKey:          'icon_fire',
    meshKey:          'model_assault_rifle',
    description:      'Short-range cone caster with high pressure output.',
  },

  // ── Storm Loop Sigil (ring burst focus) ─────────────────────────────────
  {
    id:               'tome_storm_loop',
    label:            'Storm Loop Sigil',
    category:         'Tome',
    equipSlot:        'Spellbook',
    activeAbilityId:  'ability_arc_ring',
    passiveEffectIds: ['stat_tome_mana_bonus'],
    affixPool:        ['affix_overclocked', 'affix_chilling', 'affix_bastion'],
    dropWeight:       2,
    minLevel:         13,
    iconKey:          'icon_lightning',
    meshKey:          'model_tome_dark',
    description:      'Projects an electrified ring at medium range.',
  },

  // ── Guardian Prism (defensive summon accessory) ─────────────────────────
  {
    id:               'accessory_guardian_prism',
    label:            'Guardian Prism',
    category:         'Accessory',
    equipSlot:        'None',
    activeAbilityId:  'ability_summon_guardian_drone',
    passiveEffectIds: ['affix_bastion'],
    affixPool:        ['affix_bastion', 'affix_fortified', 'affix_lifesurge'],
    dropWeight:       1,
    minLevel:         14,
    iconKey:          'icon_shield',
    meshKey:          'model_ring',
    description:      'Summons guardian drones and reinforces your shield channel.',
  },

  // ── Consumables ──────────────────────────────────────────────────────────

  // Health Pack — instant-heal consumable
  {
    id:               'health_small',
    label:            'Health Pack',
    category:         'Consumable',
    equipSlot:        'None',
    activeAbilityId:  null as unknown as string,
    passiveEffectIds: [],
    affixPool:        [],
    dropWeight:       8,
    minLevel:         1,
    iconKey:          'icon_heart',
    description:      'Restores 25 health on use.',
  },

  // Pistol ammo
  {
    id:               'ammo_9mm',
    label:            '9mm Ammo',
    category:         'Consumable',
    equipSlot:        'None',
    activeAbilityId:  null as unknown as string,
    passiveEffectIds: [],
    affixPool:        [],
    dropWeight:       12,
    minLevel:         1,
    iconKey:          'icon_ammo',
    description:      'Standard 9mm pistol ammunition.',
  },

  // Shotgun shells
  {
    id:               'ammo_shells',
    label:            'Shotgun Shells',
    category:         'Consumable',
    equipSlot:        'None',
    activeAbilityId:  null as unknown as string,
    passiveEffectIds: [],
    affixPool:        [],
    dropWeight:       10,
    minLevel:         1,
    iconKey:          'icon_ammo',
    description:      'Standard shotgun shells.',
  },

  // Shotgun shells (legacy alias)
  {
    id:               'shotgun_shells',
    label:            'Shotgun Shells (Pack)',
    category:         'Consumable',
    equipSlot:        'None',
    activeAbilityId:  null as unknown as string,
    passiveEffectIds: [],
    affixPool:        [],
    dropWeight:       8,
    minLevel:         1,
    iconKey:          'icon_ammo',
    description:      'A pack of shotgun shells.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 4.  RAW REGISTRY OBJECT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flat, JSON-serialisable registry.  Can be replaced wholesale by loading a
 * JSON config file from a server / editor tool.
 */
export const DATA_REGISTRY = {
  abilities: ABILITIES as readonly AbilityTemplate[],
  effects:   EFFECTS   as readonly EffectTemplate[],
  items:     ITEMS     as readonly ItemTemplate[],
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// 5.  DataRegistry CLASS  — O(1) lookup  +  hot-patch support
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runtime wrapper around DATA_REGISTRY.
 *
 * Creates O(1) lookup Maps at construction.  Call `patch*()` methods to add
 * or override individual entries at runtime (e.g. from a mod or live editor).
 */
export class DataRegistry {
  private readonly abilities = new Map<string, AbilityTemplate>();
  private readonly effects   = new Map<string, EffectTemplate>();
  private readonly items     = new Map<string, ItemTemplate>();

  constructor(raw = DATA_REGISTRY) {
    for (const a of raw.abilities) this.abilities.set(a.id, a);
    for (const e of raw.effects)   this.effects.set(e.id, e);
    for (const i of raw.items)     this.items.set(i.id, i);
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  getAbility(id: string): AbilityTemplate | undefined {
    return this.abilities.get(id);
  }

  getEffect(id: string): EffectTemplate | undefined {
    return this.effects.get(id);
  }

  getItem(id: string): ItemTemplate | undefined {
    return this.items.get(id);
  }

  listAbilities(): AbilityTemplate[]  { return [...this.abilities.values()]; }
  listEffects():   EffectTemplate[]   { return [...this.effects.values()]; }
  listItems():     ItemTemplate[]     { return [...this.items.values()]; }

  // ── Hot-patching ──────────────────────────────────────────────────────────

  /** Register or override a single ability template at runtime. */
  patchAbility(template: AbilityTemplate): void { this.abilities.set(template.id, template); }
  patchEffect(template: EffectTemplate):   void { this.effects.set(template.id, template); }
  patchItem(template: ItemTemplate):       void { this.items.set(template.id, template); }

  /**
   * Bulk-load all entries from a JSON-compatible plain object.
   * Useful for loading a server-provided data pack.
   */
  loadPack(pack: Partial<typeof DATA_REGISTRY>): void {
    for (const a of pack.abilities ?? []) this.patchAbility(a);
    for (const e of pack.effects   ?? []) this.patchEffect(e);
    for (const i of pack.items     ?? []) this.patchItem(i);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6.  ARCHITECTURE DEMO — "Level 5 Savage Pistol"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * This function is purely documentary: it shows how the systems compose to
 * generate a named item instance and compute its final stats.
 *
 * Call it from the browser console with `import { demonstrateGAS } from '…'`
 * to see the log output.
 */
export function demonstrateGAS(): void {
  const registry = new DataRegistry();

  // ── Step 1: look up the base template ─────────────────────────────────────
  const pistolTemplate = registry.getItem('base_pistol')!;

  // ── Step 2: build the "Savage" affix (rolled at Major tier, 1.0× value) ──
  const savageAffix: ItemAffix = {
    templateId:     'affix_savage',
    tier:           'Major' as AffixTier,
    rollMultiplier: 1.0,   // exact base value of the affix
  };

  // ── Step 3: create the ItemInstance (UUID normally from crypto.randomUUID)─
  const savagePistol: ItemInstance = {
    uuid:         'demo-uuid-savage-pistol-lvl5',
    templateId:   pistolTemplate.id,
    level:        5,
    rarity:       'Magic' as Rarity,
    affixes:      [savageAffix],
    currentAmmo:  pistolTemplate.magazineSize,
    reserveAmmo:  pistolTemplate.reserveAmmoCap,
    lastModified: Engine.time.now(),
  };

  console.groupCollapsed('[GAS Demo] Level 5 Savage Pistol');
  console.log('Instance:', savagePistol);

  // ── Step 4: resolve all passive effects this item contributes ─────────────
  const baseEffects   = pistolTemplate.passiveEffectIds.map((id) => registry.getEffect(id)!);
  const affixEffects  = savagePistol.affixes.map((a) => {
    const tpl = registry.getEffect(a.templateId)!;
    return { affix: a, template: tpl };
  });

  console.log('Base passive effects:', baseEffects.map((e) => e.label));
  console.log('Affix effects:', affixEffects.map(({ template, affix }) =>
    `${template.label} ×${affix.rollMultiplier} [${affix.tier}]`
  ));

  // ── Step 5: calculate the final DamageMultiplier ──────────────────────────
  //   Base value = 1.0
  //   stat_pistol_accuracy  → MultiplyBase ×1.05  → 1.0 × 1.05  = 1.05
  //   affix_savage          → MultiplyBase ×1.15  → 1.05 × 1.15 = 1.2075  (approx)
  let dmgMul = 1.0;
  for (const e of baseEffects) {
    for (const m of e.modifiers) {
      if (m.attribute !== 'DamageMultiplier') continue;
      if (m.op === 'MultiplyBase')  dmgMul *= m.value;
      if (m.op === 'Add')           dmgMul += m.value;
    }
  }
  for (const { template, affix } of affixEffects) {
    for (const m of template.modifiers) {
      if (m.attribute !== 'DamageMultiplier') continue;
      const effectiveValue = m.op === 'Add'
        ? m.value * affix.rollMultiplier
        : m.value;   // multiplicative mods snap to discrete tiers
      if (m.op === 'MultiplyBase')   dmgMul *= effectiveValue;
      if (m.op === 'MultiplyTotal')  dmgMul *= effectiveValue;
      if (m.op === 'Add')            dmgMul += effectiveValue;
    }
  }

  // ── Step 6: resolve the active ability and apply multiplier ───────────────
  const ability    = registry.getAbility(savagePistol.abilityIdOverride ?? pistolTemplate.activeAbilityId)!;
  const finalDmg   = Math.round(ability.damage * dmgMul);

  console.log(`Active ability: ${ability.label} (base ${ability.damage} damage)`);
  console.log(`Final DamageMultiplier: ${dmgMul.toFixed(4)}`);
  console.log(`→ Effective damage per shot: ${finalDmg}`);
  console.groupEnd();
}

/**
 * gas/index.ts — barrel export for the GAS subsystem.
 *
 * Import everything you need from one place:
 *
 *   import {
 *     DataRegistry, DATA_REGISTRY,
 *     AttributeContainer, EntityAttributeStore,
 *     EffectSystem,
 *     ItemInstanceSystem,
 *     AbilitySystem,
 *   } from './engine/systems/gas';
 */

export * from './CombatTypes';
export * from './DataRegistry';
export * from './AttributeContainer';
export * from './EffectSystem';
export * from './ItemInstanceSystem';
export * from './AbilitySystem';
export * from './GASRuntimeMetadata';
export { GASBridge } from './GASBridge';

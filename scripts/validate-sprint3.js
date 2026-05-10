#!/usr/bin/env node

/**
 * Sprint 3 Validation Script
 * Validates that DOD constants and entity type extraction was successful
 */

const path = require('path');
const fs = require('fs');

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  SPRINT 3 VALIDATION: Entity Archetype & DOD Consolidation');
console.log('═══════════════════════════════════════════════════════════════\n');

// Check 1: Verify shared-contracts files exist
console.log('✓ Check 1: Verifying shared-contracts files...');
const constantsFile = path.resolve(__dirname, 'packages/shared-contracts/src/gameplay/constants.ts');
const entityFile = path.resolve(__dirname, 'packages/shared-contracts/src/gameplay/entity.ts');

if (!fs.existsSync(constantsFile)) {
  console.error('  ✗ FAILED: constants.ts not found');
  process.exit(1);
}
if (!fs.existsSync(entityFile)) {
  console.error('  ✗ FAILED: entity.ts not found');
  process.exit(1);
}
console.log('  ✅ Both files exist\n');

// Check 2: Verify exports
console.log('✓ Check 2: Verifying exports in constants.ts...');
const constantsContent = fs.readFileSync(constantsFile, 'utf-8');
const requiredExports = [
  'export const PHYSICS_CONSTANTS',
  'export const SNAPSHOT_ALLOWED_ENTITY_TYPES',
  'export function validatePhysicsConstants'
];
requiredExports.forEach(exp => {
  if (!constantsContent.includes(exp)) {
    console.error(`  ✗ FAILED: Missing export: ${exp}`);
    process.exit(1);
  }
  console.log(`  ✓ Found: ${exp}`);
});
console.log('');

// Check 3: Verify entity.ts exports
console.log('✓ Check 3: Verifying exports in entity.ts...');
const entityContent = fs.readFileSync(entityFile, 'utf-8');
const entityExports = [
  'export interface Vec3',
  'export interface PlayerState',
  'export interface EntityState',
  'export interface PlayerPrefabDefinition',
  'export interface PlayerSpawnResult'
];
entityExports.forEach(exp => {
  if (!entityContent.includes(exp)) {
    console.error(`  ✗ FAILED: Missing export: ${exp}`);
    process.exit(1);
  }
  console.log(`  ✓ Found: ${exp}`);
});
console.log('');

// Check 4: Verify shared-contracts index.ts exports
console.log('✓ Check 4: Verifying index.ts re-exports...');
const indexFile = path.resolve(__dirname, 'packages/shared-contracts/src/gameplay/index.ts');
const indexContent = fs.readFileSync(indexFile, 'utf-8');
if (!indexContent.includes("export * from './constants'")) {
  console.error('  ✗ FAILED: constants not exported from index.ts');
  process.exit(1);
}
if (!indexContent.includes("export * from './entity'")) {
  console.error('  ✗ FAILED: entity not exported from index.ts');
  process.exit(1);
}
console.log('  ✓ constants.ts re-exported');
console.log('  ✓ entity.ts re-exported\n');

// Check 5: Verify server imports were updated
console.log('✓ Check 5: Verifying server-side imports...');
const gameSessionFile = path.resolve(__dirname, 'server/src/core/GameSession.ts');
const gameSessionContent = fs.readFileSync(gameSessionFile, 'utf-8');
if (!gameSessionContent.includes("import { PHYSICS_CONSTANTS, SNAPSHOT_ALLOWED_ENTITY_TYPES } from '@shared/contracts'")) {
  console.error('  ✗ FAILED: GameSession.ts not importing from @shared/contracts');
  process.exit(1);
}
if (!gameSessionContent.includes("import type { PlayerState, EntityState, Vec3 } from '@shared/contracts'")) {
  console.error('  ✗ FAILED: GameSession.ts not importing types from @shared/contracts');
  process.exit(1);
}
console.log('  ✓ GameSession.ts imports constants and types from @shared/contracts');

const spawnSystemFile = path.resolve(__dirname, 'server/src/session/SpawnSystem.ts');
const spawnSystemContent = fs.readFileSync(spawnSystemFile, 'utf-8');
if (!spawnSystemContent.includes("PlayerPrefabDefinition") || !spawnSystemContent.includes("PlayerSpawnResult")) {
  console.error('  ✗ FAILED: SpawnSystem.ts not importing from @shared/contracts');
  process.exit(1);
}
console.log('  ✓ SpawnSystem.ts imports entity types from @shared/contracts\n');

// Check 6: Verify no duplicate definitions remain
console.log('✓ Check 6: Verifying no duplicate definitions...');
if (gameSessionContent.includes('export interface PlayerState {') || gameSessionContent.includes('export interface EntityState {')) {
  console.error('  ✗ FAILED: Duplicate interface definitions found in GameSession.ts');
  process.exit(1);
}
if (gameSessionContent.includes('const SNAPSHOT_ALLOWED_ENTITY_TYPES = new Set')) {
  console.error('  ✗ FAILED: Duplicate SNAPSHOT_ALLOWED_ENTITY_TYPES definition found in GameSession.ts');
  process.exit(1);
}
console.log('  ✓ No duplicate PlayerState found');
console.log('  ✓ No duplicate EntityState found');
console.log('  ✓ No duplicate SNAPSHOT_ALLOWED_ENTITY_TYPES found\n');

// Check 7: Verify PHYSICS_CONSTANTS extraction
console.log('✓ Check 7: Verifying PHYSICS_CONSTANTS content...');
const hasPlayerMoveSpeed = constantsContent.includes('PLAYER_MOVE_SPEED: 6');
const hasPlayerGravity = constantsContent.includes('PLAYER_GRAVITY: 9.8');
const hasShieldDash = constantsContent.includes('SHIELD_DASH_HORIZONTAL_IMPULSE');
if (!hasPlayerMoveSpeed || !hasPlayerGravity || !hasShieldDash) {
  console.error('  ✗ FAILED: PHYSICS_CONSTANTS missing expected properties');
  process.exit(1);
}
console.log('  ✓ PLAYER_MOVE_SPEED extracted');
console.log('  ✓ PLAYER_GRAVITY extracted');
console.log('  ✓ SHIELD_DASH_HORIZONTAL_IMPULSE extracted\n');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  ✅ SPRINT 3 FILE VALIDATION PASSED');
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('Next steps:');
console.log('  1. Build shared-contracts: npm --prefix packages/shared-contracts run build');
console.log('  2. Type-check: npm run type-check');
console.log('  3. Network tests: node ./node_modules/vitest/vitest.mjs run test/network --config test/vitest.config.ts\n');

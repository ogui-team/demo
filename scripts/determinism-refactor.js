#!/usr/bin/env node

/**
 * DETERMINISM REFACTOR SCRIPT
 * 
 * Automated find/replace for non-deterministic operations:
 * - Date.now() → Engine.time.now()
 * - Math.random() → Engine.random.next()
 * - new Date() → Engine.time.date()
 * 
 * Usage:
 *   node scripts/determinism-refactor.js [--dry-run] [--file pattern]
 */

const fs = require('fs');
const path = require('path');

// Configuration
const REFACTOR_PATTERNS = [
  {
    name: 'Date.now()',
    find: /Date\.now\(\)/g,
    replace: 'Engine.time.now()',
    priority: 'high',
  },
  {
    name: 'Math.random()',
    find: /Math\.random\(\)/g,
    replace: 'Engine.random.next()',
    priority: 'high',
  },
  {
    name: 'new Date()',
    find: /new Date\(\)/g,
    replace: 'Engine.time.date()',
    priority: 'high',
  },
];

const TARGET_DIRS = [
  'client/src',
  'server/src',
];

const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /dist\//,
  /coverage\//,
  /archive\//,
  /docs\//,
];

const EXEMPT_FILES = [
  /deterministic-utils\.ts/, // Exemption: Utils file itself
  /doctor\.js/,              // Exemption: Validation script
];

// Counters
let filesProcessed = 0;
let filesModified = 0;
let totalReplacements = 0;
let replacementsByPattern = {};

// Colors
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function isExcluded(filePath) {
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(filePath)) {
      return true;
    }
  }
  return false;
}

function isExempt(filePath) {
  for (const pattern of EXEMPT_FILES) {
    if (pattern.test(filePath)) {
      return true;
    }
  }
  return false;
}

function shouldRefactor(filePath) {
  return filePath.endsWith('.ts') && 
         !isExcluded(filePath) &&
         !isExempt(filePath);
}

function refactorFile(filePath, dryRun = false) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    let newContent = content;
    const replacements = {};

    for (const pattern of REFACTOR_PATTERNS) {
      const matches = content.match(pattern.find) || [];
      const count = matches.length;

      if (count > 0) {
        replacements[pattern.name] = count;
        totalReplacements += count;
        replacementsByPattern[pattern.name] = (replacementsByPattern[pattern.name] || 0) + count;
        newContent = newContent.replace(pattern.find, pattern.replace);
        modified = true;
      }
    }

    if (modified) {
      if (!dryRun) {
        fs.writeFileSync(filePath, newContent, 'utf8');
      }
      filesModified++;
      
      const relPath = path.relative(process.cwd(), filePath);
      log(`  ✓ ${relPath}`, 'green');
      for (const [name, count] of Object.entries(replacements)) {
        log(`    → ${name}: ${count}x`, 'yellow');
      }
    }

    return modified;
  } catch (err) {
    log(`  ✗ Error processing ${filePath}: ${err.message}`, 'red');
    return false;
  }
}

function walkDirectory(dir, callback) {
  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        walkDirectory(filePath, callback);
      } else if (stat.isFile()) {
        filesProcessed++;
        if (shouldRefactor(filePath)) {
          callback(filePath);
        }
      }
    }
  } catch (err) {
    // Skip directories we can't read
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filePattern = args.find(a => a.startsWith('--file='))?.split('=')[1];

  log('\n╔════════════════════════════════════════════════════════════════╗');
  log('║  DETERMINISM REFACTOR - Automated Non-Deterministic Fix       ║');
  log('╚════════════════════════════════════════════════════════════════╝\n');

  if (dryRun) {
    log('DRY RUN MODE - No files will be modified\n', 'cyan');
  }

  log('Patterns to replace:');
  for (const pattern of REFACTOR_PATTERNS) {
    log(`  • ${pattern.name} → ${pattern.replace}`, 'cyan');
  }
  log('');

  // Process directories
  const dirs = filePattern 
    ? [filePattern]
    : TARGET_DIRS.map(d => path.join(process.cwd(), d));

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      log(`Directory not found: ${dir}`, 'yellow');
      continue;
    }

    log(`\nScanning: ${dir}`, 'blue');
    walkDirectory(dir, (filePath) => {
      refactorFile(filePath, dryRun);
    });
  }

  // Summary
  log('\n╔════════════════════════════════════════════════════════════════╗');
  log('║  REFACTOR SUMMARY                                              ║');
  log('╚════════════════════════════════════════════════════════════════╝\n');

  log(`Total files scanned:      ${filesProcessed}`);
  log(`Files modified:           ${filesModified}`, filesModified > 0 ? 'green' : 'yellow');
  log(`Total replacements:       ${totalReplacements}`, totalReplacements > 0 ? 'green' : 'yellow');
  log('');

  log('Breakdown by pattern:');
  for (const [name, count] of Object.entries(replacementsByPattern)) {
    log(`  • ${name}: ${count}`, 'green');
  }

  if (dryRun) {
    log('\n✓ DRY RUN COMPLETE - Re-run without --dry-run to apply changes', 'cyan');
  } else if (filesModified > 0) {
    log('\n✓ Refactoring complete! Run node scripts/doctor.js to validate', 'green');
  } else {
    log('\nNo files needed refactoring', 'yellow');
  }

  log('');
}

main();

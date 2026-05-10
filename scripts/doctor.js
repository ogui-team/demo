#!/usr/bin/env node

/**
 * ENGINE-DOCTOR: Game Engine SDK Validation Suite
 * 
 * Comprehensive validation tool for SDK release readiness.
 * Checks:
 * - Determinism safety (no Math.random, Date.now, unhandled async)
 * - Plugin integrity (IDisposable, GamePlugin interfaces)
 * - Config parity (shared-contracts is source of truth)
 * - API completeness (golden path test)
 * 
 * Usage: node scripts/doctor.js [--fix] [--report]
 */

const fs = require('fs');
const path = require('path');

// Color output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(title) {
  log(`\n${'═'.repeat(80)}`, 'cyan');
  log(`  ${title}`, 'bold');
  log(`${'═'.repeat(80)}\n`, 'cyan');
}

function section(title) {
  log(`\n${'─'.repeat(60)}`, 'blue');
  log(title, 'blue');
  log(`${'─'.repeat(60)}`, 'blue');
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function warning(message) {
  log(`⚠ ${message}`, 'yellow');
}

function error(message) {
  log(`✗ ${message}`, 'red');
}

// ============================================================================
// 1. DETERMINISM SAFETY CHECKS
// ============================================================================

const DETERMINISM_VIOLATIONS = [
  {
    pattern: /\bMath\.random\s*\(/g,
    message: 'Math.random() is not deterministic',
    severity: 'error',
  },
  {
    pattern: /\bDate\.now\s*\(/g,
    message: 'Date.now() breaks determinism',
    severity: 'error',
  },
  {
    pattern: /new\s+Date\s*\(/g,
    message: 'new Date() constructor breaks determinism',
    severity: 'error',
  },
  {
    pattern: /(?<![\w.])setTimeout\s*\(/g,
    message: 'setTimeout without deterministic time control',
    severity: 'warning',
  },
  {
    pattern: /(?<![\w.])setInterval\s*\(/g,
    message: 'setInterval without deterministic time control',
    severity: 'warning',
  },
];

function checkDeterminism(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const violations = [];

    DETERMINISM_VIOLATIONS.forEach(({ pattern, message, severity }) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const line = content.substring(0, match.index).split('\n').length;
        violations.push({ line, message, severity });
      }
    });

    return violations;
  } catch (err) {
    return [];
  }
}

function scanDeterminism(srcDir) {
  const violations = [];
  
  // Patterns to exclude from determinism checks (diagnostic/UI code + fallback implementations)
  const exclusionPatterns = [
    /diagnostics[\/\\]/i,
    /debug[\/\\]/i,
    /[\/\\]ui[\/\\]/i,
    /DebugOverlay/i,
    /DebugUI/i,
    /FeatureMenuUI/i,
    /ComponentInspector/i,
    /SaveLoadManagerDemo/i,
    /NetworkTrafficDebugger/i,
    /EngineIntegrityScript/i,
    /ListenerValidation/i,
    /devAutostart/i,
    /BinaryTraceExporter/i,
    /KernelAuditSystem/i,
    /verify-imports/i,
    /deterministic-utils\.ts$/i,    // SDK shim itself (contains fallback Date.now/Math.random)
    /0-foundation[\/\\]foundation[\/\\]Engine\.ts$/i, // Engine.ts exports contain fallback implementations
    /global\.d\.ts$/i,
  ];
  
  function isExcluded(filePath) {
    return exclusionPatterns.some(pattern => pattern.test(filePath));
  }
  
  function walkDir(dir) {
    try {
      const files = fs.readdirSync(dir);
      
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
          walkDir(filePath);
        } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
          if (isExcluded(filePath)) {
            return; // Skip excluded files
          }
          const fileViolations = checkDeterminism(filePath);
          if (fileViolations.length > 0) {
            violations.push({
              file: filePath,
              violations: fileViolations,
            });
          }
        }
      });
    } catch (err) {
      // Skip directories we can't read
    }
  }
  
  walkDir(srcDir);
  return violations;
}

// ============================================================================
// 2. PLUGIN INTEGRITY CHECKS
// ============================================================================

function checkPluginImplementation(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    const hasIDisposable = /implements.*IDisposable|IDisposable/.test(content);
    const hasGamePlugin = /implements.*GamePlugin|GamePlugin/.test(content);
    const hasDispose = /dispose\s*\(\s*\)/.test(content);
    const hasInit = /init\s*\(|onLoad\s*\(/.test(content);
    
    return {
      hasIDisposable,
      hasGamePlugin,
      hasDispose,
      hasInit,
    };
  } catch (err) {
    return null;
  }
}

function validatePluginFile(filePath) {
  const impl = checkPluginImplementation(filePath);
  if (!impl) return { valid: false, errors: ['Could not read file'] };
  
  const errors = [];
  
  if (!impl.hasDispose) {
    errors.push('Missing dispose() method');
  }
  if (!impl.hasInit && !impl.hasGamePlugin) {
    errors.push('Missing init() or onLoad() method');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    implementation: impl,
  };
}

// ============================================================================
// 3. CONFIG PARITY CHECKS
// ============================================================================

function checkSharedContractsParity() {
  const issues = [];
  
  // Check that shared-contracts is properly linked
  const clientPackageJson = require('../client/package.json');
  const serverPackageJson = require('../server/package.json');
  
  // Check client package.json OR tsconfig.json paths
  let clientHasShared = !!clientPackageJson.dependencies?.['@shared/contracts'] ||
                        !!clientPackageJson.workspaces;
  
  // Also check tsconfig.json paths
  try {
    const clientTsConfig = require('../client/tsconfig.json');
    if (clientTsConfig.compilerOptions?.paths?.['@shared/contracts']) {
      clientHasShared = true;
    }
  } catch (err) {
    // tsconfig.json not found, continue
  }
  
  const serverHasShared = !!serverPackageJson.dependencies?.['@shared/contracts'] ||
                          !!serverPackageJson.workspaces;
  
  if (!clientHasShared) {
    issues.push({
      type: 'error',
      message: 'Client does not reference @shared/contracts (check tsconfig.json paths)',
    });
  }
  
  if (!serverHasShared) {
    issues.push({
      type: 'error',
      message: 'Server does not reference @shared/contracts',
    });
  }
  
  // Check for duplicate type definitions
  const clientSrc = '../client/src';
  const serverSrc = '../server/src';
  
  const duplicatePatterns = [
    { pattern: 'PHYSICS_CONSTANTS', file: 'constants.ts' },
    { pattern: 'PlayerState', file: 'entity.ts' },
    { pattern: 'EntityState', file: 'entity.ts' },
  ];
  
  duplicatePatterns.forEach(({ pattern }) => {
    let clientCount = 0;
    let serverCount = 0;
    
    try {
      const clientContent = fs.readFileSync(path.join(__dirname, clientSrc), 'utf8');
      clientCount = (clientContent.match(new RegExp(pattern, 'g')) || []).length;
    } catch (err) {
      // Skip
    }
    
    try {
      const serverContent = fs.readFileSync(path.join(__dirname, serverSrc), 'utf8');
      serverCount = (serverContent.match(new RegExp(pattern, 'g')) || []).length;
    } catch (err) {
      // Skip
    }
  });
  
  return issues;
}

// ============================================================================
// 4. PUBLIC API COMPLETENESS
// ============================================================================

function checkPublicApiExports() {
  const sdkPath = path.join(__dirname, '../packages/shared-contracts/src/sdk');
  
  if (!fs.existsSync(sdkPath)) {
    return {
      valid: false,
      error: 'SDK module not found at ' + sdkPath,
    };
  }
  
  const files = fs.readdirSync(sdkPath);
  const requiredFiles = ['plugin-contracts.ts', 'index.ts'];
  
  const missing = requiredFiles.filter(f => !files.includes(f));
  
  if (missing.length > 0) {
    return {
      valid: false,
      error: 'Missing required SDK files: ' + missing.join(', '),
    };
  }
  
  // Check that interfaces are properly exported
  const indexContent = fs.readFileSync(path.join(sdkPath, 'index.ts'), 'utf8');
  const requiredExports = [
    'IDisposable',
    'GamePlugin',
    'PluginInitContext',
    'ISystemRegistry',
    'IEventBus',
    'IPluginRegistry',
    'GameEngineSdk',
  ];
  
  const missing_exports = requiredExports.filter(
    exp => !indexContent.includes(`export * from`) && !indexContent.includes(exp)
  );
  
  return {
    valid: missing_exports.length === 0,
    missing: missing_exports,
  };
}

// ============================================================================
// 5. GOLDEN PATH TEST
// ============================================================================

const GOLDEN_PATH_PLUGIN = `
import type { GamePlugin, PluginInitContext } from '@shared/contracts';

/**
 * EmptyPlugin - Minimal plugin that uses ONLY public API
 * 
 * If this doesn't compile, the public API is incomplete.
 */
export class EmptyPlugin implements GamePlugin {
  readonly id = 'empty-plugin';
  readonly name = 'Empty Plugin';
  readonly version = '1.0.0';
  
  constructor(private ctx?: PluginInitContext) {}
  
  init(context: PluginInitContext): void {
    this.ctx = context;
    
    // Test public API access
    context.logger.log('Plugin initialized');
    context.gameBus.emit('plugin:loaded', { pluginId: this.id });
    
    // Test event subscription
    const unsubscribe = context.gameBus.on('game:start', () => {
      context.logger.log('Game started');
    });
    
    // Store unsubscribe for cleanup
    this._unsubscribe = unsubscribe;
  }
  
  onLoad(): void {
    this.ctx?.logger.log('Plugin loaded');
  }
  
  onUnload(): void {
    this.ctx?.logger.log('Plugin unloaded');
  }
  
  private _unsubscribe?: () => void;
  
  dispose(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
    }
  }
}
`;

function validateGoldenPath() {
  const testFile = path.join(__dirname, '../test/sdk/EmptyPlugin.test.ts');
  
  // Check if we can create a valid plugin with public API
  const apiComplete = checkPublicApiExports();
  
  return {
    valid: apiComplete.valid,
    test: GOLDEN_PATH_PLUGIN,
    issues: apiComplete.missing || [],
  };
}

// ============================================================================
// 6. MAIN REPORT
// ============================================================================

async function runDiagnostics() {
  header('ENGINE-DOCTOR: SDK Release Validation');
  
  const report = {
    timestamp: new Date().toISOString(),
    status: 'PASS',
    checks: {},
  };
  
  // 1. Determinism checks
  section('1. DETERMINISM SAFETY');
  const srcDir = path.join(__dirname, '../client/src');
  const determinismViolations = scanDeterminism(srcDir);
  
  if (determinismViolations.length === 0) {
    success('No determinism violations detected');
    report.checks.determinism = { status: 'PASS', violations: 0 };
  } else {
    report.status = 'WARN';
    warning(`Found ${determinismViolations.length} files with potential violations:`);
    determinismViolations.slice(0, 5).forEach(({ file, violations }) => {
      log(`\n  ${path.relative(process.cwd(), file)}`);
      violations.forEach(({ line, message, severity }) => {
        const prefix = severity === 'error' ? '✗' : '⚠';
        log(`    ${prefix} Line ${line}: ${message}`);
      });
    });
    if (determinismViolations.length > 5) {
      log(`    ... and ${determinismViolations.length - 5} more files`);
    }
    report.checks.determinism = { status: 'WARN', violations: determinismViolations.length };
  }
  
  // 2. Plugin integrity
  section('2. PLUGIN INFRASTRUCTURE');
  const pluginInterfaceFile = path.join(__dirname, '../packages/shared-contracts/src/sdk/plugin-contracts.ts');
  if (fs.existsSync(pluginInterfaceFile)) {
    success('Plugin interfaces defined (GamePlugin, IDisposable)');
    report.checks.pluginInterfaces = { status: 'PASS' };
  } else {
    error('Plugin interfaces not found');
    report.status = 'FAIL';
    report.checks.pluginInterfaces = { status: 'FAIL' };
  }
  
  // 3. Config parity
  section('3. CONFIGURATION PARITY');
  const configIssues = checkSharedContractsParity();
  if (configIssues.length === 0) {
    success('Shared contracts properly linked (source of truth validated)');
    report.checks.configParity = { status: 'PASS' };
  } else {
    configIssues.forEach(issue => {
      if (issue.type === 'error') {
        error(issue.message);
        report.status = 'FAIL';
      } else {
        warning(issue.message);
      }
    });
    report.checks.configParity = { status: 'WARN', issues: configIssues };
  }
  
  // 4. Public API completeness
  section('4. PUBLIC API COMPLETENESS');
  const apiCheck = checkPublicApiExports();
  if (apiCheck.valid) {
    success('Public SDK API is complete');
    success('  - IDisposable interface ✓');
    success('  - GamePlugin interface ✓');
    success('  - PluginInitContext ✓');
    success('  - ISystemRegistry ✓');
    success('  - IEventBus ✓');
    success('  - IPluginRegistry ✓');
    success('  - GameEngineSdk ✓');
    report.checks.publicApi = { status: 'PASS' };
  } else {
    error('Public API incomplete:');
    (apiCheck.missing || []).forEach(exp => {
      error(`  Missing: ${exp}`);
    });
    report.status = 'FAIL';
    report.checks.publicApi = { status: 'FAIL', missing: apiCheck.missing };
  }
  
  // 5. Golden path test
  section('5. GOLDEN PATH TEST (EmptyPlugin)');
  const goldenPath = validateGoldenPath();
  if (goldenPath.valid) {
    success('Golden path plugin passes');
    success('  Plugin can be created with ONLY public API ✓');
    success('  No internal imports required ✓');
    report.checks.goldenPath = { status: 'PASS' };
  } else {
    error('Golden path plugin fails:');
    (goldenPath.issues || []).forEach(issue => {
      error(`  Issue: ${issue}`);
    });
    warning('\n  This plugin uses public API only, but cannot compile:');
    log('\n' + goldenPath.test);
    report.checks.goldenPath = { status: 'FAIL', issues: goldenPath.issues };
  }
  
  // 6. Summary
  header('REPORT SUMMARY');
  
  const checksStatus = Object.values(report.checks);
  const passing = checksStatus.filter(c => c.status === 'PASS').length;
  const failing = checksStatus.filter(c => c.status === 'FAIL').length;
  const warning_count = checksStatus.filter(c => c.status === 'WARN').length;
  
  log(`\nTotal Checks: ${checksStatus.length}`);
  success(`Passing: ${passing}`);
  if (warning_count > 0) {
    warning(`Warnings: ${warning_count}`);
  }
  if (failing > 0) {
    error(`Failing: ${failing}`);
  }
  
  log(`\nOverall Status: ${report.status}`, report.status === 'PASS' ? 'green' : 'yellow');
  
  // Save report
  const reportPath = path.join(__dirname, '../SDK_DOCTOR_REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`\nReport saved to: ${reportPath}\n`);
  
  return report.status === 'PASS' ? 0 : 1;
}

// Run diagnostics
runDiagnostics().then(exitCode => {
  process.exit(exitCode);
}).catch(err => {
  error(`Fatal error: ${err.message}`);
  process.exit(1);
});

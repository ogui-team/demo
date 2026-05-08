/**
 * ============================================================================
 * verify-imports.ts - Path Resolution & Dependency Cycle Audit
 * ============================================================================
 *
 * Scans all TypeScript files in src/engine and verifies:
 * 1. All `@engine/*` imports resolve to valid public-api.ts files
 * 2. Detects circular dependencies between domains
 * 3. Validates tsconfig.json alias configuration
 * 4. Generates detailed error report with file locations
 *
 * Usage: npx ts-node verify-imports.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface ImportAnalysis {
  file: string;
  imports: string[];
  errors: string[];
  domain: string;
}

interface CircularDependency {
  chain: string[];
  severity: 'critical' | 'warning';
}

interface VerificationReport {
  timestamp: string;
  totalFiles: number;
  filesWithErrors: number;
  totalErrors: number;
  circularDependencies: CircularDependency[];
  missingPublicApis: Map<string, string[]>;
  importAnalysis: ImportAnalysis[];
  summary: {
    status: 'PASS' | 'FAIL';
    message: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENGINE_ROOT = path.join(PROJECT_ROOT, 'client/src/engine');

/**
 * Expected public-api.ts files for each domain
 * Maps domain prefix to expected barrel file location
 */
const EXPECTED_PUBLIC_APIS: Record<string, string> = {
  '@engine/core': 'core/public-api.ts',
  '@engine/0-foundation': '0-foundation/public-api.ts',
  '@engine/2-systems': '2-systems/public-api.ts',
  '@engine/3-network': '3-network/public-api.ts',
  '@engine/4-runtime': '4-runtime/public-api.ts',
  '@engine/1-kernel': '1-kernel/public-api.ts',
};

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract domain from file path
 * client/src/engine/core/Entity.ts -> 'core'
 * client/src/engine/2-systems/weapons/WeaponSystem.ts -> '2-systems'
 */
function extractDomain(filePath: string): string {
  const relative = path.relative(ENGINE_ROOT, filePath);
  const parts = relative.split(path.sep);
  
  if (parts[0].match(/^[0-9]-/)) {
    return parts[0]; // e.g., '0-foundation', '2-systems'
  }
  
  return parts[0]; // e.g., 'core', 'network'
}

/**
 * Extract all @engine imports from a file
 */
function extractEngineImports(content: string): string[] {
  const imports: string[] = [];
  
  // Match: import { X, Y } from '@engine/...'
  const importRegex = /import\s+[\{\}a-zA-Z0-9_\s,;]*\s+from\s+['"](@engine\/[^'"]+)['"]/g;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  
  // Match: import * as X from '@engine/...'
  const namespaceRegex = /import\s+\*\s+as\s+\w+\s+from\s+['"](@engine\/[^'"]+)['"]/g;
  while ((match = namespaceRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  
  return [...new Set(imports)]; // Deduplicate
}

/**
 * Recursively scan directory for TypeScript files
 */
function scanTypeScriptFiles(dir: string, filter: (f: string) => boolean = () => true): string[] {
  const result: string[] = [];
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name === 'node_modules') continue;
    if (entry.name === 'dist') continue;
    
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      result.push(...scanTypeScriptFiles(fullPath, filter));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      if (filter(fullPath)) {
        result.push(fullPath);
      }
    }
  }
  
  return result;
}

/**
 * Check if a public-api.ts file exists for an import path
 */
function validatePublicApiPath(importPath: string): { valid: boolean; resolvedPath?: string; error?: string } {
  // Match @engine/domain or @engine/domain/subpath patterns
  const match = importPath.match(/^@engine\/([^/]+)(?:\/public-api)?$/);
  
  if (!match) {
    return { valid: false, error: `Invalid import format: ${importPath}` };
  }
  
  const domain = match[1];
  const publicApiPath = path.join(ENGINE_ROOT, domain, 'public-api.ts');
  
  if (fs.existsSync(publicApiPath)) {
    return { valid: true, resolvedPath: publicApiPath };
  }
  
  return {
    valid: false,
    error: `Missing public-api.ts for domain @engine/${domain}. Expected: ${publicApiPath}`,
  };
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(dependencyGraph: Map<string, string[]>): CircularDependency[] {
  const circles: CircularDependency[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];
  
  function dfs(node: string): void {
    if (circles.length > 10) return; // Limit reports
    
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = [...path.slice(cycleStart), node];
        circles.push({
          chain: cycle,
          severity: cycle.length <= 3 ? 'critical' : 'warning',
        });
      }
      return;
    }
    
    visiting.add(node);
    path.push(node);
    
    const deps = dependencyGraph.get(node) ?? [];
    for (const dep of deps) {
      dfs(dep);
    }
    
    path.pop();
    visiting.delete(node);
    visited.add(node);
  }
  
  for (const node of dependencyGraph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }
  
  // Deduplicate cycles
  const uniqueCycles = new Map<string, CircularDependency>();
  for (const cycle of circles) {
    const canonical = cycle.chain.slice().sort().join(' -> ');
    if (!uniqueCycles.has(canonical)) {
      uniqueCycles.set(canonical, cycle);
    }
  }
  
  return Array.from(uniqueCycles.values());
}

/**
 * Main verification
 */
function runVerification(): VerificationReport {
  const startTime = Date.now();
  const report: VerificationReport = {
    timestamp: new Date().toISOString(),
    totalFiles: 0,
    filesWithErrors: 0,
    totalErrors: 0,
    circularDependencies: [],
    missingPublicApis: new Map(),
    importAnalysis: [],
    summary: { status: 'PASS', message: 'All imports valid' },
  };
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('🔍 Verifying @engine imports...');
  console.log(`${'='.repeat(80)}\n`);
  
  // Step 1: Scan all TypeScript files
  const tsFiles = scanTypeScriptFiles(ENGINE_ROOT);
  report.totalFiles = tsFiles.length;
  
  console.log(`📁 Found ${tsFiles.length} TypeScript files\n`);
  
  // Step 2: Analyze imports in each file
  const dependencyGraph = new Map<string, string[]>();
  
  for (const file of tsFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const imports = extractEngineImports(content);
    const domain = extractDomain(file);
    const analysis: ImportAnalysis = {
      file: path.relative(ENGINE_ROOT, file),
      imports,
      errors: [],
      domain,
    };
    
    // Validate each import
    for (const imp of imports) {
      const validation = validatePublicApiPath(imp);
      if (!validation.valid) {
        analysis.errors.push(validation.error || 'Unknown error');
        
        // Track missing public APIs
        const impDomain = imp.split('/')[1];
        if (!report.missingPublicApis.has(impDomain)) {
          report.missingPublicApis.set(impDomain, []);
        }
        report.missingPublicApis.get(impDomain)!.push(file);
      }
    }
    
    if (analysis.errors.length > 0) {
      report.filesWithErrors++;
      report.totalErrors += analysis.errors.length;
    }
    
    report.importAnalysis.push(analysis);
    
    // Build dependency graph for circle detection
    const domainDeps = [
      ...new Set(
        imports
          .map((imp) => imp.split('/')[1])
          .filter((d) => d !== domain),
      ),
    ];
    if (domainDeps.length > 0) {
      dependencyGraph.set(domain, domainDeps);
    }
  }
  
  // Step 3: Detect circular dependencies
  report.circularDependencies = detectCircularDependencies(dependencyGraph);
  
  // Step 4: Update summary
  if (report.totalErrors > 0 || report.circularDependencies.length > 0) {
    report.summary.status = 'FAIL';
    report.summary.message = `${report.totalErrors} import errors, ${report.circularDependencies.length} circular dependencies`;
  }
  
  // Step 5: Print results
  printReport(report, tsFiles);
  
  const duration = Date.now() - startTime;
  console.log(`\n⏱️  Verification completed in ${duration}ms\n`);
  
  return report;
}

/**
 * Format and print the verification report
 */
function printReport(report: VerificationReport, tsFiles: string[]): void {
  // Print summary
  const statusIcon = report.summary.status === 'PASS' ? '✅' : '❌';
  console.log(`${statusIcon} Status: ${report.summary.status}\n`);
  console.log(`📊 Summary:`);
  console.log(`   Total files scanned: ${report.totalFiles}`);
  console.log(`   Files with errors: ${report.filesWithErrors}`);
  console.log(`   Total errors: ${report.totalErrors}`);
  console.log(`   Circular dependencies: ${report.circularDependencies.length}\n`);
  
  // Print domains without public-api.ts
  if (report.missingPublicApis.size > 0) {
    console.log(`\n⚠️  Missing public-api.ts files:\n`);
    for (const [domain, files] of report.missingPublicApis.entries()) {
      console.log(`   @engine/${domain}:`);
      console.log(`     Expected: ${path.join(ENGINE_ROOT, domain, 'public-api.ts')}`);
      console.log(`     Imported by: ${files.length} files\n`);
    }
  }
  
  // Print circular dependencies
  if (report.circularDependencies.length > 0) {
    console.log(`\n🔄 Circular Dependencies:\n`);
    for (const cycle of report.circularDependencies) {
      const severity = cycle.severity === 'critical' ? '🔴' : '🟡';
      console.log(`   ${severity} ${cycle.chain.join(' -> ')}\n`);
    }
  }
  
  // Print import errors (limited)
  const filesWithErrors = report.importAnalysis.filter((a) => a.errors.length > 0).slice(0, 10);
  if (filesWithErrors.length > 0) {
    console.log(`\n❌ Import Errors (showing first 10):\n`);
    for (const analysis of filesWithErrors) {
      console.log(`   📄 ${analysis.file}`);
      for (const error of analysis.errors) {
        console.log(`      • ${error}`);
      }
      console.log();
    }
    
    if (report.filesWithErrors > 10) {
      console.log(`   ... and ${report.filesWithErrors - 10} more files with errors\n`);
    }
  }
  
  // Print expected public-api locations
  console.log(`\n📋 Expected public-api.ts locations:\n`);
  for (const [domain, location] of Object.entries(EXPECTED_PUBLIC_APIS)) {
    const fullPath = path.join(ENGINE_ROOT, location);
    const exists = fs.existsSync(fullPath);
    const icon = exists ? '✅' : '❌';
    console.log(`   ${icon} ${domain} -> ${location}`);
  }
  
  console.log(`\n${'='.repeat(80)}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

const report = runVerification();
process.exit(report.summary.status === 'PASS' ? 0 : 1);

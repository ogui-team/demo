#!/usr/bin/env node

/**
 * Fix Server-Side Engine References
 * 
 * The server doesn't have access to Engine.time or Engine.random.
 * This script replaces them with standard JavaScript equivalents.
 */

const fs = require('fs');
const path = require('path');

const REPLACEMENTS = [
  {
    pattern: /Engine\.time\.now\(\)/g,
    replacement: 'Date.now()',
    description: 'Engine.time.now() → Date.now()'
  },
  {
    pattern: /Engine\.random\.next\(\)/g,
    replacement: 'Math.random()',
    description: 'Engine.random.next() → Math.random()'
  },
  {
    pattern: /Engine\.time\.date\(\)/g,
    replacement: 'new Date()',
    description: 'Engine.time.date() → new Date()'
  }
];

function fixFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    REPLACEMENTS.forEach(({ pattern, replacement, description }) => {
      if (pattern.test(content)) {
        content = content.replace(pattern, replacement);
        modified = true;
        console.log(`  ✓ ${description}`);
      }
    });
    
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      return true;
    }
  } catch (err) {
    console.error(`  ✗ Error: ${err.message}`);
  }
  
  return false;
}

function scanDir(dir) {
  let count = 0;
  
  try {
    const files = fs.readdirSync(dir);
    
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory() && !file.startsWith('.')) {
        count += scanDir(filePath);
      } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
        if (fixFile(filePath)) {
          console.log(`📝 Fixed: ${filePath}`);
          count++;
        }
      }
    });
  } catch (err) {
    // Skip
  }
  
  return count;
}

console.log('\n🔧 Fixing Server-Side Engine References...\n');

const serverSrcDir = path.join(__dirname, '../server/src');
const count = scanDir(serverSrcDir);

console.log(`\n✅ Fixed ${count} files\n`);

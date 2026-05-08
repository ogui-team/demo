const path = require('node:path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'commonjs',
  target: 'es2020',
  moduleResolution: 'node',
  esModuleInterop: true,
  skipLibCheck: true,
});

require('ts-node/register/transpile-only');

const { runEngineCapabilityAudit } = require(path.resolve(__dirname, '../engine/audit/runEngineCapabilityAudit.ts'));

runEngineCapabilityAudit({
  workspaceRoot: path.resolve(__dirname, '..'),
  outputPath: path.resolve(__dirname, '../engine/reports/ENGINE_CAPABILITY_REPORT.json'),
});

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const protectedStatePaths = [
  'engine.appState',
  'gameplay.active',
  'game.mode',
  'hud.visible',
  'ui.hud.mode',
]

const scriptFile = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(scriptFile), '..')
const sourceRoot = path.join(repoRoot, 'client', 'src')
const engineControllerPath = 'client/src/1-kernel/core/EngineController.ts'
const hudBootstrapPath = 'client/src/4-runtime/runtime/bootstrap/phases.ts'

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function indexToLine(content, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1
    }
  }
  return line
}

function createViolation(rule, filePath, line, detail) {
  return { rule, filePath, line, detail }
}

function collectMatches(content, pattern) {
  const matches = []
  let match = pattern.exec(content)
  while (match) {
    matches.push({ index: match.index, text: match[0] })
    match = pattern.exec(content)
  }
  return matches
}

export function collectProtectedWriteViolations(relativePath, content) {
  if (relativePath === engineControllerPath) {
    return []
  }

  const violations = []
  for (const statePath of protectedStatePaths) {
    const writePatterns = [
      new RegExp(`\\.set\\(\\s*['\"]${escapeRegExp(statePath)}['\"]`, 'g'),
      new RegExp(`writeStateValue\\(\\s*['\"]${escapeRegExp(statePath)}['\"]`, 'g'),
    ]
    for (const pattern of writePatterns) {
      for (const match of collectMatches(content, pattern)) {
        violations.push(
          createViolation(
            'forbidden-protected-write',
            relativePath,
            indexToLine(content, match.index),
            `Protected state path \"${statePath}\" may only be written by EngineController.`,
          ),
        )
      }
    }
  }
  return violations
}

export function collectAuthorityReadDriftViolations(relativePath, content) {
  const violations = []
  const isRuntimeSurface = relativePath.startsWith('client/src/4-runtime/')

  if (isRuntimeSurface) {
    const modeManagerReads = collectMatches(content, /\bmodeManager\??\.is(?:Play|Editor)Mode\(/g)
    for (const match of modeManagerReads) {
      violations.push(
        createViolation(
          'mode-manager-authority-read',
          relativePath,
          indexToLine(content, match.index),
          'Runtime authority decisions must use EngineController or controller-owned state, not ModeManager truth reads.',
        ),
      )
    }

    const activeGameModeReads = collectMatches(content, /\bengineGameModes\.getActiveName\(/g)
    for (const match of activeGameModeReads) {
      violations.push(
        createViolation(
          'game-mode-system-authority-read',
          relativePath,
          indexToLine(content, match.index),
          'Runtime authority decisions must read controller-owned game mode state, not engineGameModes.getActiveName().',
        ),
      )
    }
  }

  if (relativePath === hudBootstrapPath) {
    const hudBootstrapMatches = collectMatches(content, /new\s+HUDSystem\(\s*\{[\s\S]*?\bstateManager\b[\s\S]*?\bplayerMode\s*:/g)
    for (const match of hudBootstrapMatches) {
      violations.push(
        createViolation(
          'hud-bootstrap-authority-default',
          relativePath,
          indexToLine(content, match.index),
          'State-managed HUD bootstrap must not inject a local playerMode authority default.',
        ),
      )
    }
  }

  return violations
}

async function collectSourceFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) {
      continue
    }
    files.push(fullPath)
  }

  return files
}

export async function scanAuthorityEnforcement(rootDir = sourceRoot) {
  const files = await collectSourceFiles(rootDir)
  const violations = []

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8')
    const relativePath = normalizePath(path.relative(repoRoot, filePath))
    violations.push(...collectProtectedWriteViolations(relativePath, content))
    violations.push(...collectAuthorityReadDriftViolations(relativePath, content))
  }

  return violations.sort((left, right) => {
    if (left.filePath === right.filePath) {
      return left.line - right.line
    }
    return left.filePath.localeCompare(right.filePath)
  })
}

export function formatAuthorityViolations(violations) {
  return violations.map((violation) => (
    `${violation.filePath}:${violation.line} [${violation.rule}] ${violation.detail}`
  )).join('\n')
}

async function main() {
  const violations = await scanAuthorityEnforcement()
  if (violations.length === 0) {
    console.log('[authority] OK: no forbidden writes or authority read drift found.')
    return
  }

  console.error('[authority] Violations detected:')
  console.error(formatAuthorityViolations(violations))
  process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  await main()
}
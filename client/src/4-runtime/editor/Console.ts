/**
 * Game Console
 * CS 1.6-style in-game command console.
 *
 * Toggle:  ` (backtick / tilde)
 * History: ↑ / ↓
 * Close:   Escape  or  ` again
 *
 * Register custom commands:
 *   import { getConsole } from './Engine';
 *   getConsole()?.register('spawn', (args) => { ... return 'spawned!'; });
 *
 * Check open state (controllers use this to suppress input):
 *   import { isConsoleOpen } from './Console';
 */

import { logEvent } from '@engine/1-kernel/core/public-api';

export type CommandHandler = (args: string[]) => string | void;

interface Command {
  name: string;
  description: string;
  handler: CommandHandler;
}

interface ConsoleLine {
  text: string;
  type: 'input' | 'output' | 'error' | 'system';
}

// Module-level singleton flag checked by controllers
let _open = false;
export function isConsoleOpen(): boolean {
  return _open;
}

export class GameConsole {
  private container!: HTMLDivElement;
  private outputEl!: HTMLDivElement;
  private inputEl!: HTMLInputElement;
  private promptEl!: HTMLSpanElement;

  private commands: Map<string, Command> = new Map();
  private history: string[] = [];
  private historyIndex: number = -1;
  private lines: ConsoleLine[] = [];

  private keyDownHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.keyDownHandler = (e: KeyboardEvent) => this.onGlobalKeyDown(e);
    this.buildDOM();
    this.registerBuiltins();
    window.addEventListener('keydown', this.keyDownHandler);
    this.print('system', 'PS1 Engine Console — type "help" for commands');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  isOpen(): boolean { return _open; }

  open(): void {
    if (_open) return;
    _open = true;
    this.container.style.display = 'flex';
    // Small delay so the same keydown that opened it doesn't land in the input
    requestAnimationFrame(() => this.inputEl.focus());
  }

  close(): void {
    if (!_open) return;
    _open = false;
    this.container.style.display = 'none';
    this.inputEl.blur();
  }

  toggle(): void {
    _open ? this.close() : this.open();
  }

  /**
   * Register a command.
   * @param name    The command name (case-insensitive)
   * @param desc    Short description shown in `help`
   * @param handler Called with tokenised arguments. Return a string to print as output.
   */
  register(name: string, desc: string, handler: CommandHandler): void {
    this.commands.set(name.toLowerCase(), { name: name.toLowerCase(), description: desc, handler });
  }

  /** Print a line to the console output. */
  log(text: string): void {
    this.print('output', text);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDownHandler);
    this.container.remove();
  }

  // ---------------------------------------------------------------------------
  // Built-in commands
  // ---------------------------------------------------------------------------

  private registerBuiltins(): void {
    this.register('help', 'List all available commands', () => {
      const lines = ['Available commands:'];
      for (const cmd of this.commands.values()) {
        lines.push(`  ${cmd.name.padEnd(16)} ${cmd.description}`);
      }
      return lines.join('\n');
    });

    this.register('clear', 'Clear console output', () => {
      this.lines = [];
      this.outputEl.innerHTML = '';
    });

    this.register('version', 'Show engine version', () => 'PS1 Engine v0.1.0');

    this.register('echo', 'Echo text back', (args) => args.join(' '));

    // Placeholders — Engine.ts wires real implementations for these
    this.register('mode', 'Switch mode: mode editor | mode play', () =>
      'Mode switching not yet wired — call Engine.setEngineMode() directly.');

    this.register('setpos', 'Teleport camera: setpos <x> <y> <z>', () =>
      'setpos not yet wired.');

    this.register('speed', 'Set camera speed: speed <value>', () =>
      'speed not yet wired.');

    this.register('map', 'Load a map (placeholder): map <name>', (args) =>
      `map "${args[0] ?? '?'}" — not yet implemented.`);

    this.register('team', 'Change team (placeholder): team <1|2>', (args) =>
      `team "${args[0] ?? '?'}" — not yet implemented.`);

    this.register('list', 'List entities or systems: list entities', () =>
      'list not yet wired.');
  }

  // ---------------------------------------------------------------------------
  // Input handling
  // ---------------------------------------------------------------------------

  private onGlobalKeyDown(e: KeyboardEvent): void {
    const isToggleKey =
      e.key === '`' || e.key === '~' || e.key === '^' ||
      e.code === 'Backquote' || e.code === 'IntlBackslash';
    if (isToggleKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.toggle();
      return;
    }

    if (!_open) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }

    // When console is open, swallow all events so controllers don't move
    e.stopImmediatePropagation();

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.historyBack();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.historyForward();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.submit();
    }
    // All other typing goes to the input element naturally (it's focused)
  }

  private historyBack(): void {
    if (this.history.length === 0) return;
    this.historyIndex = Math.min(this.historyIndex + 1, this.history.length - 1);
    this.inputEl.value = this.history[this.historyIndex] ?? '';
    // Move cursor to end
    const len = this.inputEl.value.length;
    this.inputEl.setSelectionRange(len, len);
  }

  private historyForward(): void {
    this.historyIndex = Math.max(this.historyIndex - 1, -1);
    this.inputEl.value = this.historyIndex >= 0 ? (this.history[this.historyIndex] ?? '') : '';
  }

  private submit(): void {
    const raw = this.inputEl.value.trim();
    if (!raw) return;

    this.print('input', `> ${raw}`);
    this.history.unshift(raw);
    this.historyIndex = -1;
    this.inputEl.value = '';

    const tokens = raw.split(/\s+/);
    const name = tokens[0].toLowerCase();
    const args = tokens.slice(1);

    const cmd = this.commands.get(name);
    if (!cmd) {
      this.print('error', `Unknown command: "${name}" — type "help" for commands`);
      return;
    }

    try {
      logEvent('engine', `console: ${raw}`);
      const result = cmd.handler(args);
      if (typeof result === 'string' && result.length > 0) {
        this.print('output', result);
      }
    } catch (err) {
      this.print('error', `Error executing "${name}": ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Output
  // ---------------------------------------------------------------------------

  private print(type: ConsoleLine['type'], text: string): void {
    const lines = text.split('\n');
    for (const line of lines) {
      this.lines.push({ text: line, type });
      this.appendLine({ text: line, type });
    }
    // Keep max 500 lines
    while (this.lines.length > 500) {
      this.lines.shift();
      this.outputEl.firstChild?.remove();
    }
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  private appendLine(line: ConsoleLine): void {
    const el = document.createElement('div');
    el.style.cssText = 'margin: 1px 0; word-break: break-all; white-space: pre-wrap;';
    el.style.color = {
      input:  '#88ff88',
      output: '#cccccc',
      error:  '#ff4444',
      system: '#4488ff',
    }[line.type];
    el.textContent = line.text;
    this.outputEl.appendChild(el);
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  private buildDOM(): void {
    this.container = document.createElement('div');
    this.container.id = 'game-console';
    this.container.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 50%;
      background: rgba(0, 0, 0, 0.88);
      border-bottom: 2px solid #33ff33;
      flex-direction: column;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      z-index: 99999;
      box-sizing: border-box;
      pointer-events: all;
    `;

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      background: rgba(0, 40, 0, 0.9);
      border-bottom: 1px solid #226622;
      color: #33ff33;
      font-size: 11px;
      user-select: none;
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <span style="font-weight:bold;letter-spacing:2px;">PS1 ENGINE CONSOLE</span>
      <span style="color:#888;">[ ^ ] toggle &nbsp;·&nbsp; [ESC] close &nbsp;·&nbsp; [↑↓] history</span>
    `;
    this.container.appendChild(header);

    // ── Output area ─────────────────────────────────────────────────────────
    this.outputEl = document.createElement('div');
    this.outputEl.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 6px 10px;
      color: #ccc;
      scrollbar-width: thin;
      scrollbar-color: #33ff33 #111;
    `;
    this.container.appendChild(this.outputEl);

    // ── Input row ───────────────────────────────────────────────────────────
    const inputRow = document.createElement('div');
    inputRow.style.cssText = `
      display: flex;
      align-items: center;
      padding: 4px 10px;
      border-top: 1px solid #226622;
      background: rgba(0, 20, 0, 0.9);
      flex-shrink: 0;
    `;

    this.promptEl = document.createElement('span');
    this.promptEl.textContent = '> ';
    this.promptEl.style.cssText = 'color: #33ff33; margin-right: 4px; user-select: none; font-weight: bold;';
    inputRow.appendChild(this.promptEl);

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.autocomplete = 'off';
    this.inputEl.spellcheck = false;
    this.inputEl.style.cssText = `
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #33ff33;
      font-family: inherit;
      font-size: inherit;
      caret-color: #33ff33;
    `;
    // Prevent keydown from propagating to game handlers when inside input
    this.inputEl.addEventListener('keydown', (e) => {
      if (_open) e.stopPropagation();
    });
    inputRow.appendChild(this.inputEl);

    this.container.appendChild(inputRow);
    document.body.appendChild(this.container);
  }
}

// ---------------------------------------------------------------------------
// Module singleton
// ---------------------------------------------------------------------------

let _instance: GameConsole | null = null;

export function initGameConsole(): GameConsole {
  if (_instance) return _instance;
  _instance = new GameConsole();
  return _instance;
}

export function getGameConsole(): GameConsole | null {
  return _instance;
}

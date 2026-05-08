import { spawn } from 'node:child_process';

const url = 'http://localhost:3000/?autostart=driftbomb_debug&driftBombDebug=1&driftBombAutoTeam=attacker&physicsBackend=rapier&seed=driftbomb-debug-seed-001';

console.log('[debug:driftbomb] Starting local server + client dev runtime...');
console.log(`[debug:driftbomb] Open this URL: ${url}`);
console.log('[debug:driftbomb] Hotkeys: F6 restart, F7 route debug, F8 physics toggle, F9 teleport to bomb, F10 dump snapshot');

const child = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true,
});

const openBrowser = () => {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
    return;
  }
  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true });
    return;
  }
  spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
};

setTimeout(openBrowser, 1200);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

// Avvia server API (con riavvio automatico) e Vite in parallelo.
import { spawn } from 'node:child_process';
const procs = [
  spawn(process.execPath, ['--watch', '--disable-warning=ExperimentalWarning', 'src/server/index.ts'], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite'], { stdio: 'inherit' }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

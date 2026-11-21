// `npm run dev`: local database (if not running), API with reload, and the web app.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalPg } from './pg-local.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { instance } = await startLocalPg();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args) => spawn(npm, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const api = run(['run', 'dev', '-w', 'server']);
const web = run(['run', 'dev', '-w', 'web']);
console.log('\nArka: web on http://localhost:5173, API on http://localhost:4000\n');
const stop = async () => {
  api.kill();
  web.kill();
  if (instance) await instance.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

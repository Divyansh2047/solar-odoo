// Bundle the server (and the shared package it imports as TypeScript) into one ESM file.
// npm dependencies stay external and are installed in the production image.
import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@arka/shared');

rmSync('dist', { recursive: true, force: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
console.log('server bundled to dist/');

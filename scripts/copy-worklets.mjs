/*
 * Copies the audio-thread module graph into public/worklets/, preserving paths:
 *   src/dsp/     → public/worklets/dsp/
 *   src/worklet/ → public/worklets/worklet/
 *   src/workers/ → public/worklets/workers/
 * Worklets and workers then load by plain URL (/worklets/worklet/main.js).
 *
 * Usage: node scripts/copy-worklets.mjs [--watch]
 * Without --watch: replaces public/worklets/ with a fresh copy and exits.
 * With --watch: copies once, then recopies or removes each changed file.
 * Errors go to stderr with a non-zero exit; success prints nothing.
 */
import { cpSync, existsSync, mkdirSync, rmSync, watch } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'worklets');
const SOURCES = ['dsp', 'worklet', 'workers'].map((name) => ({
  src: join(root, 'src', name),
  dest: join(outDir, name),
}));

function copyAll() {
  rmSync(outDir, { recursive: true, force: true });
  for (const { src, dest } of SOURCES) {
    if (existsSync(src)) cpSync(src, dest, { recursive: true });
  }
}

function syncFile(src, dest, file) {
  const from = join(src, file);
  const to = join(dest, file);
  if (existsSync(from)) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  } else {
    rmSync(to, { recursive: true, force: true });
  }
}

function watchAll() {
  for (const { src, dest } of SOURCES) {
    if (!existsSync(src)) continue;
    watch(src, { recursive: true }, (_event, file) => {
      if (!file) return;
      try {
        syncFile(src, dest, file);
      } catch (err) {
        console.error(`copy-worklets: ${relative(root, join(src, file))}: ${err.message}`);
      }
    });
  }
}

try {
  copyAll();
} catch (err) {
  console.error(`copy-worklets: ${err.message}`);
  process.exit(1);
}
if (process.argv.includes('--watch')) watchAll();

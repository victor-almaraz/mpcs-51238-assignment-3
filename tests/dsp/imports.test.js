import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/*
 * Named imports from 'react' are checked against React's exports: a name that
 * belongs to another module (a design-system class string, say) would import
 * as undefined without any lint or build error.
 */

const SRC = new URL('../../src/', import.meta.url).pathname;
const REACT = new Set(Object.keys(await import('react')));

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(js|jsx|mjs)$/.test(name)) yield path;
  }
}

test("every named import from 'react' is a React export", () => {
  const wrong = [];
  for (const path of sources(SRC)) {
    for (const [, names] of readFileSync(path, 'utf8').matchAll(/import \{([^}]*)\} from 'react';/g)) {
      for (const name of names.split(',').map((n) => n.trim()).filter(Boolean)) {
        if (!REACT.has(name)) wrong.push(`${path.slice(SRC.length)}: ${name}`);
      }
    }
  }
  assert.deepEqual(wrong, []);
});

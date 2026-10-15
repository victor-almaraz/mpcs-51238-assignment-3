import { readFileSync } from 'node:fs';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

/*
 * Production builds are a static export to out/. Static export supports neither
 * rewrites nor headers, so vercel.json defines them for the deployment and
 * scripts/serve-out.mjs applies them locally. The development server reads the
 * same vercel.json, so one file defines routing and headers in every mode.
 */
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));

export default function nextConfig(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    return { output: 'export', images: { unoptimized: true } };
  }
  return {
    images: { unoptimized: true },
    rewrites: async () => vercel.rewrites,
    headers: async () => vercel.headers,
  };
}

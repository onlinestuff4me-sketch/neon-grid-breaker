// Collect the shipped files into native/www/ for Capacitor to copy into the
// iOS app bundle.
//
// This exists so `webDir` does not have to point at the repo root — which
// would sweep .git, node_modules and the reference video into the app. It is
// NOT a build step for the game: nothing is compiled, bundled, minified or
// rewritten. The files that land in the bundle are byte-identical to the ones
// the web serves, and the game stays plain ES modules on both.
//
//   node tools/pack-native.mjs
//
import { cp, rm, mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'native', 'www');

// Everything the page actually loads. Keep this list tight: anything not
// here does not ship, which is the point.
const INCLUDE = [
  'index.html',
  'manifest.json',
  'src',
  'lib',
  'assets',
  'icons',
];

// The service worker is deliberately NOT shipped. Inside the app every asset
// is already on the device, so a cache layer buys nothing and can only serve
// something stale after an update. main.js skips registering it on native, so
// this is belt and braces rather than the mechanism.
const EXCLUDE_IN_APP = ['sw.js'];

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let n = 0;
for (const entry of INCLUDE) {
  const from = join(root, entry);
  if (!(await exists(from))) { console.warn('  skip (missing):', entry); continue; }
  await cp(from, join(out, entry), { recursive: true });
  n++;
}

for (const f of EXCLUDE_IN_APP) await rm(join(out, f), { force: true });

console.log(`native/www ready — ${n} entries copied.`);
console.log('Next:  npx cap sync ios   (needs macOS + Xcode + CocoaPods)');

#!/usr/bin/env node
/**
 * Version every asset URL so a deploy actually reaches people.
 *
 * GitHub Pages serves assets with `cache-control: max-age=600` and no
 * fingerprint in the filename. index.html is revalidated, so a deploy changes
 * the markup immediately — but the browser keeps serving the OLD app.js and
 * app.css against it. The result is the worst kind of failure: a page that
 * looks deployed and is running last week's code. It bit twice in one session,
 * both times showing a nav tab whose handler did not exist yet, which rendered
 * as "No tool called shells".
 *
 * There is no build step here and there is not going to be one, so the fix is
 * a content hash in the query string, written into the files that reference
 * them. A changed file gets a new URL, and a new URL cannot be served from
 * cache. An unchanged file keeps its URL and stays cached, which is the point.
 *
 * Order matters and there is no cycle:
 *
 *   1. hash data/**            -> DATA_V inside app.js   (runtime fetches)
 *   2. hash command.js         -> the import inside app.js
 *   3. hash app.js (now final) -> index.html
 *   4. hash app.css            -> index.html
 *
 * `node tools/stamp.mjs` writes. `node tools/stamp.mjs --check` only reports,
 * and exits non-zero if anything is stale — that is what check.mjs calls, so
 * forgetting to stamp fails the commit instead of shipping a stale page.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CHECK = process.argv.includes('--check');
const short = buf => createHash('sha256').update(buf).digest('hex').slice(0, 10);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

/* One hash over every data file, so any data change invalidates every data
   URL. Coarser than per-file, and deliberately: the files are small, they are
   read once per visit, and one number is far harder to get subtly wrong. */
const dataFiles = walk('data');
const dataHash = short(Buffer.concat(
  dataFiles.map(f => Buffer.concat([Buffer.from(f), readFileSync(f)]))));

const stale = [];
function patch(file, re, make, label) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(re, make);
  if (after === before) return;
  stale.push(label);
  if (!CHECK) writeFileSync(file, after);
}

// 1. data version inside app.js
patch('assets/js/app.js', /(var ASSET_V = ')[a-f0-9]*(')/, `$1${dataHash}$2`,
      `data (${dataHash})`);

// 2. command.js, imported by app.js and by the verifier
const cmdHash = short(readFileSync('assets/js/command.js'));
patch('assets/js/app.js', /(from '\.\/command\.js)(?:\?v=[a-f0-9]+)?(')/,
      `$1?v=${cmdHash}$2`, `command.js (${cmdHash})`);

// 3. app.js, now final
const appHash = short(readFileSync('assets/js/app.js'));
patch('index.html', /(src="assets\/js\/app\.js)(?:\?v=[a-f0-9]+)?(")/,
      `$1?v=${appHash}$2`, `app.js (${appHash})`);

// 4. the stylesheet
const cssHash = short(readFileSync('assets/css/app.css'));
patch('index.html', /(href="assets\/css\/app\.css)(?:\?v=[a-f0-9]+)?(")/,
      `$1?v=${cssHash}$2`, `app.css (${cssHash})`);

if (CHECK) {
  if (stale.length) {
    console.error(`  x asset stamps are stale: ${stale.join(', ')} — run node tools/stamp.mjs`);
    process.exit(1);
  }
  console.log('  asset stamps: current');
} else if (stale.length) {
  console.log(`stamp: updated ${stale.join(', ')}`);
} else {
  console.log('stamp: already current');
}

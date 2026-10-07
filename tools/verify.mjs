#!/usr/bin/env node
/**
 * Command verifier.
 *
 * Proves every flag in the data is one the real binary accepts, by running it
 * and checking the tool did not reject the SYNTAX. No packets are sent: the
 * target is a non-routable placeholder and the tool errors on an unknown flag
 * long before it opens a socket.
 *
 * What this proves: the flag exists, is spelled correctly, and takes the kind of
 * value we think it does.
 * What it cannot prove: that the flag does what the description claims. That is
 * a writing problem, not a testing one, and the plan says so.
 *
 *   node tools/verify.mjs ffuf
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const id = process.argv[2];
if (!id) { console.error('usage: verify.mjs <toolId>'); process.exit(2); }

const path = `data/tools/${id}.json`;
if (!existsSync(path)) { console.error(`no such tool file: ${path}`); process.exit(2); }
const t = JSON.parse(readFileSync(path, 'utf8'));

const bin = t.id;
try { execFileSync('which', [bin], { stdio: 'pipe' }); }
catch { console.error(`${bin} is not installed locally. Container path (P2) not wired yet.`); process.exit(2); }

/* Placeholder values by type. Deliberately non-routable and non-existent: the
   point is to reach the argument parser, never the network. */
const SAMPLE = {
  none:   null,
  string: 'x',
  int:    '1',
  path:   '/dev/null',
  url:    'http://127.0.0.1:1/FUZZ',
  port:   '80',
  host:   '127.0.0.1',
  enum:   null,
};

/* An unknown-flag rejection looks like this. Anything else (a connection error,
   a usage dump triggered by missing required args) is not our concern here. */
const REJECT = /flag provided but not defined|unknown (?:flag|option|shorthand)|unrecognized option|invalid option|not defined:/i;

const required = t.flags.filter(f => f.required);
function baseArgs(exclude) {
  const out = [];
  for (const f of required) {
    if (exclude && f.id === exclude) continue;
    out.push(f.short || f.long);
    if (f.takes !== 'none') out.push(f.takes === 'enum' ? (f.enum[0] ?? 'x') : SAMPLE[f.takes]);
  }
  return out;
}

let pass = 0;
const bad = [];

for (const f of t.flags) {
  const token = f.short || f.long;
  const args = baseArgs(f.id);
  args.push(token);
  if (f.takes !== 'none') {
    const v = f.takes === 'enum' ? (f.enum[0] ?? 'x') : SAMPLE[f.takes];
    if (v !== null) args.push(v);
  }

  let out = '';
  try {
    out = execFileSync(bin, args, { stdio: 'pipe', timeout: 4000, encoding: 'utf8' });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }

  if (REJECT.test(out)) {
    bad.push({ flag: token, why: (out.match(REJECT) ? out.split('\n').find(l => REJECT.test(l)) : '').trim() });
  } else {
    pass++;
  }
}

console.log(`\nverify ${bin} ${t.provenance.toolVersion}: ${pass}/${t.flags.length} flags accepted`);
if (bad.length) {
  console.error(`\nREJECTED — ${bad.length}:`);
  bad.forEach(b => console.error(`  x ${b.flag.padEnd(16)} ${b.why}`));
  process.exit(1);
}
console.log('all flags accepted by the real binary.');

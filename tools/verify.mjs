#!/usr/bin/env node
/**
 * Command verifier.
 *
 * Builds commands through assets/js/command.js — the exact module the browser
 * uses — then runs each one and asserts the tool did not reject the SYNTAX.
 * Because it imports the real builder, a command proved here is byte-for-byte
 * the command a user copies.
 *
 * No packets are sent. Targets are non-routable and every tool errors on a bad
 * flag long before it opens a socket.
 *
 * Three passes:
 *   1. each flag alone, with a value of the right type
 *   2. every valid PAIR of flags, to catch combinations the UI permits
 *   3. awkward values — spaces, quotes, $, backslashes
 *
 *   node tools/verify.mjs ffuf [--pairs]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync as _mkdtemp } from 'node:fs';
import { tmpdir as _tmpdir } from 'node:os';
import { join as _join } from 'node:path';

/* Probes run in a scratch directory, never the repo.
   Several flags write files relative to the CURRENT directory, so verifying
   "-o 'a b'" created a file literally named `a b` in the working tree — and an
   earlier run committed a 195KB ffuf audit log called `x`. The tool under test
   decides where it writes; the only reliable fix is to not be standing in the
   repo when it runs. */
const PROBE_DIR = _mkdtemp(_join(_tmpdir(), 'commander-probe-'));
import { buildCommand, blockedBy } from '../assets/js/command.js';

const id = process.argv[2];
const doPairs = process.argv.includes('--pairs');
if (!id) { console.error('usage: verify.mjs <toolId> [--pairs]'); process.exit(2); }

const path = `data/tools/${id}.json`;
if (!existsSync(path)) { console.error(`no such tool: ${path}`); process.exit(2); }
const tool = JSON.parse(readFileSync(path, 'utf8'));

try { execFileSync('which', [tool.id], { stdio: 'pipe' }); }
catch { console.error(`${tool.id} is not installed locally; container path (P2) not wired yet.`); process.exit(2); }

const SAMPLE = {
  none: null, string: 'x', int: '1', path: '/dev/null',
  url: 'http://127.0.0.1:1/FUZZ', port: '80', host: '127.0.0.1', enum: null,
};
const AWKWARD = ['a b', "it's", 'a$b', 'a\\b', 'a"b', 'a;b'];

/* A rejection of the SYNTAX. A connection error or a usage dump from missing
   required args is not a failure of our data. */
const REJECT = /flag provided but not defined|unknown (?:flag|option|shorthand)|unrecognized option|invalid option|not defined:/i;

function valueFor(f) {
  if (f.takes === 'none') return null;
  if (f.takes === 'enum') return (f.enum && f.enum[0]) || 'x';
  return SAMPLE[f.takes] ?? 'x';
}

function slotsAndAdhoc(flags, override) {
  const slots = {}, adhoc = {};
  for (const f of flags) {
    const v = override !== undefined && f.takes === 'path' ? override : valueFor(f);
    if (v === null) continue;
    if (f.binds) slots[f.binds] = v; else adhoc[f.id] = v;
  }
  return { slots, adhoc };
}

/* Flags with a side effect beyond this process. Verifying that nmap ACCEPTS
   --script-updatedb does not require letting it rewrite the installed script
   database, so these are checked for membership by probe-nmap.mjs and skipped
   here. */
const SIDE_EFFECTS = new Set(['script-updatedb']);

/* A placeholder is not a value. buildCommand emits "<Target>" when a required
   input is empty, and for nmap that string would be passed as a hostname — it
   would be resolved, and anything that resolved would be SCANNED. The verifier
   strips every placeholder before running, which for nmap leaves a command with
   no target at all: nmap then parses every flag and reports "No targets were
   specified, so 0 hosts scanned". That is the whole point — flag acceptance is
   provable with no target, no privileges and no packets. */
const PLACEHOLDER = /^<.+>$/;

function stripPlaceholders(argv) {
  return argv.filter(a => !PLACEHOLDER.test(a));
}

function run(argv) {
  const safe = stripPlaceholders(argv);
  try { return execFileSync(tool.id, safe, { stdio: 'pipe', timeout: 15000, encoding: 'utf8', cwd: PROBE_DIR }); }
  catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; }
}

const required = tool.flags.filter(f => f.required);
const bad = [];
let ran = 0;

function check(label, picked, override) {
  const flags = tool.flags.filter(f => picked[f.id]);
  const { slots, adhoc } = slotsAndAdhoc(flags, override);
  const built = buildCommand(tool, tool.modes[0].id, picked, slots, adhoc);
  const out = run(built.argv);
  ran++;
  if (REJECT.test(out)) {
    const line = out.split('\n').find(l => REJECT.test(l)) || '';
    bad.push({ label, cmd: built.text, why: line.trim() });
  }
}

/* pass 1 — each flag alone, alongside whatever is required */
let skipped = 0;
for (const f of tool.flags) {
  if (SIDE_EFFECTS.has(f.id)) { skipped++; continue; }
  const picked = {};
  required.forEach(r => { picked[r.id] = true; });
  picked[f.id] = true;
  check(f.short || f.long, picked);
}
const afterSingles = bad.length;

/* pass 3 — awkward values on every flag that takes a path */
for (const f of tool.flags.filter(f => f.takes === 'path' && !SIDE_EFFECTS.has(f.id))) {
  for (const v of AWKWARD) {
    const picked = {};
    required.forEach(r => { picked[r.id] = true; });
    picked[f.id] = true;
    check(`${f.short || f.long} = ${JSON.stringify(v)}`, picked, v);
  }
}
const afterAwkward = bad.length;

/* pass 2 — every valid pair the UI would allow */
let pairs = 0;
if (doPairs) {
  const list = tool.flags;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const picked = {};
      required.forEach(r => { picked[r.id] = true; });
      picked[a.id] = true;
      if (blockedBy(tool, picked, b)) continue;   // the UI would not permit it
      picked[b.id] = true;
      check(`${a.short || a.long} + ${b.short || b.long}`, picked);
      pairs++;
    }
  }
}

console.log(`\nverify ${tool.id} ${tool.provenance.toolVersion}`);
console.log(`  singles   ${tool.flags.length}  (${afterSingles} rejected)`);
console.log(`  awkward   ${tool.flags.filter(f => f.takes === 'path').length * AWKWARD.length}  (${afterAwkward - afterSingles} rejected)`);
if (doPairs) console.log(`  pairs     ${pairs}  (${bad.length - afterAwkward} rejected)`);
console.log(`  commands run: ${ran}`);

if (bad.length) {
  console.error(`\nREJECTED — ${bad.length}:`);
  bad.slice(0, 25).forEach(b => console.error(`  x ${b.label}\n      ${b.cmd}\n      ${b.why}`));
  if (bad.length > 25) console.error(`  ... and ${bad.length - 25} more`);
  process.exit(1);
}
console.log('\nevery generated command was accepted by the real binary.');

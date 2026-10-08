#!/usr/bin/env node
/**
 * Enum values, against the real binary.
 *
 * An enum is a promise: these values are legal, anything else is not. The data
 * says so because the tool's help text says so, which is one remove from the
 * code that parses it. So ask the binary directly — every declared value must
 * be accepted, and a value that is NOT in the list must be rejected. A set that
 * accepts everything is not a set, and would mean the extractor read prose that
 * was never a closed list.
 */
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
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommand } from '../assets/js/command.js';

/* Pull in whatever a flag requires, transitively. Without this the probe never
   reaches the tool's validation path: ffuf ignores -of unless -o is also set,
   so a bogus format looked "accepted" when it was simply never read. */
function withRequires(tool, ids) {
  const picked = {};
  const queue = [...ids];
  while (queue.length) {
    const id = queue.pop();
    if (picked[id]) continue;
    picked[id] = true;
    const f = tool.flags.find(x => x.id === id);
    (f?.requires || []).forEach(r => queue.push(r));
  }
  return picked;
}

const REJECT = /flag provided but not defined|unknown (?:flag|option|shorthand)|unrecognized option|invalid option|not defined:/i;
const SENTINEL = 'commander-not-a-real-value';

/* The sentinel has to be the right SHAPE or the test proves nothing.
   For an int-typed flag a text sentinel is rejected for being text, not for
   being outside the set, so "--level 1-5" looked closed even though nothing
   had checked the range. A numeric set gets a number outside it. */
function sentinelFor(f) {
  const numeric = f.enum.every(v => /^-?\d+$/.test(v));
  if (!numeric) return SENTINEL;
  const max = Math.max(...f.enum.map(Number));
  return String(max + 9999);
}

/* Probe output goes to a scratch dir, never the workspace and never a name that
   could collide with something real. */
const SCRATCH = mkdtempSync(join(tmpdir(), 'commander-enums-'));
let seq = 0;
const scratchFile = () => join(SCRATCH, `probe-${++seq}`);

function run(name, argv) {
  try {
    const out = execFileSync(name, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, cwd: PROBE_DIR });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let accepted = 0, rejectedBad = 0;
const fail = [];

for (const file of readdirSync('data/tools').filter(f => f.endsWith('.json'))) {
  const tool = JSON.parse(readFileSync(`data/tools/${file}`, 'utf8'));
  if (!run(tool.name, ['-V']).out && !run(tool.name, ['-h']).out) {
    console.log(`  skip ${tool.id} — binary not on this host`);
    continue;
  }
  const enums = tool.flags.filter(f => f.takes === 'enum');
  console.log(`\n${tool.id} ${tool.provenance.toolVersion} — ${enums.length} enum flag(s)`);

  for (const f of enums) {
    /* Every declared value must be accepted. */
    for (const v of f.enum) {
      const slots = {}; const adhoc = {};
      const picked = withRequires(tool, [...tool.flags.filter(x => x.required).map(x => x.id), f.id]);
      for (const pf of tool.flags.filter(x => picked[x.id] && x.takes !== 'none')) {
        const val = pf.id === f.id ? v
          : pf.takes === 'url' ? 'http://127.0.0.1:1/FUZZ'
          : pf.id === 'o' ? scratchFile()
          : '/dev/null';
        if (pf.binds) slots[pf.binds] = val; else adhoc[pf.id] = val;
      }
      const built = buildCommand(tool, tool.modes[0].id, picked, slots, adhoc);
      const r = run(tool.name, built.argv);
      if (REJECT.test(r.out)) fail.push(`${tool.id} ${f.short}=${v}: REJECTED a declared value\n      ${r.out.split('\n').find(l => REJECT.test(l))}`);
      else accepted++;
    }

    /* A value outside the list must NOT be accepted. */
    const slots = {}; const adhoc = {};
    const picked = withRequires(tool, [...tool.flags.filter(x => x.required).map(x => x.id), f.id]);
    for (const pf of tool.flags.filter(x => picked[x.id] && x.takes !== 'none')) {
      const val = pf.id === f.id ? sentinelFor(f)
        : pf.takes === 'url' ? 'http://127.0.0.1:1/FUZZ'
        : pf.id === 'o' ? scratchFile()
        : '/dev/null';
      if (pf.binds) slots[pf.binds] = val; else adhoc[pf.id] = val;
    }
    const built = buildCommand(tool, tool.modes[0].id, picked, slots, adhoc);
    const r = run(tool.name, built.argv);
    /* Different tools word a rejection differently, and the first version of
       this list was too narrow: sqlmap says "[CRITICAL] value for option
       '--level' must be an integer value from range [1, 5]", which matched
       none of it, so four genuinely closed sets were reported as open.

       The complaint must also NAME the flag or the value. Any long run prints
       the word "error" somewhere eventually, and a test that accepts that as
       proof is not proving anything. */
    const clean = r.out.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '');
    const sent = sentinelFor(f);
    const complained = /invalid|unknown|unsupported|not a valid|not recognis|not recogniz|unrecognis|unrecogniz|must be|accepts one of|out of range|bad value|\[critical\]/i.test(clean)
      && (clean.includes(f.short) || (f.long && clean.includes(f.long)) || clean.includes(sent));
    if (complained) { rejectedBad++; console.log(`  ok  ${f.short.padEnd(18)} ${f.enum.join(', ')}`); }
    else fail.push(`${tool.id} ${f.short}: accepted "${sentinelFor(f)}" — the declared set is not actually closed, so enum is the wrong type for this flag`);
  }
}

console.log(`\nenums: ${accepted} declared value(s) accepted, ${rejectedBad} set(s) proved closed, ${fail.length} failed`);
if (fail.length) { console.error('\nFAILURES:'); fail.forEach(f => console.error('  x ' + f)); process.exit(1); }

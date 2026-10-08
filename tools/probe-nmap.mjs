#!/usr/bin/env node
/**
 * The binary decides.
 *
 * Neither nmap document is authoritative. The man page's prose mentions `-oG-`
 * and `-d9` as examples of USAGE, and a parser cannot tell those from options.
 * The help packs real flags into forms like `-PS/PA/PU/PY` that are easy to
 * misread. So every extracted candidate is put to nmap itself and kept only if
 * nmap accepts it.
 *
 * This is safe and needs no privileges, because of two things nmap does:
 *
 *   1. It parses EVERY argument before it checks privilege. `nmap -sS --bogus`
 *      reports the bogus flag, not the privilege problem. So "requires root
 *      privileges" is PROOF the flag parsed, not a failure.
 *   2. With no target it scans nothing: "No targets were specified, so 0 hosts
 *      scanned". No packets leave the machine.
 *
 * nmap also tells us when a flag needs a value ("option `--mtu' requires an
 * argument"), so the probe corrects `takes` as well as membership.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILE = 'data/tools/nmap.json';
const PROBE_DIR = mkdtempSync(join(tmpdir(), 'commander-nmap-'));
const apply = !process.argv.includes('--dry-run');

/* nmap says this when a token is not an option at all. */
const NOT_A_FLAG = /unrecognized option|deprecated option in a dangerous way/i;
/* nmap says this when the option is real but wants a value. */
const NEEDS_VALUE = /option [`'"]?-{1,2}[^'"`\s]+['"`]? requires an argument/i;

function run(argv) {
  try {
    return execFileSync('nmap', argv, { encoding: 'utf8', stdio: 'pipe', timeout: 15000, cwd: PROBE_DIR });
  } catch (e) {
    return String(e.stdout || '') + String(e.stderr || '');
  }
}

const SAMPLE = {
  none: null, string: 'x', int: '1', port: '80', path: '/dev/null',
  host: '127.0.0.1', url: 'http://127.0.0.1:1/', enum: null,
};

const tool = JSON.parse(readFileSync(FILE, 'utf8'));
const dropped = [], retyped = [], kept = [];

for (const f of tool.flags) {
  const tok = f.short || f.long;

  /* Ask bare first: that distinguishes "not a flag" from "needs a value". */
  const bare = run([tok]);
  if (NOT_A_FLAG.test(bare)) { dropped.push({ tok, why: bare.split('\n').find(l => NOT_A_FLAG.test(l)).trim() }); continue; }

  if (NEEDS_VALUE.test(bare)) {
    /* Real flag, and it needs a value. Confirm our type produces an accepted
       command; if we had said it takes nothing, the data was wrong. */
    if (f.takes === 'none') {
      /* nmap only says "it needs a value", not which kind. The man entry has no
         argument name for these (that is why they were typed as taking none),
         so read the description: "the maximum number of OS detection tries"
         is plainly a count, and typing it as free text would be a worse guess
         than the one the sentence supports. */
      const d = (f.desc || '').toLowerCase();
      const to = /number|count|tries|times|seconds|\bms\b|level|size|limit|rate/.test(d) ? 'int'
        : /file|path|directory/.test(d) ? 'path'
        : /host|address|interface/.test(d) ? 'host'
        : 'string';
      f.takes = to;
      retyped.push({ tok, from: 'none', to, why: 'nmap: requires an argument' });
    }
    const withVal = run([tok, SAMPLE[f.takes] ?? 'x']);
    if (NOT_A_FLAG.test(withVal)) { dropped.push({ tok, why: 'rejected once given a value' }); continue; }
    kept.push(tok);
    continue;
  }

  /* Accepted bare. If we claimed it needs a value, nmap disagrees only when a
     value is not optional — and nmap accepts optional-value flags bare, so this
     is not an error on its own. Leave the type alone and record acceptance. */
  kept.push(tok);
}

tool.flags = tool.flags.filter(f => !dropped.some(d => d.tok === (f.short || f.long)));
tool.provenance.verifiedAt = new Date().toISOString().slice(0, 10);

console.log(`probe-nmap: ${kept.length} accepted, ${dropped.length} dropped, ${retyped.length} retyped`);
if (dropped.length) { console.log('\ndropped — nmap does not accept these:'); dropped.forEach(d => console.log(`  - ${d.tok.padEnd(22)} ${d.why}`)); }
if (retyped.length) { console.log('\nretyped — nmap says they need a value:'); retyped.forEach(r => console.log(`  ~ ${r.tok.padEnd(22)} ${r.from} -> ${r.to}`)); }

if (apply) { writeFileSync(FILE, JSON.stringify(tool, null, 2) + '\n'); console.log(`\nwrote ${FILE} (${tool.flags.length} flags)`); }
else console.log('\n--dry-run: nothing written');

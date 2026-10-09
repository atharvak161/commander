#!/usr/bin/env node
/**
 * Flags you are allowed to give more than once.
 *
 * ffuf's -H and gobuster's --headers are the everyday case: two or three
 * headers in one command is ordinary. The data marked six flags repeatable and
 * the interface offered a single box, so the second and third values were
 * silently dropped — the command looked fine and sent one header.
 *
 * Here: three values go in, three flag-value pairs must come out, in order,
 * the text must survive a shell unchanged, and the real binary must accept it.
 */
import { execFile } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommand, resolveFlag } from '../assets/js/command.js';

const PROBE_DIR = mkdtempSync(join(tmpdir(), 'commander-repeat-'));
const REJECT = /flag provided but not defined|unknown (?:flag|option|shorthand)|unrecognized option|no such option|invalid option|not defined:/i;

function shellSplit(text) {
  const script = `set -- ${text}\nfor a in "$@"; do printf '%s\\0' "$a"; done`;
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'buffer', timeout: 5000 });
  const parts = out.toString('utf8').split('\0');
  parts.pop();
  return parts;
}

function run(cmd, argv) {
/* stdin on 'ignore', always. A tool that reads stdin when it has no target —
   sqlmap does — blocks on an open pipe until the timeout, and a timed-out probe
   matches no rejection pattern, so it would be counted as a pass for a command
   that never ran. */
  try { return execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, encoding: 'utf8', cwd: PROBE_DIR }); }
  catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; }
}

/* Deliberately awkward: a space, a colon, a quote and a dollar, because a
   header value is exactly where those turn up. */
const VALUES = ['X-One: a b', "X-Two: it's", 'X-Three: $HOME'];

let pass = 0;
const fail = [];

for (const file of readdirSync('data/tools').filter(f => f.endsWith('.json'))) {
  const tool = JSON.parse(readFileSync(`data/tools/${file}`, 'utf8'));
  const installed = (() => { try { execFileSync('which', [tool.id], { stdio: 'pipe' }); return true; } catch { return false; } })();

  for (const mode of tool.modes) {
    for (const raw of tool.flags.filter(f => f.repeatable && mode.flags.includes(f.id))) {
      const f = resolveFlag(raw, mode.id);
      const tok = f.short || f.long;

      const picked = {};
      tool.flags.filter(x => x.required && mode.flags.includes(x.id)).forEach(r => { picked[r.id] = true; });
      picked[f.id] = true;

      const slots = {}, adhoc = {};
      for (const pf of tool.flags.filter(x => picked[x.id] && mode.flags.includes(x.id)).map(x => resolveFlag(x, mode.id))) {
        if (pf.takes === 'none') continue;
        const v = pf.id === f.id ? VALUES.join('\n')
          : pf.takes === 'url' ? 'http://127.0.0.1:1/FUZZ'
          : pf.takes === 'path' ? '/dev/null' : '1';
        if (pf.binds) slots[pf.binds] = v; else adhoc[pf.id] = v;
      }

      const built = buildCommand(tool, mode.id, picked, slots, adhoc);
      const where = `${tool.id}/${mode.id} ${tok}`;

      /* 1. the flag appears once per value, each followed by its own value */
      const got = [];
      for (let i = 0; i < built.argv.length; i++) if (built.argv[i] === tok) got.push(built.argv[i + 1]);
      if (got.length !== VALUES.length || got.some((g, i) => g !== VALUES[i])) {
        fail.push(`${where}: expected ${VALUES.length} values in order, got ${JSON.stringify(got)}`);
      } else pass++;

      /* 2. the text a user copies still parses to exactly that */
      const split = shellSplit(built.text);
      const want = [tool.name, ...built.argv];
      if (split.length !== want.length || split.some((g, i) => g !== want[i])) {
        fail.push(`${where}: repeated text does not round-trip\n      ${built.text}`);
      } else pass++;

      /* 3. the binary accepts it */
      if (installed) {
        const out = run(tool.name, built.argv.filter(a => !/^<.+>$/.test(a)));
        if (REJECT.test(out)) fail.push(`${where}: binary rejected the repeated form — ${out.split('\n').find(l => REJECT.test(l))}`);
        else pass++;
      }
    }
  }
}

console.log(`\nrepeatable: ${pass} assertion(s) passed, ${fail.length} failed`);
if (fail.length) { console.error('\nFAILURES:'); fail.forEach(f => console.error('  x ' + f)); process.exit(1); }
console.log('every repeatable flag emits one occurrence per value, in order, and the binary takes it.');

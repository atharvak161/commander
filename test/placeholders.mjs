#!/usr/bin/env node
/**
 * A flag awaiting a value must never emit a bare token.
 *
 * The bug: with -u and -w picked but empty, the command read "ffuf -u -w" and
 * ffuf parses -w as the VALUE of -u. It looks assembled, it is wrong, and it
 * fails in a way that does not point at the cause. Every valued flag must be
 * followed by something that is not another flag, and the text must still
 * survive a shell as the same arguments.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { buildCommand, resolveFlag } from '../assets/js/command.js';

function shellSplit(text) {
  const script = `set -- ${text}\nfor a in "$@"; do printf '%s\\0' "$a"; done`;
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'buffer', timeout: 5000 });
  const parts = out.toString('utf8').split('\0');
  parts.pop();
  return parts;
}

let pass = 0;
const fail = [];

for (const file of readdirSync('data/tools').filter(f => f.endsWith('.json'))) {
  const tool = JSON.parse(readFileSync(`data/tools/${file}`, 'utf8'));
  const tokens = new Set(tool.flags.map(f => f.short || f.long));

  for (const mode of tool.modes) {
    /* Only flags this mode actually has. Iterating every flag in every mode
       asked gobuster's `dir` about `--resolver`, which belongs to `dns`;
       buildCommand rightly drops it, nothing is emitted, and the assertion
       "a missing value raises an error" failed against a command that never
       contained the flag. The test was wrong, not the data. */
    const inMode = new Set(mode.flags);
    for (const f of tool.flags.filter(x => inMode.has(x.id))) {
      /* Deliberately pick the flag and supply NOTHING. */
      const picked = {};
      tool.flags.filter(x => x.required).forEach(r => { picked[r.id] = true; });
      picked[f.id] = true;
      const built = buildCommand(tool, mode.id, picked, {}, {});

      /* No valued flag may be followed by another flag token. */
      for (let i = 0; i < built.argv.length; i++) {
        const t = built.argv[i];
        /* Resolved for THIS mode. docker's --pull takes a value in run and
           none in build; reading the raw flag reported a correct command as
           missing a value. */
        const rawDef = tool.flags.find(x => (x.short || x.long) === t);
        const def = rawDef ? resolveFlag(rawDef, mode.id) : null;
        if (!def || def.takes === 'none') continue;
        const next = built.argv[i + 1];
        if (next === undefined) {
          fail.push(`${tool.id}/${mode.id} picking ${f.id}: "${t}" ends the command with no value`);
        } else if (tokens.has(next)) {
          fail.push(`${tool.id}/${mode.id} picking ${f.id}: "${t} ${next}" — ${next} is a flag, so ${t} would swallow it\n      ${built.text}`);
        } else pass++;
      }

      /* An incomplete command must still be one the shell reads as we built it. */
      const got = shellSplit(built.text);
      const want = [tool.name, ...built.argv];
      if (got.length !== want.length || got.some((g, i) => g !== want[i])) {
        fail.push(`${tool.id}/${mode.id} picking ${f.id}: incomplete text does not round-trip\n      text  ${built.text}\n      shell ${JSON.stringify(got)}\n      argv  ${JSON.stringify(want)}`);
      } else pass++;

      /* And it must be reported as an error, not offered as ready. */
      /* Resolved here too: docker's --pull takes no value in build, so no
         complaint is the correct behaviour. */
      if (resolveFlag(f, mode.id).takes !== 'none' && !built.issues.some(i => i.err)) {
        fail.push(`${tool.id}/${mode.id} picking ${f.id}: no value given but no error raised`);
      }
    }
  }
}

console.log(`\nplaceholders: ${pass} assertion(s) passed, ${fail.length} failed`);
if (fail.length) { console.error('\nFAILURES:'); fail.slice(0, 15).forEach(f => console.error('  x ' + f)); process.exit(1); }
console.log('no flag can swallow the one after it, and every gap is reported.');

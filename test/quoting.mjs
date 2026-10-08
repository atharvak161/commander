#!/usr/bin/env node
/**
 * Quoting round-trip.
 *
 * THE critical correctness test. The verifier runs argv (an array — no shell
 * parses it). The user copies TEXT (a string a shell does parse). If quoting is
 * wrong those two differ, and the command that was proved valid is not the
 * command that runs.
 *
 * Here: build the text, let a real shell split it, and assert the result equals
 * the argv we tested. Anything else is a silent wrong-command bug.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { buildCommand, shellQuote, resolveFlag } from '../assets/js/command.js';

/* Hostile values, deliberately. Each has broken a hand-rolled quoter somewhere. */
const VALUES = [
  'plain',
  'has space',
  "it's",
  'a$b', '$HOME', '${HOME}',
  'a`b`c',
  'a"b',
  'a\\b',
  'a;rm -rf /',          // injection shape: must stay ONE argument
  'a|b', 'a&b', 'a>b', 'a<b',
  'a*b', 'a?b', 'a[b]',
  'a#b', 'a!b', 'a~b',
  'a\tb',
  '(paren)', '{brace}',
  '/path/with spaces/word list.txt',
  'héllo-ünicode',
  '--looks-like-a-flag',
  '',
];

function shellSplit(text) {
  /* Hand the text to sh EXACTLY as a terminal would: parsed once, as a command
     line. The first version of this wrapped it in eval "..." — double quotes,
     so the shell expanded $b and `b` BEFORE eval saw them and a correctly
     quoted value looked broken. Never re-quote the thing under test. */
  const script = `set -- ${text}\nfor a in "$@"; do printf '%s\\0' "$a"; done`;
  const out = execFileSync('/bin/sh', ['-c', script], { encoding: 'buffer', timeout: 5000 });
  const parts = out.toString('utf8').split('\0');
  parts.pop();
  return parts;
}

let pass = 0;
const fail = [];

/* 1. shellQuote alone: quote a value, let the shell read it back. */
for (const v of VALUES) {
  const quoted = shellQuote(v);
  if (quoted === '' || quoted == null) { pass++; continue; }
  let got;
  try { got = shellSplit(quoted); }
  catch (e) { fail.push({ v, why: 'shell could not parse: ' + e.message }); continue; }
  if (got.length !== 1) fail.push({ v, why: `became ${got.length} arguments, not 1: ${JSON.stringify(got)}` });
  else if (got[0] !== v) fail.push({ v, why: `round-tripped to ${JSON.stringify(got[0])}` });
  else pass++;
}

/* 2. Whole generated commands: text parsed by a shell must equal argv. */
const files = readdirSync('data/tools').filter(f => f.endsWith('.json'));
for (const file of files) {
  const tool = JSON.parse(readFileSync(`data/tools/${file}`, 'utf8'));
  /* Every mode, not just the first. A flag can take a different kind of value
     per mode, and for a seven-mode tool like gobuster testing only modes[0]
     leaves six untested. */
  for (const mode of tool.modes) {
  const inMode = new Set(mode.flags);
  const valued = tool.flags.filter(f => f.takes !== 'none' && inMode.has(f.id));

  for (const f of valued) {
    for (const v of VALUES) {
      if (v === '') continue;                       // empty means "not filled in"
      const picked = {};
      tool.flags.filter(x => x.required).forEach(r => { picked[r.id] = true; });
      picked[f.id] = true;

      const slots = {}, adhoc = {};
      for (const pf of tool.flags.filter(x => picked[x.id] && inMode.has(x.id)).map(x => resolveFlag(x, mode.id)).filter(x => x.takes !== 'none')) {
        if (pf.binds) slots[pf.binds] = v; else adhoc[pf.id] = v;
      }

      const built = buildCommand(tool, mode.id, picked, slots, adhoc);
      let got;
      try { got = shellSplit(built.text); }
      catch (e) { fail.push({ v, why: `${tool.id} ${f.short}: shell rejected the text — ${e.message}` }); continue; }

      const want = [tool.name, ...built.argv];
      if (got.length !== want.length || got.some((g, i) => g !== want[i])) {
        fail.push({
          v,
          why: `${tool.id} ${f.short || f.long}: text and argv disagree\n      text  ${built.text}\n      shell ${JSON.stringify(got)}\n      argv  ${JSON.stringify(want)}`,
        });
      } else pass++;
    }
  }
  }
}

console.log(`\nquoting round-trip: ${pass} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('\nFAILURES:');
  fail.slice(0, 20).forEach(f => console.error(`  x ${JSON.stringify(f.v)}\n      ${f.why}`));
  if (fail.length > 20) console.error(`  ... and ${fail.length - 20} more`);
  process.exit(1);
}
console.log('every value survives the shell unchanged, and text matches argv.');

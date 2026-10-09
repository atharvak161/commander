#!/usr/bin/env node
/**
 * Conflicts and requirements, as the UI enforces them.
 *
 * The data says ffuf's -w clashes with -input-cmd and gobuster's --interface
 * clashes with --local-ip. check.mjs proves those statements are well-formed
 * and symmetric. Nothing proved the INTERFACE acts on them — that picking one
 * actually disables the other, and more importantly that it disables NOTHING
 * ELSE. A blocker that is too eager is worse than none: it silently removes
 * valid commands and the user has no way to know why.
 *
 * So: every declared conflict must block, in both directions, in every mode
 * that has both flags. Every other pair must stay free. And a flag whose
 * requirement is unmet must say so.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { buildCommand, blockedBy, resolveFlag } from '../assets/js/command.js';

let pass = 0;
const fail = [];

for (const file of readdirSync('data/tools').filter(f => f.endsWith('.json'))) {
  const tool = JSON.parse(readFileSync(`data/tools/${file}`, 'utf8'));

  for (const mode of tool.modes) {
    const inMode = tool.flags.filter(f => mode.flags.includes(f.id));
    const declared = new Set();
    for (const f of inMode) for (const c of f.conflicts || []) declared.add([f.id, c].sort().join('|'));

    /* 1. Every declared conflict blocks, both ways. */
    for (const key of declared) {
      const [a, b] = key.split('|');
      const fa = inMode.find(f => f.id === a), fb = inMode.find(f => f.id === b);
      if (!fa || !fb) continue;                 // the pair is not both in this mode
      if (!blockedBy(tool, { [a]: true }, fb)) fail.push(`${tool.id}/${mode.id}: ${fa.short} is picked but ${fb.short} is not blocked`);
      else pass++;
      if (!blockedBy(tool, { [b]: true }, fa)) fail.push(`${tool.id}/${mode.id}: ${fb.short} is picked but ${fa.short} is not blocked`);
      else pass++;
    }

    /* 2. Nothing else blocks. This is the half that catches an over-eager rule. */
    for (let i = 0; i < inMode.length; i++) {
      for (let j = i + 1; j < inMode.length; j++) {
        const a = inMode[i], b = inMode[j];
        if (declared.has([a.id, b.id].sort().join('|'))) continue;
        if (blockedBy(tool, { [a.id]: true }, b)) {
          fail.push(`${tool.id}/${mode.id}: ${a.short} blocks ${b.short}, but no conflict is declared between them`);
        } else pass++;
      }
    }

    /* 3. An unmet requirement is reported, and a met one is not. */
    for (const raw of inMode) {
      const f = resolveFlag(raw, mode.id);
      for (const r of f.requires || []) {
        const other = tool.flags.find(x => x.id === r);
        if (!other || !mode.flags.includes(r)) continue;

        const alone = buildCommand(tool, mode.id, { [f.id]: true }, {}, {});
        const mentions = alone.issues.some(i => i.text.includes(other.short || other.long));
        if (!mentions) fail.push(`${tool.id}/${mode.id}: ${f.short} requires ${other.short} but picking it alone says nothing`);
        else pass++;

        const both = buildCommand(tool, mode.id, { [f.id]: true, [r]: true }, {}, {});
        const stillAsks = both.issues.some(i => i.text === `${f.short || f.long} needs ${other.short || other.long}.`);
        if (stillAsks) fail.push(`${tool.id}/${mode.id}: ${f.short} still asks for ${other.short} after it is picked`);
        else pass++;
      }
    }
  }
}

/* 4. "At least one of these": with none picked the group must complain once,
      and ANY single member must satisfy it. The second half is what matters —
      ffuf accepts -request in place of -u, and a builder that still demanded
      -u was arguing with a working command. */
for (const file of readdirSync('data/tools').filter(f => f.endsWith('.json'))) {
  const tool = JSON.parse(readFileSync(`data/tools/${file}`, 'utf8'));
  for (const mode of tool.modes) {
    for (const group of tool.requiresOneOf || []) {
      const members = group.ids.filter(id => mode.flags.includes(id));
      if (!members.length) continue;

      const none = buildCommand(tool, mode.id, {}, {}, {});
      const asks = none.issues.filter(i => i.err && /needs one of/.test(i.text) && i.text.includes(group.label));
      if (asks.length !== 1) fail.push(`${tool.id}/${mode.id}: group "${group.label}" raised ${asks.length} messages with nothing picked, expected 1`);
      else pass++;

      for (const id of members) {
        const one = buildCommand(tool, mode.id, { [id]: true }, {}, {});
        const still = one.issues.some(i => i.err && /needs one of/.test(i.text) && i.text.includes(group.label));
        const f = tool.flags.find(x => x.id === id);
        if (still) fail.push(`${tool.id}/${mode.id}: ${f.short} satisfies "${group.label}" but the demand remains`);
        else pass++;
      }
    }
  }
}

console.log(`\nrelationships: ${pass} assertion(s) passed, ${fail.length} failed`);
if (fail.length) { console.error('\nFAILURES:'); fail.slice(0, 20).forEach(f => console.error('  x ' + f)); process.exit(1); }
console.log('every declared conflict blocks both ways, nothing else blocks, and every requirement is reported.');

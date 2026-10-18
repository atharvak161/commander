#!/usr/bin/env node
/**
 * john (John the Ripper) -> data/tools/john.json
 *
 * A LOCAL, OFFLINE tool (john 1.9.0-jumbo-1), read from its usage output (john
 * with no args prints the options to stderr).
 *
 * john joins a value to its flag with "=", never a space: "--format=raw-md5",
 * not "--format raw-md5" (which it reads as a password file). So every
 * value-taking flag carries glue "=", the builder feature added for this and
 * for dig. A "[=X]" metavar is an optional value; "=X" is required.
 *
 * Offline and safe: john needs a PASSWORD-FILE positional, and without one it
 * prints "No password hashes loaded" and exits — nothing is cracked and nothing
 * touches the network. A bad flag answers "Unknown option".
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/john.mjs';

const OUT = 'data/tools/john.json';

function john(args) {
  try { return execFileSync('john', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1 << 20 }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const banner = john(['--help']);
const version = (/John the Ripper\s+([0-9][\w.-]*)/.exec(banner) || [])[1] || 'unknown';
const help = banner;

/* "--flag[=METAVAR]  desc", "--flag=METAVAR  desc", or "--flag  desc". The
   metavar has no spaces but may nest brackets ("[=SECTION[,..]]"). john also
   puts a second related flag on the same line ("--wordlist[=FILE] --stdin"),
   so a trailing " --other" before the description is tolerated and captured.
   A value-flag's metavar is \S+; the description begins after two+ spaces. */
const OPT = /^(--[a-z][a-z0-9-]*)(\[?=\S+)?((?:\s+--[a-z][a-z0-9-]*(?:\[?=\S+)?)*)\s{2,}(\S.*?)\s*$/;

const lines = help.split('\n');
const flags = [];
const seen = new Set();

function pushFlag(long, metaRaw, desc) {
  const id = long.replace(/^--/, '');
  if (id === 'help' || seen.has(id)) return;
  seen.add(id);
  const takesValue = !!metaRaw;
  const optionalValue = metaRaw && metaRaw.startsWith('[');
  const mv = metaRaw ? metaRaw.replace(/[[\]=]/g, '').split(/[,;\s]/)[0] : '';
  const isPath = /FILE$/.test(mv);
  const takes = !takesValue ? 'none' : isPath ? 'path' : 'string';
  flags.push({
    id, short: long, long: null, takes, enum: null,
    ...(takesValue ? { glue: '=' } : {}),
    optionalValue: optionalValue || undefined,
    binds: null, required: false, repeatable: false, default: null, group: 'options',
    desc: desc.replace(/\s+/g, ' ').trim(),
    help: '', warn: null, conflicts: [], requires: [], since: null, source: 'help',
  });
}

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(OPT);
  if (!m) continue;
  const long = m[1];
  const metaRaw = m[2] || null;
  const secondary = m[3] || '';
  let desc = m[4].trim();

  /* Wrapped description continues on the next indented line. */
  for (let j = i + 1; j < lines.length; j++) {
    if (OPT.test(lines[j]) || /^\s*$/.test(lines[j]) || /^--/.test(lines[j])) break;
    if (/^\s{20,}\S/.test(lines[j])) desc += ' ' + lines[j].trim();
    else break;
  }

  pushFlag(long, metaRaw, desc);
  /* A second flag sharing the line ("--wordlist[=FILE] --stdin") gets the same
     description; parse it from the captured tail. */
  for (const sm of secondary.matchAll(/(--[a-z][a-z0-9-]*)(\[?=\S+)?/g)) {
    pushFlag(sm[1], sm[2] || null, desc);
  }
}

flags.sort((a, b) => a.id.localeCompare(b.id));

for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const tool = {
  id: 'john',
  name: 'john',
  summary: 'John the Ripper: offline password cracking across hundreds of hash formats.',
  category: 'credentials',
  homepage: 'https://www.openwall.com/john/',
  manual: 'data/manuals/john.txt',
  helpCommand: 'john --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it a hash file. A mode (--wordlist, --single, --incremental) chooses the attack.',
    usage: 'john [options] hashes.txt',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'Hash file', kind: 'path',
    placeholder: 'hashes.txt',
    help: 'The file of password hashes, as a trailing argument. Withheld during verification so nothing is cracked.',
    trailing: true,
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/john.txt', help);
console.log(`extract-john: ${flags.length} options -> ${OUT} (john ${version})`);
console.log(`  glue(=): ${flags.filter(f => f.glue).length}, path: ${flags.filter(f => f.takes === 'path').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

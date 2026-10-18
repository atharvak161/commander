#!/usr/bin/env node
/**
 * dig -> data/tools/dig.json
 *
 * A LOCAL tool (DiG 9.10.6), read from `dig -h`.
 *
 * dig has two option styles, and the data carries both:
 *   - dash options, like "-c class" and "-p port", which take their value as
 *     the NEXT argument (a space), and "-4"/"-6", which are boolean.
 *   - "+keyword" query options, like "+dnssec" (a "+[no]keyword" toggle: both
 *     +dnssec and +nodnssec are valid) and "+bufsize=1232" (a value joined with
 *     "="). The "+" is part of the token, and the value uses the builder's glue
 *     feature.
 *
 * Safe to probe: dig validates every option before it queries, so a bad option
 * answers "Invalid option: X" at parse time. A good option then queries - and
 * dig queries even with no domain - so verify.mjs forces the query at loopback
 * on a dead port (@127.0.0.1 -p 59) with +time=1 +tries=1, which fails in a
 * second without a packet leaving the machine.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/dig.mjs';

const OUT = 'data/tools/dig.json';

function dig(args) {
  try {
    return execFileSync('sh', ['-c', 'dig "$@" 2>&1', '--', ...args],
      { encoding: 'utf8', timeout: 8000, maxBuffer: 1 << 20 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const help = dig(['-h']);
/* dig -h lists only a subset of the +keyword options (it omits +short, +tcp and
   more), so the authoritative list comes from the man page, like nmap's did.
   The dash options come from -h, where they are complete. */
let man = '';
try { man = execFileSync('sh', ['-c', 'man dig | col -b'], { encoding: 'utf8', timeout: 15000, maxBuffer: 1 << 24 }); } catch {}
const version = (/DiG\s+([0-9][\w.-]*)/.exec(dig(['-v'])) || /DiG\s+([0-9][\w.-]*)/.exec(help) || [])[1] || 'unknown';

const flags = [];
const seen = new Set();

/* Dash option from -h: "  -c class  (specify query class)" or "  -4  (...)". */
const DASH = /^\s+(-[a-z46])(?:\s+(\S[^(]*?))?\s*\(([^)]*)\)\s*$/;
for (const line of help.split('\n')) {
  const dm = line.match(DASH);
  if (!dm) continue;
  const id = dm[1].replace(/^-/, '');
  if (id === 'h' || id === 'v' || seen.has(id)) continue;
  seen.add(id);
  const metavar = dm[2] ? dm[2].trim() : null;
  const takesValue = !!metavar;
  const isPath = metavar && /file/i.test(metavar);
  flags.push({
    id, short: dm[1], long: null,
    takes: !takesValue ? 'none' : isPath ? 'path' : 'string',
    enum: null, binds: null, required: false, repeatable: false, default: null,
    group: 'query options', desc: dm[3].trim(),
    help: '', warn: null, conflicts: [], requires: [], since: null, source: 'help',
  });
}

/* +keyword options from the man page. Each sits alone on a line, its
   description in the following indented paragraph:
     +[no]dnssec
          Requests DNSSEC records be sent ...
     +bufsize=B
     +[no]cookie[=####] */
const PLUS = /^\s{3,}\+(\[no\])?([a-z][a-z0-9-]*)(\[?=[^\s]*)?\s*$/;
const manLines = man.split('\n');
for (let i = 0; i < manLines.length; i++) {
  const pm = manLines[i].match(PLUS);
  if (!pm) continue;
  const toggle = !!pm[1];
  const kw = pm[2];
  if (seen.has(kw)) continue;
  seen.add(kw);
  const valRaw = pm[3] || null;
  const takesValue = !!valRaw;
  const optionalValue = valRaw && valRaw.startsWith('[');

  /* Pull the following indented paragraph as the description, to the next blank
     line or the next option. */
  let desc = '';
  for (let j = i + 1; j < manLines.length && j < i + 8; j++) {
    const l = manLines[j];
    if (PLUS.test(l) || /^\s{3,}-[a-z]/.test(l)) break;
    if (/^\s*$/.test(l)) { if (desc) break; else continue; }
    /* Continuation lines are indented with a tab (which counts as one
       character, so a width test is wrong) or deep spaces. */
    if (/^(?:\t| {6,})\s*\S/.test(l)) desc += ' ' + l.trim();
    else break;
  }

  flags.push({
    id: kw,
    short: '+' + kw, long: null,
    takes: takesValue ? 'string' : 'none',
    enum: null,
    ...(takesValue ? { glue: '=' } : {}),
    optionalValue: optionalValue || undefined,
    toggle: toggle || undefined,
    binds: null, required: false, repeatable: false, default: null,
    group: 'display options',
    desc: (desc.replace(/\s+/g, ' ').trim().slice(0, 240) || kw) + (toggle ? ` (+no${kw} to disable)` : ''),
    help: '', warn: null, conflicts: [], requires: [], since: null, source: 'help+man',
  });
}

flags.sort((a, b) => a.id.localeCompare(b.id));

for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const tool = {
  id: 'dig',
  name: 'dig',
  summary: 'DNS lookup: records of any type, zone transfers, DNSSEC, trace, reverse lookups.',
  category: 'network',
  homepage: 'https://www.isc.org/bind/',
  manual: 'data/manuals/dig.txt',
  helpCommand: 'dig -h',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it a name and record type; @server picks the resolver.',
    usage: 'dig [@server] name [type] [+options]',
    flags: flags.map(f => f.id),
  }],
  inputs: [
    {
      id: 'name', label: 'Name', kind: 'host',
      placeholder: 'target.example.com',
      help: 'The DNS name to look up, as a trailing argument. Withheld during verification.',
      trailing: true,
    },
    {
      id: 'type', label: 'Record type', kind: 'string',
      placeholder: 'A, MX, NS, TXT, ANY, AXFR',
      help: 'The record type, after the name.',
      trailing: true,
    },
  ],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/dig.txt', help);
console.log(`extract-dig: ${flags.length} options -> ${OUT} (dig ${version})`);
console.log(`  dash: ${flags.filter(f => f.short.startsWith('-')).length}, +keyword: ${flags.filter(f => f.short.startsWith('+')).length}, toggles: ${flags.filter(f => f.toggle).length}, glue: ${flags.filter(f => f.glue).length}`);

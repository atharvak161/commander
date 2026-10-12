#!/usr/bin/env node
/**
 * dnsrecon -> data/tools/dnsrecon.json
 *
 * Read from the Kali container: docker exec commander-kali dnsrecon --help.
 *
 * dnsrecon uses Python argparse, the cleanest format so far:
 *   -d, --domain DOMAIN              short, long, an uppercase METAVAR value
 *   -iL, --input-list INPUT_LIST     a two-letter short option is fine
 *   -f                               boolean, short only
 *   --shodan                         boolean, long only
 *   --loglevel {DEBUG,INFO,...}      an enum, choices in braces
 * A METAVAR (or {choices}) after the option means it takes a value. The
 * description is on the same line when it fits, else the next indented line.
 *
 * Safe to probe: the target is -d, and without it dnsrecon prints usage and
 * exits. A bad flag answers "error: unrecognized arguments: --x"; a missing
 * value answers "expected one argument", which is not a rejection.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/dnsrecon.mjs';

const CONTAINER = 'commander-kali';
const OUT = 'data/tools/dnsrecon.json';

function kali(args) {
  try {
    return execFileSync('docker',
      ['exec', CONTAINER, 'sh', '-c', 'dnsrecon "$@" 2>&1', '--', ...args],
      { encoding: 'utf8', timeout: 25000, maxBuffer: 1 << 24 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const help = kali(['--help']);
const version = (/version\s+([0-9.]+)/i.exec(kali(['--version'])) || [])[1] || 'unknown';

/* An argparse option line, in the "options:" section. Captures the short
   option, an optional long, and an optional METAVAR or {a,b,c} choice set,
   then the description if it is on the same line.
     -d, --domain DOMAIN   Target domain.
     -f                    Filter ...
     --shodan              Use Shodan ...
     --loglevel {DEBUG,INFO,WARNING,ERROR,CRITICAL} */
const OPT = /^\s{2}(-[A-Za-z]{1,3}|--[a-z][a-z0-9_-]*)(?:,\s+(--[a-z][a-z0-9_-]*))?(?:\s+(\{[^}]+\}|[A-Z][A-Z0-9_]*))?(?:\s{2,}(\S.*?))?\s*$/;

const lines = help.split('\n');
const optionsStart = lines.findIndex(l => /^options:/.test(l));
const flags = [];
const seen = new Set();

for (let i = (optionsStart >= 0 ? optionsStart + 1 : 0); i < lines.length; i++) {
  const m = lines[i].match(OPT);
  if (!m) continue;
  const first = m[1];
  const long = m[2] || (first.startsWith('--') ? first : null);
  const short = first.startsWith('--') ? null : first;
  const metavar = m[3] || null;
  let desc = (m[4] || '').trim();

  const id = (long || first).replace(/^--?/, '');
  if (seen.has(id)) continue;
  seen.add(id);

  /* Description on following indented lines (argparse wraps at ~24 cols). */
  for (let j = i + 1; j < lines.length; j++) {
    if (OPT.test(lines[j]) || /^\s*$/.test(lines[j]) || /^[a-z]/.test(lines[j])) break;
    if (/^\s{20,}\S/.test(lines[j])) desc += (desc ? ' ' : '') + lines[j].trim();
    else break;
  }

  const isChoice = metavar && /^\{.*\}$/.test(metavar);
  const enums = isChoice ? metavar.slice(1, -1).split(',').map(x => x.trim()) : null;
  const takesValue = !!metavar;
  const isPath = metavar && /(FILE|DB|XML|CSV|JSON|DICTIONARY|LIST)$/.test(metavar);
  const takes = !takesValue ? 'none' : isChoice ? 'enum' : isPath ? 'path' : 'string';

  flags.push({
    id,
    short: long || short,                 // emit the long form when there is one
    long: long ? short : null,            // keep the short as the alternate
    takes,
    enum: enums,
    ...(takes === 'enum' ? { enumEnforced: true } : {}),   // argparse DOES enforce choices
    binds: id === 'domain' ? 'target' : null,
    required: false,
    repeatable: false,
    default: null,
    group: 'options',
    desc: desc.replace(/\s+/g, ' ').trim(),
    help: '',
    warn: null,
    conflicts: [],
    requires: [],
    since: null,
    source: 'help',
  });
}

flags.sort((a, b) => a.id.localeCompare(b.id));

for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const tool = {
  id: 'dnsrecon',
  name: 'dnsrecon',
  summary: 'DNS enumeration: records, zone transfers, brute force, reverse lookups and DNSSEC.',
  category: 'network',
  homepage: 'https://github.com/darkoperator/dnsrecon',
  manual: 'data/manuals/dnsrecon.txt',
  helpCommand: 'dnsrecon --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'kali-container',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it -d a domain; -t chooses the enumeration type.',
    usage: 'dnsrecon -d target.example.com [-t std]',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'Domain', kind: 'host',
    placeholder: 'target.example.com',
    help: 'Passed with -d. Withheld during verification so no DNS queries run.',
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/dnsrecon.txt', help);
console.log(`extract-dnsrecon: ${flags.length} options -> ${OUT} (dnsrecon ${version})`);
console.log(`  enum: ${flags.filter(f => f.takes === 'enum').length}, path: ${flags.filter(f => f.takes === 'path').length}, value: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

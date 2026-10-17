#!/usr/bin/env node
/**
 * enum4linux-ng -> data/tools/enum4linux-ng.json
 *
 * Read from the Kali container: docker exec commander-kali enum4linux-ng --help.
 *
 * argparse again, but with two wrinkles the other argparse tools did not have:
 *
 *  - The target is a required POSITIONAL (host), not a flag. argparse reports
 *    "the following arguments are required: host" before it reports a bad flag,
 *    so a probe with no host cannot tell an accepted flag from a rejected one.
 *    The fix is to FORCE a benign host — 127.0.0.1, which has no SMB service,
 *    so argparse still rejects bad flags at parse time (before any connection)
 *    and a good flag completes instantly against the refused loopback. That
 *    forcing lives in verify.mjs, not here.
 *
 *  - Two mutually-exclusive groups in the usage line, "[-p PW | -K TICKET_FILE
 *    | -H NTHASH]" (auth) and "[-oJ ... | -oY ... | -oA ...]" (output). argparse
 *    rejects two members of a group together, which is a real rejection but not
 *    a defect, so they are recorded as conflicts and the verifier skips the
 *    pair.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/enum4linux-ng.mjs';

const CONTAINER = 'commander-kali';
const OUT = 'data/tools/enum4linux-ng.json';
const BIN = 'enum4linux-ng';

function kali(args) {
  try {
    return execFileSync('docker',
      ['exec', CONTAINER, 'sh', '-c', `${BIN} "$@" 2>&1`, '--', ...args],
      { encoding: 'utf8', timeout: 25000, maxBuffer: 1 << 24 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const help = kali(['--help']);
const version = (/v([0-9.]+)/.exec(help) || [])[1] || 'unknown';

/* Mutually-exclusive groups from the usage block: "[-p PW | -K ... | -H ...]".
   Each becomes a set of ids that conflict with one another. */
const usage = help.slice(0, help.indexOf('positional arguments'));
const groups = [];
for (const m of usage.matchAll(/\[(-[A-Za-z]{1,3}\s+[A-Z_]+(?:\s*\|\s*-[A-Za-z]{1,3}\s+[A-Z_]+)+)\]/g)) {
  const ids = m[1].split('|').map(x => x.trim().split(/\s+/)[0].replace(/^-+/, ''));
  if (ids.length > 1) groups.push(ids);
}
const conflictOf = id => {
  const g = groups.find(gr => gr.includes(id));
  return g ? g.filter(x => x !== id) : [];
};

/* An option line: "  -X[ METAVAR]  desc" or "  -X [OPT]  desc" or "  --long  desc". */
const OPT = /^\s{2}(--?[A-Za-z][A-Za-z0-9-]*)(?:\s+(\[[A-Z_]+\]|[A-Z_]+))?(?:\s{2,}(\S.*?))?\s*$/;

const lines = help.split('\n');
const optStart = lines.findIndex(l => /^options:/.test(l));
const flags = [];
const seen = new Set();

for (let i = (optStart >= 0 ? optStart + 1 : 0); i < lines.length; i++) {
  const m = lines[i].match(OPT);
  if (!m) continue;
  const name = m[1];
  const metavar = m[2] || null;
  let desc = (m[3] || '').trim();
  const id = name.replace(/^--?/, '');
  if (seen.has(id) || id === 'help') continue;
  seen.add(id);

  for (let j = i + 1; j < lines.length; j++) {
    if (OPT.test(lines[j]) || /^\s*$/.test(lines[j]) || /^[a-z]/.test(lines[j])) break;
    if (/^\s{18,}\S/.test(lines[j])) desc += ' ' + lines[j].trim();
    else break;
  }

  const optional = metavar && /^\[.*\]$/.test(metavar);
  const takesValue = !!metavar;
  const mv = metavar ? metavar.replace(/[[\]]/g, '') : '';
  const isPath = /FILE$/.test(mv);
  const takes = !takesValue ? 'none' : isPath ? 'path' : 'string';

  flags.push({
    id,
    short: name,
    long: null,
    takes,
    enum: null,
    optionalValue: optional || undefined,
    binds: null,
    required: false,
    repeatable: false,
    default: null,
    group: 'options',
    desc: desc.replace(/\s+/g, ' ').trim(),
    help: '',
    warn: null,
    conflicts: conflictOf(id),
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
  id: 'enum4linux-ng',
  name: 'enum4linux-ng',
  summary: 'SMB and LDAP enumeration of Windows and Samba hosts: users, groups, shares, policy, OS.',
  category: 'network',
  homepage: 'https://github.com/cddmp/enum4linux-ng',
  manual: 'data/manuals/enum4linux-ng.txt',
  helpCommand: 'enum4linux-ng --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'kali-container',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it a host. -A does the full simple enumeration.',
    usage: 'enum4linux-ng -A target.example.com',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'Host', kind: 'host',
    placeholder: '10.10.10.10  or  dc.target.example.com',
    help: 'The SMB/LDAP host, as a trailing argument. Withheld during verification (a benign loopback host is forced) so no real enumeration runs.',
    trailing: true,
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/enum4linux-ng.txt', help);
console.log(`extract-enum4linux-ng: ${flags.length} options -> ${OUT} (${version})`);
console.log(`  path: ${flags.filter(f => f.takes === 'path').length}, value: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);
console.log(`  exclusive groups: ${groups.length} -> ${groups.map(g => g.join('/')).join(', ')}`);

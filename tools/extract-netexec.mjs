#!/usr/bin/env node
/**
 * netexec (nxc) -> data/tools/netexec.json
 *
 * Read from the Kali container: docker exec commander-kali netexec <proto> --help.
 *
 * netexec is protocol-based: `nxc <protocol> <target> [options]`, with ten
 * protocols — smb, nfs, vnc, wmi, ldap, ssh, rdp, mssql, ftp, winrm — each with
 * its own flags on top of a large shared set (auth, connection, DNS). So it is
 * modelled like docker and gobuster: the protocols are the modes, a flag is
 * stored once, and a perMode override carries only the fields that differ.
 *
 * The help is argparse. A value flag shows a METAVAR; "METAVAR [METAVAR ...]"
 * means repeatable. The target is a required positional, so like
 * enum4linux-ng a benign loopback host is forced during verification (in
 * verify.mjs) — argparse rejects bad flags at parse time before any connection.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/netexec.mjs';

const CONTAINER = 'commander-kali';
const OUT = 'data/tools/netexec.json';

const PROTOCOLS = ['smb', 'ldap', 'winrm', 'ssh', 'mssql', 'nfs', 'vnc', 'wmi', 'rdp', 'ftp'];

function kali(args) {
  try {
    return execFileSync('docker',
      ['exec', CONTAINER, 'sh', '-c', 'netexec "$@" 2>&1', '--', ...args],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 1 << 24 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const version = (/^v?([0-9]+\.[0-9.]+)/m.exec(kali(['--version']).trim()) || [])[1] || 'unknown';

/* An argparse option line. Captures -short, optional --long, and an optional
   metavar which may repeat: "--hash HASH [HASH ...]". */
const OPT = /^\s{2}(--?[A-Za-z][\w-]*)(?:,\s+(--[a-z][\w-]*))?((?:\s+\[?[A-Z][A-Z0-9_]*(?:\s+\[?[A-Z][A-Z0-9_]*\s*\.\.\.\]?)?\]?)?)(?:\s{2,}(\S.*?))?\s*$/;

/* Parse one protocol's help into a map id -> {short,long,takes,repeatable,desc}. */
function parseProto(help) {
  const lines = help.split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OPT);
    if (!m) continue;
    const first = m[1];
    const long = m[2] || (first.startsWith('--') ? first : null);
    const short = first.startsWith('--') ? null : first;
    const metaRaw = (m[3] || '').trim();
    let desc = (m[4] || '').trim();

    /* Prefer the short form: netexec is spoken in -u, -p, -H, not --username.
       The long name is kept as the alternate. Long-only flags keep the long. */
    const emit = short || long;
    const id = emit.replace(/^--?/, '');
    if (id === 'help' || out.has(id)) continue;

    for (let j = i + 1; j < lines.length; j++) {
      if (OPT.test(lines[j]) || /^\s*$/.test(lines[j]) || /^[A-Za-z]/.test(lines[j])) break;
      if (/^\s{20,}\S/.test(lines[j])) desc += ' ' + lines[j].trim();
      else break;
    }

    const repeatable = /\.\.\./.test(metaRaw);
    /* A bracketed metavar with no "..." is an optional single value: [SHARES]. */
    const optionalValue = /^\[/.test(metaRaw) && !/\.\.\./.test(metaRaw);
    const takesValue = !!metaRaw;
    const mv = metaRaw.replace(/[[\]]/g, '').split(/\s+/)[0] || '';
    const isPath = /FILE$|PATH$/.test(mv);
    const takes = !takesValue ? 'none' : isPath ? 'path' : 'string';
    out.set(id, {
      id, short: emit, long: (short && long) ? long : null,
      takes, repeatable, optionalValue, desc: desc.replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

const perProto = {};
for (const p of PROTOCOLS) perProto[p] = parseProto(kali([p, '--help']));

/* -M/--module takes a value from argparse's own choices list. The authoritative
   set is the binary's "invalid choice: ... (choose from ...)" error. Capture it
   once and attach it as the enum, which argparse enforces. */
function moduleChoices() {
  const err = kali(['smb', '-M', '__commander_probe__', '127.0.0.1']);
  const m = /choose from\s*\(?([^)]+)\)?/i.exec(err);
  if (!m) return null;
  return m[1].split(',').map(x => x.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
const MODULES = moduleChoices();

/* Collapse: a flag is stored once with the most common shape; only fields that
   differ in a given protocol go into perMode (docker/gobuster pattern). */
const allIds = [...new Set(PROTOCOLS.flatMap(p => [...perProto[p].keys()]))];
const flags = [];
const modeFlags = {};
for (const p of PROTOCOLS) modeFlags[p] = [...perProto[p].keys()];

for (const id of allIds) {
  const variants = PROTOCOLS.filter(p => perProto[p].has(id)).map(p => [p, perProto[p].get(id)]);
  const pick = key => {
    const counts = new Map();
    for (const [, v] of variants) { const k = JSON.stringify(v[key]); counts.set(k, (counts.get(k) || 0) + 1); }
    return JSON.parse([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  };
  const base = {
    short: pick('short'), long: pick('long'), takes: pick('takes'),
    repeatable: pick('repeatable'), optionalValue: pick('optionalValue'), desc: pick('desc'),
  };
  const perMode = {};
  for (const [p, v] of variants) {
    const diff = {};
    for (const k of ['takes', 'repeatable', 'desc']) {
      if (JSON.stringify(v[k]) !== JSON.stringify(base[k])) diff[k] = v[k];
    }
    if (Object.keys(diff).length) perMode[p] = diff;
  }

  flags.push({
    id,
    short: base.short, long: base.long,
    takes: base.takes, enum: null,
    binds: null,
    required: false,
    repeatable: base.repeatable,
    ...(base.optionalValue ? { optionalValue: true } : {}),
    default: null,
    group: 'options',
    desc: base.desc || id,
    help: '', warn: null, conflicts: [], requires: [], since: null, source: 'help',
    ...(Object.keys(perMode).length ? { perMode } : {}),
  });
}

/* Attach the module enum to -M (argparse enforces it). */
if (MODULES && MODULES.length) {
  const mFlag = flags.find(f => f.id === 'M');
  if (mFlag) { mFlag.takes = 'enum'; mFlag.enum = MODULES; mFlag.enumEnforced = true; }
}

flags.sort((a, b) => a.id.localeCompare(b.id));

for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const tool = {
  id: 'netexec',
  name: 'netexec',
  summary: 'Network execution across SMB, LDAP, WinRM, SSH, MSSQL and more: auth, enumeration, and running commands.',
  category: 'network',
  homepage: 'https://github.com/Pennyw0rth/NetExec',
  manual: 'data/manuals/netexec.txt',
  helpCommand: 'netexec smb --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'kali-container',
  },
  modes: PROTOCOLS.map(p => ({
    id: p, name: p,
    summary: `The ${p.toUpperCase()} protocol.`,
    usage: `netexec ${p} <target> [options]`,
    flags: modeFlags[p],
  })),
  inputs: [{
    id: 'target', label: 'Target', kind: 'host',
    placeholder: '10.10.10.10  or  10.10.10.0/24  or  targets.txt',
    help: 'Host, CIDR range or file, as a trailing argument. Withheld during verification (a benign loopback host is forced) so no real connection runs.',
    trailing: true,
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/netexec.txt', kali(['smb', '--help']));
console.log(`extract-netexec: ${flags.length} flags across ${PROTOCOLS.length} protocols -> ${OUT} (netexec ${version})`);
console.log(`  repeatable: ${flags.filter(f => f.repeatable).length}, path: ${flags.filter(f => f.takes === 'path').length}, perMode: ${flags.filter(f => f.perMode).length}`);

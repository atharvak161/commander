#!/usr/bin/env node
/**
 * nc (GNU netcat) -> data/tools/netcat.json
 *
 * A LOCAL tool (GNU netcat 0.7.1), read from `nc -h`.
 *
 * Clean GNU getopt_long: "  -c, --close    desc" and "  -e, --exec=PROGRAM
 * desc". A value follows "="; the hostname and port are trailing positionals.
 *
 * Safe to probe: without a hostname nc prints "missing hostname argument" and
 * exits, so the positionals are withheld. A bad flag answers "invalid option".
 * Three flags are blocked from the live verifier because they do more than
 * parse: -l (listen) opens and waits on a socket, -L (tunnel) forwards a port,
 * and -e (exec) would run a program on connect. Their membership is proved by
 * the singles pass regardless.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/netcat.mjs';

const OUT = 'data/tools/netcat.json';

function nc(args) {
  try { return execFileSync('nc', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1 << 20 }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const help = nc(['-h']);
const version = (/netcat\s+([0-9.]+)/i.exec(help) || /GNU netcat\s+([0-9.]+)/.exec(nc(['-V'])) || [])[1] || '0.7.1';

/* "  -c, --close                desc"  or  "  -e, --exec=PROGRAM    desc" */
const OPT = /^\s{2}(-[A-Za-z]),\s+(--[a-z][a-z-]*)(?:=([A-Z][A-Za-z0-9:_-]*))?\s{2,}(\S.*?)\s*$/;

const lines = help.split('\n');
const flags = [];
for (const line of lines) {
  const m = line.match(OPT);
  if (!m) continue;
  const short = m[1], long = m[2], metavar = m[3] || null, desc = m[4].trim();
  const id = long.replace(/^--/, '');
  if (id === 'help') continue;

  const takesValue = !!metavar;
  const isPath = metavar && /^FILE$/.test(metavar);
  const takes = !takesValue ? 'none' : isPath ? 'path' : 'string';

  flags.push({
    id,
    short, long,
    takes,
    enum: null,
    binds: null,
    required: false,
    repeatable: false,
    default: null,
    group: 'options',
    desc,
    help: '',
    warn: id === 'exec' ? 'destructive' : null,
    conflicts: [],
    requires: [],
    since: null,
    source: 'help',
  });
}

flags.sort((a, b) => a.id.localeCompare(b.id));

/* -l (listen) and -u (udp) conflict with each other in intent; keep them free. */
for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const tool = {
  id: 'netcat',
  name: 'nc',
  summary: 'The network Swiss army knife: connect, listen, scan ports, move data over TCP or UDP.',
  category: 'network',
  homepage: 'https://netcat.sourceforge.net/',
  manual: 'data/manuals/netcat.txt',
  helpCommand: 'nc -h',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Connect to a host and port, or -l to listen.',
    usage: 'nc [options] hostname port',
    flags: flags.map(f => f.id),
  }],
  inputs: [
    {
      id: 'host', label: 'Host', kind: 'host',
      placeholder: '10.10.10.10',
      help: 'The host to connect to (omit for listen mode). Trailing. Withheld during verification.',
      trailing: true,
    },
    {
      id: 'port', label: 'Port', kind: 'port',
      placeholder: '4444',
      help: 'The port, after the host. Trailing.',
      trailing: true,
    },
  ],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/netcat.txt', help);
console.log(`extract-netcat: ${flags.length} options -> ${OUT} (netcat ${version})`);
console.log(`  path: ${flags.filter(f => f.takes === 'path').length}, value: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

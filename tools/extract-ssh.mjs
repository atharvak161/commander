#!/usr/bin/env node
/**
 * ssh (OpenSSH client) -> data/tools/ssh.json
 *
 * A LOCAL tool. ssh has no --help; it prints a usage line to stderr and keeps
 * the real documentation in `man ssh`. So, like dig and nmap, two sources:
 *   - the USAGE line decides each option's arity. The bundle "[-46AaCf...]" is
 *     every boolean flag; "[-i identity_file]" and friends are the value flags,
 *     and the bracketed word is the metavar.
 *   - the MAN page gives the descriptions.
 * The usage line is authoritative on arity because the man page formats a
 * boolean's description and a value flag's metavar in the same column, which
 * cannot be told apart by shape alone.
 *
 * Safe to probe: ssh needs a destination, and refuses to connect without one.
 * verify.mjs withholds the destination (a trailing input), so every valid flag
 * stops at "usage:" having opened no socket, and an unknown flag answers
 * "illegal option". Nothing reaches the network.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/ssh.mjs';

const OUT = 'data/tools/ssh.json';

function sh(cmd) {
  try { return execFileSync('sh', ['-c', cmd], { encoding: 'utf8', timeout: 15000, maxBuffer: 1 << 24 }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const usage = sh('ssh 2>&1 || true');
const man = sh('man ssh 2>/dev/null | col -b');
const version = (/OpenSSH_([0-9][\w.]*)/.exec(sh('ssh -V 2>&1')) || [])[1] || 'unknown';

/* From the usage line: the boolean bundle and the value flags with metavars.
   Usage spans several lines; join them. */
const usageFlat = usage.replace(/\n\s+/g, ' ');
const BOOL = new Set();
const VAL = new Map();                              // flag char -> metavar
/* "[-46AaCfGgKkMNnqsTtVvXxYy]" : a bracket group of bare flag letters. */
for (const m of usageFlat.matchAll(/\[-([A-Za-z0-9]{2,})\]/g)) {
  for (const ch of m[1]) BOOL.add(ch);
}
/* "[-i identity_file]", "[-D [bind_address:]port]" : flag then a metavar. */
for (const m of usageFlat.matchAll(/\[-([A-Za-z0-9]) ([^\]]+(?:\[[^\]]*\][^\]]*)*)\]/g)) {
  VAL.set(m[1], m[2].trim());
}

const PATHISH = /file$|configfile|identity|ctl_path|pkcs11|log_file/i;

const flags = [];
const seen = new Set();

/* Walk the man page. An option line is five spaces then "-X"; its description
   is that line's tail (for a boolean) or the following indented lines (for a
   value flag, whose own line carries only the metavar). */
const lines = man.split('\n');
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^ {5}(-[A-Za-z0-9])(?:\s+(\S.*))?$/);
  if (!m) continue;
  const ch = m[1].slice(1);
  if (seen.has(ch)) continue;                       // -L/-R repeat per syntax
  if (!BOOL.has(ch) && !VAL.has(ch)) continue;      // not a real flag per usage
  seen.add(ch);
  const isVal = VAL.has(ch);
  const tail = (m[2] || '').trim();

  /* Gather the wrapped description: deeply-indented lines until the next option
     or a blank line. For a boolean the tail starts the description; for a value
     flag the tail is the metavar, so the description starts on the next line. */
  let desc = isVal ? '' : tail;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (/^ {5}-[A-Za-z0-9]/.test(l) || /^\S/.test(l)) break;
    if (/^\s*$/.test(l)) { if (desc) break; else continue; }
    if (/^ {9,}\S/.test(l)) desc += (desc ? ' ' : '') + l.trim();
    else break;
  }

  const metavar = isVal ? VAL.get(ch) : null;
  const takes = !isVal ? 'none' : (PATHISH.test(metavar) ? 'path' : 'string');
  flags.push({
    id: ch, short: m[1], long: null,
    takes, enum: null, binds: null, required: false, repeatable: false, default: null,
    group: isVal ? 'options with a value' : 'switches',
    desc: (desc.replace(/\s+/g, ' ').trim() || m[1]).slice(0, 240),
    help: '', warn: null, conflicts: [], requires: [], since: null, source: 'usage+man',
  });
}

flags.sort((a, b) => a.id.localeCompare(b.id, undefined, { sensitivity: 'case' }) || (a.id < b.id ? -1 : 1));

for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const tool = {
  id: 'ssh',
  name: 'ssh',
  summary: 'OpenSSH client: log in, run a command, tunnel a port, or pivot through a jump host.',
  category: 'network',
  homepage: 'https://www.openssh.com/',
  manual: 'data/manuals/ssh.txt',
  helpCommand: 'man ssh',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'A destination (user@host), with options before it and an optional command after.',
    usage: 'ssh [options] destination [command]',
    flags: flags.map(f => f.id),
  }],
  inputs: [
    {
      id: 'destination', label: 'Destination', kind: 'host',
      placeholder: 'user@host', trailing: true, required: true,
      help: 'Where to connect, as user@host (or a host from your ssh config). Withheld during verification so nothing connects.',
    },
    {
      id: 'command', label: 'Remote command', kind: 'string',
      placeholder: 'id; uname -a', trailing: true,
      help: 'An optional command to run on the remote host instead of a shell.',
    },
  ],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/ssh.txt', man);
console.log(`extract-ssh: ${flags.length} flags -> ${OUT} (ssh ${version})`);
console.log(`  value: ${flags.filter(f => f.takes !== 'none').length}, path: ${flags.filter(f => f.takes === 'path').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

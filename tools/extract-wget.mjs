#!/usr/bin/env node
/**
 * wget -> data/tools/wget.json
 *
 * A LOCAL tool (GNU Wget, on this Mac), read from `wget --help`.
 *
 * GNU getopt_long, grouped under section headers (Startup, Download, HTTP
 * options, ...), which become the flag groups:
 *   -V,  --version              a short and a long, boolean
 *        --report-speed=TYPE    long only, takes a value after =
 *   -o,  --output-file=FILE     a value that is a path
 *   -nv, --no-verbose           a negation form
 * A trailing "=VALUE" means the option takes a value; "=FILE" is a path.
 *
 * Safe to probe: the URL is a trailing positional, and without it wget prints
 * "missing URL" and exits. A bad flag answers "unrecognized option"; a value
 * flag with no value answers "requires an argument", which is not a rejection.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/wget.mjs';

const OUT = 'data/tools/wget.json';

function wget(args) {
  try { return execFileSync('wget', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1 << 24 }); }
  catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const help = wget(['--help']);
const version = (/GNU Wget\s+([0-9.]+)/.exec(help) || [])[1] || 'unknown';

/* An option line: a short (-x, or -nv,) optionally, then --long, an optional
   =VALUE, two+ spaces, the description. */
const OPT = /^\s{2,}(?:(-[A-Za-z0-9]+),\s+)?(--[a-z][a-z0-9-]*)(?:(=|\[=)([A-Z][A-Z0-9_]*)\]?)?(?:\s{2,}(\S.*?))?\s*$/;
const HEADER = /^([A-Z][A-Za-z /]+):\s*$/;

const lines = help.split('\n');
const flags = [];
const seen = new Set();
let group = 'options';

for (let i = 0; i < lines.length; i++) {
  const hm = lines[i].match(HEADER);
  if (hm) { group = hm[1].trim().toLowerCase(); continue; }

  const m = lines[i].match(OPT);
  if (!m) continue;
  const short = m[1] || null;
  const long = m[2];
  const eq = m[3] || null;
  const metavar = m[4] || null;
  let desc = (m[5] || '').trim();

  const id = long.replace(/^--/, '');
  if (id === 'help' || seen.has(id)) continue;
  seen.add(id);

  for (let j = i + 1; j < lines.length; j++) {
    if (OPT.test(lines[j]) || HEADER.test(lines[j]) || /^\s*$/.test(lines[j])) break;
    if (/^\s{20,}\S/.test(lines[j])) desc += ' ' + lines[j].trim();
    else break;
  }

  const optionalValue = eq === '[=';
  const takesValue = !!metavar;
  const isPath = metavar && /^(FILE|DIR|DIRECTORY|PREFIX|PATH)$/.test(metavar);
  const takes = !takesValue ? 'none' : isPath ? 'path' : 'string';

  flags.push({
    id,
    short: short || long,          // emit the short when present, else the long
    long: short ? long : null,
    takes,
    enum: null,
    optionalValue: optionalValue || undefined,
    binds: null,
    required: false,
    repeatable: id === 'header' || id === 'execute' || undefined,
    default: null,
    group,
    desc: desc.replace(/\s+/g, ' ').trim() || id,
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
  id: 'wget',
  name: 'wget',
  summary: 'Non-interactive downloader: HTTP, HTTPS and FTP, recursive mirroring, resume.',
  category: 'network',
  homepage: 'https://www.gnu.org/software/wget/',
  manual: 'data/manuals/wget.txt',
  helpCommand: 'wget --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it one or more URLs. -r mirrors recursively.',
    usage: 'wget [options] https://target.example.com/file',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'URL(s)', kind: 'url',
    placeholder: 'https://target.example.com/file',
    help: 'One or more URLs, as a trailing argument. Withheld during verification so no download runs.',
    trailing: true,
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/wget.txt', help);
console.log(`extract-wget: ${flags.length} options -> ${OUT} (wget ${version})`);
console.log(`  path: ${flags.filter(f => f.takes === 'path').length}, value: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

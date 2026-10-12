#!/usr/bin/env node
/**
 * nuclei -> data/tools/nuclei.json
 *
 * Read from the Kali container: docker exec commander-kali nuclei -h.
 *
 * nuclei is a Go tool using projectdiscovery's goflags, so both the short and
 * long names are single-dash and a type word follows:
 *   -mt, -max-time value     short, long, a value
 *   -u, -target string[]     string[] means repeatable
 *   -sa, -scan-all-ips       no type word means boolean
 *   -iv, -ip-version string[] (default 4)   a default in parentheses
 * Options are grouped under ALL-CAPS section headers, kept as the flag groups.
 *
 * Safe to probe: without a target (-u / -l) and templates, nuclei prints
 * "no templates provided for scan" and exits — it never scans. A bad flag
 * answers "flag provided but not defined". The target and the update/network
 * flags are withheld and blocked during verification.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/nuclei.mjs';

const CONTAINER = 'commander-kali';
const OUT = 'data/tools/nuclei.json';

function kali(args) {
  try {
    return execFileSync('docker',
      ['exec', CONTAINER, 'sh', '-c', 'nuclei "$@" 2>&1', '--', ...args],
      { encoding: 'utf8', timeout: 25000, maxBuffer: 1 << 24 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const version = (/Version:?\s*v?([0-9.]+)/i.exec(kali(['-version'])) || [])[1] || 'unknown';
const help = kali(['-h']);

/* A goflags line: 3-space indent, -short optionally then , -long, an optional
   type word, two+ spaces, the description (which may carry a (default ...)). */
const OPT = /^\s{2,}(-[a-zA-Z][\w-]*)(?:,\s+(-[a-zA-Z][\w-]*))?(?:\s+(string\[\]|value\[\]|int\[\]|string|int|value))?\s{2,}(\S.*?)\s*$/;
const HEADER = /^([A-Z][A-Z0-9 -]+):\s*$/;

const lines = help.split('\n');
const flags = [];
const seen = new Set();
let group = 'options';

for (let i = 0; i < lines.length; i++) {
  const hm = lines[i].match(HEADER);
  if (hm) { group = hm[1].trim().toLowerCase(); continue; }

  const m = lines[i].match(OPT);
  if (!m) continue;
  const a = m[1], b = m[2] || null, type = m[3] || null;
  let desc = m[4].trim();

  /* goflags prints "-short, -long"; the long (second, more descriptive) is the
     one to emit. When only one name is present, it is the long. */
  const long = b || a;
  const short = b ? a : null;
  const id = long.replace(/^-/, '');
  if (seen.has(id)) continue;
  seen.add(id);

  let def = null;
  const dm = desc.match(/\(default\s+"?([^")]*)"?\)\s*$/);
  if (dm) { def = dm[1].trim(); desc = desc.replace(/\s*\(default\s+[^)]*\)\s*$/, '').trim(); }

  const repeatable = !!type && type.endsWith('[]');
  const takesValue = !!type;
  /* "Possible values: a, b, c" in the description is an enum. nuclei accepts
     comma-separated combinations, so it is documented, not strictly policed. */
  let enums = null;
  const pv = /Possible values:\s*([a-z0-9,\s]+)$/i.exec(desc);
  if (pv) enums = pv[1].split(',').map(x => x.trim()).filter(Boolean);
  /* A path only when the description clearly says the value IS a path, not when
     it merely mentions "file" as one accepted form (tags are "comma-separated,
     file"). */
  const isPath = takesValue && !enums &&
    /\b(path to|file to|directory|output to|write .* to|save .* to)\b/i.test(desc);
  const baseType = type && type.replace('[]', '');
  const takes = !takesValue ? 'none'
    : enums ? 'enum'
    : isPath ? 'path'
    : baseType === 'int' ? 'int' : 'string';

  flags.push({
    id,
    short: long,                        // emit the long (goflags both single-dash)
    long: short,                        // the short alias
    takes,
    enum: enums,
    ...(takes === 'enum' ? { enumEnforced: false } : {}),
    binds: (id === 'target') ? 'target' : null,
    required: false,
    repeatable,
    default: def,
    group,
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
  id: 'nuclei',
  name: 'nuclei',
  summary: 'Template-based vulnerability scanner: thousands of community checks across web, network and cloud.',
  category: 'web',
  homepage: 'https://github.com/projectdiscovery/nuclei',
  manual: 'data/manuals/nuclei.txt',
  helpCommand: 'nuclei -h',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'kali-container',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it -u a target; -t or -tags choose which templates run.',
    usage: 'nuclei -u https://target.example.com [-t cves/ -severity high]',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'Target URL / host', kind: 'url',
    placeholder: 'https://target.example.com',
    help: 'Passed with -u. Withheld during verification so no scan runs.',
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/nuclei.txt', help);
console.log(`extract-nuclei: ${flags.length} options -> ${OUT} (nuclei ${version})`);
console.log(`  repeatable: ${flags.filter(f => f.repeatable).length}, path: ${flags.filter(f => f.takes === 'path').length}, int: ${flags.filter(f => f.takes === 'int').length}, value: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

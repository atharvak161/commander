#!/usr/bin/env node
/**
 * wpscan -> data/tools/wpscan.json
 *
 * Read from the Kali container, like nikto: docker exec commander-kali wpscan --hh.
 *
 * wpscan is a Ruby tool and its help is Ruby OptionParser output, which has a
 * few shapes nikto's did not:
 *   -t, --max-threads VALUE     short alias, long option, a value placeholder
 *       --format FORMAT         long only, takes a value
 *       --[no-]banner           a toggle: both --banner and --no-banner are valid
 *       --user-agent, --ua V    two long spellings of one option
 *   -e, --enumerate [OPTS]      an OPTIONAL value, in brackets
 * Enumerated values come on a following "Available choices: a, b, c" line, and
 * defaults on a "Default: x" line.
 *
 * Safe to probe: --url is mandatory, so withholding it makes wpscan print
 * "One of the following options is required: --url, ..." and stop. A bad flag
 * answers "Scan Aborted: invalid option: --x"; a value flag with no value
 * answers "missing argument", which is not a rejection.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/wpscan.mjs';

const CONTAINER = 'commander-kali';
const OUT = 'data/tools/wpscan.json';

function kali(args) {
  try {
    return execFileSync('docker',
      ['exec', CONTAINER, 'sh', '-c', 'wpscan "$@" 2>&1', '--', ...args],
      { encoding: 'utf8', timeout: 25000, maxBuffer: 1 << 24 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const help = kali(['--hh']);

/* wpscan's help leaves a few options with no description text at all. */
const DESC_OVERRIDE = {
  'user-agent': 'The User-Agent string to send with each request.',
  'proxy-auth': 'Credentials for the proxy set with --proxy, as login:password.',
};
const version = (/Version\s+([0-9.]+)/.exec(help) || [])[1] || 'unknown';

/* An option line. Captures an optional short (-x,), the first long (--name or
   --[no-]name), an optional second long alias, and an optional value token,
   then the description. The value token is a bare uppercased word, a
   protocol://... placeholder, a login:password, or [OPTS] in brackets. */
const OPT = new RegExp(
  '^\\s{2,}' +
  '(?:(-[A-Za-z]),\\s+)?' +                         // 1: short alias
  '(--\\[no-\\]-?[a-z][a-z0-9-]*|--[a-z][a-z0-9-]*)' + // 2: primary long
  '(?:,\\s+(--[a-z][a-z0-9-]*))?' +                 // 3: second long alias
  '(?:\\s+(\\[?[A-Za-z][A-Za-z0-9_:/.-]*\\]?|[a-z]+://[^\\s]+))?' + // 4: value token
  '(?:\\s{2,}(\\S.*))?$');                           // 5: description

const lines = help.split('\n');
const flags = [];
const seen = new Set();

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(OPT);
  if (!m) continue;
  const short = m[1] || null;
  let primary = m[2];
  const alias = m[3] || null;
  const valTok = m[4] || null;
  let desc = (m[5] || '').trim();

  const toggle = /^--\[no-\]/.test(primary);
  const name = primary.replace(/^--(\[no-\])?/, '');   // id without -- and [no-]
  if (seen.has(name)) continue;
  seen.add(name);

  /* Pull in following indented lines: Default, Available choices, and wrapped
     description text. Stop at the next option line. */
  let enums = null, def = null;
  for (let j = i + 1; j < lines.length; j++) {
    if (OPT.test(lines[j])) break;
    const t = lines[j].trim();
    if (!t) { if (/^\s{40,}/.test(lines[j]) || j === i + 1) continue; else break; }
    const ch = /Available (?:choices|Choices):\s*(.+)$/.exec(t);
    if (ch) { enums = ch[1].split(',').map(x => x.trim().replace(/\s+.*$/, '')).filter(Boolean); continue; }
    const dm = /^Default:\s*(.+)$/.exec(t);
    if (dm) { def = dm[1].trim(); continue; }
    if (/^(Note|Example|Separator|Format|Wildcard|Available)/.test(t)) continue;
    desc += ' ' + t;
  }

  const optional = valTok && /^\[.*\]$/.test(valTok);     // [OPTS] — optional value
  const takesValue = !!valTok;
  const hasEnum = enums && enums.length > 0;
  /* A FILE / FILE-PATH / PATH / DIR value token means a filesystem path, which
     the awkward-value pass exercises for shell-quoting robustness. */
  const isPath = valTok && /^(FILE|FILE-PATH|PATH|DIR)$/i.test(valTok.replace(/[\[\]]/g, ''));
  const takes = !takesValue ? 'none' : hasEnum ? 'enum' : isPath ? 'path' : 'string';

  flags.push({
    id: name,
    short: primary.replace(/^--\[no-\]/, '--'),           // the emitted spelling
    long: short || alias,                                 // short alias or second long
    takes,
    enum: hasEnum ? enums : null,
    ...(takes === 'enum' ? { enumEnforced: false } : {}),
    toggle: toggle || undefined,                          // --no-x also valid
    optionalValue: optional || undefined,
    binds: name === 'url' ? 'target' : null,
    required: false,
    repeatable: false,
    default: def,
    group: 'options',
    desc: (DESC_OVERRIDE[name] || desc.replace(/\s+/g, ' ').trim()),
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
  id: 'wpscan',
  name: 'wpscan',
  summary: 'WordPress security scanner: core, plugin and theme versions, users and known vulnerabilities.',
  category: 'web',
  homepage: 'https://github.com/wpscanteam/wpscan',
  manual: 'data/manuals/wpscan.txt',
  helpCommand: 'wpscan --hh',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'kali-container',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it --url; -e chooses what to enumerate.',
    usage: 'wpscan --url https://target.example.com [options]',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'Target URL', kind: 'url',
    placeholder: 'https://target.example.com',
    help: 'Passed with --url. Withheld during verification so no scan runs.',
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/wpscan.txt', help);
console.log(`extract-wpscan: ${flags.length} options -> ${OUT} (wpscan ${version})`);
console.log(`  enum: ${flags.filter(f => f.takes === 'enum').length}, value: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);
console.log(`  toggles: ${flags.filter(f => f.toggle).length}, optional-value: ${flags.filter(f => f.optionalValue).length}`);

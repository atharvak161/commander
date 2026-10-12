#!/usr/bin/env node
/**
 * whatweb -> data/tools/whatweb.json
 *
 * Read from the Kali container: docker exec commander-kali whatweb --help.
 *
 * whatweb is Ruby and its help is grouped under ALL-CAPS section headers, with
 * options in the shape:
 *   --long, -x=VALUE   description      (long, a short alias, a value)
 *   --long=VALUE       description
 *   --long, -x         description      (boolean)
 *   --colour,--color=WHEN               (two long spellings)
 * The value, when present, follows an = sign. Some values are an enumerated set
 * named in the description with backtick-quoted `word' tokens (--follow-redirect,
 * --colour); those are captured. Others (aggression levels) are listed on
 * separate numbered lines and left as a documented, unpoliced string.
 *
 * Safe to probe: the target is a bare positional at the end. Withholding it
 * makes whatweb print "No targets selected" and stop. A bad flag answers
 * "unrecognized option"; a value flag with no value answers "requires an
 * argument", which is not a rejection.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/whatweb.mjs';

const CONTAINER = 'commander-kali';
const OUT = 'data/tools/whatweb.json';

function kali(args) {
  try {
    return execFileSync('docker',
      ['exec', CONTAINER, 'sh', '-c', 'whatweb "$@" 2>&1', '--', ...args],
      { encoding: 'utf8', timeout: 25000, maxBuffer: 1 << 24 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const version = (/version\s+([0-9.]+)/i.exec(kali(['--version']).split('\n')[0] || '') || [])[1] || 'unknown';
const help = kali(['--help']);

/* The help is unreliable about which options take a value: --header and
   --max-threads describe a value in prose but print no =VALUE. So every option
   the help calls boolean is put to the binary — whatweb answers
   "option `--x' requires an argument" when it actually takes one.
   The text proposes, the binary decides. */
function reallyTakesValue(primary) {
  return /requires an argument/i.test(kali([primary]));
}

/* An option line: two-space indent, --long, then the short alias and the
   =VALUE token in EITHER order (whatweb prints --input-file=FILE, -i but also
   --user-agent, -U=AGENT), then whitespace and the description. */
const OPT = /^\s{2,}(--[a-z][a-z0-9-]*)(=\[?[A-Za-z][A-Za-z0-9|<>:_-]*\]?)?((?:,\s*-{1,2}[A-Za-z][A-Za-z0-9-]*(?:=\[?[A-Za-z][A-Za-z0-9|<>:_-]*\]?)?)*)[\s\t]+(\S.*?)\s*$/;
/* A section header: ALL-CAPS words ending in a colon. */
const HEADER = /^([A-Z][A-Z &/]+):\s*$/;

const lines = help.split('\n');
const flags = [];
const seen = new Set();
let group = 'options';

for (let i = 0; i < lines.length; i++) {
  const hm = lines[i].match(HEADER);
  if (hm) { group = hm[1].trim().toLowerCase().replace(/ & | /g, '-'); continue; }

  const m = lines[i].match(OPT);
  if (!m) continue;
  const primary = m[1];
  const valAfterPrimary = m[2] ? m[2].slice(1) : null;      // =VALUE right after --long
  const aliasPart = m[3] || '';
  let desc = m[4].trim();
  /* A value token may sit on the short alias instead: --user-agent, -U=AGENT. */
  const valOnAlias = (/=(\[?[A-Za-z][A-Za-z0-9|<>:_-]*\]?)/.exec(aliasPart) || [])[1] || null;
  let valTok = valAfterPrimary || valOnAlias;
  const aliases = aliasPart.split(',').map(x => x.trim().replace(/=.*/, '')).filter(Boolean);

  const name = primary.replace(/^--/, '');
  if (seen.has(name)) continue;
  seen.add(name);

  /* Wrapped description lines are indented (whatweb uses tabs, so a character
     count is the wrong test) and are not option lines, headers, blanks, or the
     numbered aggression-level list. */
  for (let j = i + 1; j < lines.length; j++) {
    if (OPT.test(lines[j]) || HEADER.test(lines[j]) || /^\s*$/.test(lines[j])) break;
    if (/^[ \t]+\S/.test(lines[j]) && !/^\s*[0-9]\.\s/.test(lines[j])) {
      desc += ' ' + lines[j].trim();
    } else break;
  }

  /* The binary is the authority on arity: if the help showed no value token but
     whatweb says the option requires an argument, it takes one. */
  if (!valTok && reallyTakesValue(primary)) valTok = 'VALUE';

  /* Enumerated values named in the description as backtick-quoted `word'
     (whatweb writes `never', `always'). */
  let enums = null;
  const backticked = [...desc.matchAll(/`([a-z][a-z-]+)'/g)].map(x => x[1]);
  if (valTok && backticked.length >= 2) enums = [...new Set(backticked)];

  const optional = valTok && /^\[.*\]$/.test(valTok);
  const takesValue = !!valTok;
  const isPath = valTok && /^(FILE|PATH|DIR)$/i.test(valTok.replace(/[[\]]/g, ''));
  const hasEnum = enums && enums.length > 0;
  const takes = !takesValue ? 'none' : hasEnum ? 'enum' : isPath ? 'path' : 'string';

  /* The short alias (-x) and any second long spelling. */
  const shortAlias = aliases.find(a => /^-[A-Za-z]$/.test(a)) || null;
  const longAlias = aliases.find(a => /^--/.test(a)) || null;

  flags.push({
    id: name,
    short: primary,
    long: shortAlias || longAlias,
    takes,
    enum: hasEnum ? enums : null,
    ...(takes === 'enum' ? { enumEnforced: false } : {}),
    optionalValue: optional || undefined,
    binds: null,
    required: false,
    repeatable: name === 'header' || undefined,
    default: null,
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
  id: 'whatweb',
  name: 'whatweb',
  summary: 'Web technology fingerprinter: servers, frameworks, CMSes, libraries and versions.',
  category: 'web',
  homepage: 'https://github.com/urbanadventurer/WhatWeb',
  manual: 'data/manuals/whatweb.txt',
  helpCommand: 'whatweb --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'kali-container',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Give it one or more targets; -a sets how aggressive it is.',
    usage: 'whatweb [options] https://target.example.com',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'Target(s)', kind: 'url',
    placeholder: 'https://target.example.com  or  10.10.10.0/24',
    help: 'URLs, hostnames, IPs or CIDR ranges, as a trailing argument. Withheld during verification so no scan runs.',
    trailing: true,
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
writeFileSync('data/manuals/whatweb.txt', help);
console.log(`extract-whatweb: ${flags.length} options -> ${OUT} (whatweb ${version})`);
console.log(`  enum: ${flags.filter(f => f.takes === 'enum').length}, path: ${flags.filter(f => f.takes === 'path').length}, value: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

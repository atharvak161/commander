#!/usr/bin/env node
/**
 * nikto -> data/tools/nikto.json
 *
 * nikto is the first tool read from the Kali container rather than from a local
 * binary: it is not on this Mac, so `tools/kali.sh` keeps a long-lived
 * kalilinux/kali-rolling container and we read its help from there. The command
 * is `docker exec commander-kali nikto -Help`.
 *
 * nikto is safe to probe for one reason: it validates every option before it
 * touches the network, and it refuses to do anything without -host. A bogus
 * option answers "Unknown option: X" and a missing -host answers "ERROR: No
 * host (-host) specified" — so the verifier withholds -host and nikto parses
 * the whole command line, then stops. Nothing is scanned.
 *
 * nikto's option syntax is its own: single-dash long options (-ssl, -Tuning),
 * a trailing + on the name meaning "takes a value", and several options whose
 * values are an enumerated set printed on indented lines beneath them.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/nikto.mjs';

const CONTAINER = 'commander-kali';
const OUT = 'data/tools/nikto.json';

function kali(args) {
  return execFileSync('docker', ['exec', CONTAINER, 'nikto', ...args],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 1 << 24 });
}

const version = (/Nikto\s+([0-9.]+)/.exec(kali(['-Version']).split('\n').find(l => /Nikto/.test(l)) || '')
  || [])[1] || 'unknown';

const help = (() => { try { return kali(['-Help']); } catch (e) { return String(e.stdout || ''); } })();

/* An option line: whitespace, -Name, optional +, two or more spaces, description.
   nikto indents the enum sub-values further, so they are picked up separately. */
const OPT = /^\s{2,}(-[A-Za-z0-9][A-Za-z0-9-]*)(\+)?\s{2,}(\S.*?)\s*$/;
/* An enum value line: deep indent, a short token (letter/digit or short word),
   two or more spaces, its meaning. Excludes the parenthetical notes nikto puts
   at the same indent, which begin with "(". */
const ENUM = /^\s{24,}([A-Za-z0-9][A-Za-z0-9]{0,4})\s{2,}(\S.*?)\s*$/;

/* The help's + marking is unreliable: -Add-header and -mutate-options take a
   value but are printed without it. So every flag the help calls boolean is put
   to the binary — `nikto -<flag>` answers "Option <flag> requires an argument"
   when it actually takes one. The text proposes, the binary decides. */
function kaliBoth(args) {
  /* Merge stderr into stdout: nikto prints "requires an argument" and
     "Unknown option" to stderr, and the arity and membership checks need them. */
  try {
    return execFileSync('docker',
      ['exec', CONTAINER, 'sh', '-c', 'nikto "$@" 2>&1', '--', ...args],
      { encoding: 'utf8', timeout: 20000, maxBuffer: 1 << 24 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}
function reallyTakesValue(name) {
  return new RegExp('Option ' + name + ' requires an argument', 'i').test(kaliBoth(['-' + name]));
}
/* Membership: a flag the binary answers "Unknown option" for is not real, no
   matter what the help prints. The verify gate would catch it; dropping it here
   keeps a phantom flag off the page in the first place. */
function isReal(name) {
  return !new RegExp('Unknown option:\\s*' + name, 'i').test(kaliBoth(['-' + name]));
}

/* nikto options that may be given more than once, from the help text. */
const REPEATABLE = new Set(['Add-header', 'Option']);
/* Flags the binary does not REQUIRE a value for but does ACCEPT one for: nikto
   prints "or argument ..." in their help. reallyTakesValue sees no error and
   would call them boolean, so they are named here and treated as taking a value. */
const OPTIONAL_VALUE = new Set(['useproxy']);
/* -host and -url both name the target; -url is an alias. They bind the input. */
const TARGET = new Set(['host', 'url']);

const lines = help.split('\n');
const flags = [];
const seen = new Set();

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(OPT);
  if (!m) continue;
  const name = m[1].replace(/^-/, '');
  if (seen.has(name)) continue;
  seen.add(name);
  const takesValue = !!m[2];
  let desc = m[3];

  /* Collect any enumerated values that follow, and any wrapped description. */
  const enums = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (OPT.test(lines[j])) break;
    const em = lines[j].match(ENUM);
    if (em) { enums.push(em[1]); continue; }
    if (/^\s*$/.test(lines[j])) continue;
    /* a wrapped description line, indented but not an enum value */
    if (/^\s{14,}\S/.test(lines[j]) && !/requires a value/.test(lines[j]) && !/^\s*\(/.test(lines[j])) {
      desc += ' ' + lines[j].trim();
    } else break;
  }

  /* Membership first: drop anything the binary does not recognise. */
  if (!takesValue && !enums.length && !isReal(name)) {
    console.log(`  dropped -${name}: binary answers "Unknown option"`);
    continue;
  }

  const hasEnum = enums.length > 0;
  /* A flag with a listed value set takes a value; otherwise trust the binary
     over the help's + marking. */
  const takesValue2 = takesValue || hasEnum || OPTIONAL_VALUE.has(name) || reallyTakesValue(name);
  const takes = !takesValue2 ? 'none' : hasEnum ? 'enum' : 'string';
  flags.push({
    id: name,
    short: '-' + name,
    long: null,
    takes,
    enum: hasEnum ? enums : null,
    /* enumEnforced belongs only on an enum flag, and nikto's enums are
       combinable (Tuning 1234b) and we do not police them. */
    ...(takes === 'enum' ? { enumEnforced: false } : {}),
    binds: TARGET.has(name) ? 'target' : null,
    required: false,
    repeatable: REPEATABLE.has(name),
    default: null,
    group: 'options',
    desc: desc.trim(),
    help: '',
    warn: null,
    conflicts: [],
    requires: [],
    since: null,
    source: 'help',
  });
}

flags.sort((a, b) => a.id.localeCompare(b.id));

/* Attach recipe alternatives that reference real flags. */
for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const tool = {
  id: 'nikto',
  name: 'nikto',
  summary: 'Web server scanner: known files, misconfigurations and version-matched issues.',
  category: 'web',
  homepage: 'https://github.com/sullo/nikto',
  manual: 'data/manuals/nikto.txt',
  helpCommand: 'nikto -Help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'kali-container',
  },
  modes: [{
    id: 'default', name: 'default',
    summary: 'Single mode. Give it a host; -Tuning narrows what it tests.',
    usage: 'nikto -host https://target.example.com [options]',
    flags: flags.map(f => f.id),
  }],
  inputs: [{
    id: 'target', label: 'Target host / URL', kind: 'url',
    placeholder: 'https://target.example.com  or  10.10.10.10',
    help: 'Passed with -host (or -url). Withheld during verification so no scan runs.',
    required: true,
  }],
  flags,
  recipes,
};
for (const i of tool.inputs) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
const manual = (() => { try { return help; } catch (e) { return ''; } })();
writeFileSync('data/manuals/nikto.txt', manual);
console.log(`extract-nikto: ${flags.length} options -> ${OUT} (nikto ${version})`);
console.log(`  enum options: ${flags.filter(f => f.takes === 'enum').length}`);
console.log(`  value options: ${flags.filter(f => f.takes !== 'none').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);

#!/usr/bin/env node
/**
 * Extractor for ffuf's help format (Go flag style).
 *
 * ONE extractor per help format, never a universal parser. The three tools in
 * Phase 1a print three incompatible shapes; a parser that tried to handle all
 * of them would be wrong about each.
 *
 * Emits a DRAFT. It fills what the help text actually states and leaves
 * conflicts, requires and the long help empty for the human pass. It never
 * invents a relationship.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SRC = 'data/manuals/ffuf.txt';
const OUT = 'data/tools/ffuf.json';

const version = (() => {
  const first = readFileSync(SRC, 'utf8').split('\n')[0];
  const m = first.match(/([\d.]+(?:-\w+)?)\s*$/);
  return m ? m[1] : 'unknown';
})();

/* Section heading -> group id. Sections are the author's own grouping, which is
   better than anything we would invent. */
const GROUPS = {
  'HTTP OPTIONS': 'http',
  'GENERAL OPTIONS': 'general',
  'MATCHER OPTIONS': 'matcher',
  'FILTER OPTIONS': 'filter',
  'INPUT OPTIONS': 'input',
  'OUTPUT OPTIONS': 'output',
};

/* Value type inferred from the description, not guessed from the flag name.
   Conservative: anything unrecognised becomes "string", which is safe because
   the UI renders a free text box. */
/* A closed value set, taken from the tool's OWN words.
   ffuf states them in the help text: "Available modes: clusterbomb, pitchfork,
   sniper" and "Available formats: json, ejson, html, md, csv, ecsv (or, 'all'
   for all formats)". Without this the UI offers a free-text box for a field
   that has exactly three legal answers, and the path heuristic below mistypes
   both ("Multi-wordlist operation mode" matches /wordlist/, "Output file
   format" matches /file/). Enum wins over every heuristic. */
function inferEnum(desc) {
  const m = /\bAvailable\s+\w+:\s*([^.]+)/i.exec(desc);
  if (!m) return null;
  let tail = m[1];
  const vals = [];

  /* "(or, 'all' for all formats)" — a quoted extra value, legal but outside the list. */
  const paren = /\(or,?\s*'([^']+)'/i.exec(tail);
  if (paren) tail = tail.slice(0, paren.index);

  for (const part of tail.split(',')) {
    const v = part.trim().replace(/^'|'$/g, '');
    if (/^[a-z0-9][a-z0-9_.-]*$/i.test(v)) vals.push(v);
  }
  if (paren) vals.push(paren[1]);
  return vals.length >= 2 ? vals : null;
}

/* Second shape ffuf uses for a closed set: quoted alternatives joined by "or".
     -preflight-error  Preflight error handling: "abort" or "ignore"
   Two flags carried this and both were typed as free text. */
/* Third shape: "Matcher set operator. Either of: and, or". Two flags use it
   (-mmode and -fmode) and both were free text; ffuf rejects anything else. */
function inferEitherOf(desc) {
  const m = /\bEither of:\s*([a-z0-9]+(?:\s*,\s*[a-z0-9]+)+)/i.exec(desc);
  if (!m) return null;
  const vals = m[1].split(/\s*,\s*/).map(v => v.trim()).filter(Boolean);
  return vals.length >= 2 ? vals : null;
}

function inferQuotedEnum(desc) {
  const m = /:\s*("[a-z0-9_.-]+"(?:\s*(?:,|or)\s*"[a-z0-9_.-]+")+)/i.exec(desc);
  if (!m) return null;
  const vals = [...m[1].matchAll(/"([a-z0-9_.-]+)"/gi)].map(x => x[1]);
  return vals.length >= 2 ? vals : null;
}

function inferTakes(flag, desc) {
  const d = desc.toLowerCase();
  if (/^\(default:\s*(true|false)\)/.test(d) || /\(default: false\)/.test(d)) return 'none';
  if (inferEnum(desc) || inferQuotedEnum(desc) || inferEitherOf(desc)) return 'enum';
  if (/\bwordlist\b|\bfile\b|\bpath\b|\bdirectory\b/.test(d)) return 'path';
  if (/\burl\b/.test(d)) return 'url';
  if (/number of|\bseconds\b|\brate\b|\bamount\b|\bdelay\b|\bthreads\b|\bdepth\b|\bcount\b/.test(d)) return 'int';
  return 'string';
}

/* Case is SIGNIFICANT in a flag id. ffuf has -x and -X, -v and -V, -d and -D,
   and they do completely different things. Lowercasing the id collapsed each
   pair into one, which silently dropped three flags and mislabelled three more.
   The checker caught it on its first run; the id keeps the original case. */
function slug(flag) {
  return flag.replace(/^-+/, '').replace(/[^a-zA-Z0-9]+/g, '-');
}

const lines = readFileSync(SRC, 'utf8').split('\n');
let group = 'general';
const flags = [];
const seen = new Set();

for (const raw of lines) {
  const sec = raw.match(/^([A-Z][A-Z\s]+):\s*$/);
  if (sec) { group = GROUPS[sec[1].trim()] || 'general'; continue; }

  /* Indent is exactly two spaces for a flag, four or more for the EXAMPLES
     block (which contains lines like "-d '{...}' -fr \"error\"" that would
     otherwise parse as flags). The separator is one space or more, not two:
     -recursion-strategy is long enough to eat the column padding, leaving a
     single space, and requiring two silently dropped it — a real flag, with a
     closed value set, missing from the tool entirely. */
  const m = raw.match(/^ {2}(-[A-Za-z0-9-]+)\s+(.+?)\s*$/);
  if (!m) continue;

  const flag = m[1];
  let desc = m[2].trim();
  if (seen.has(flag)) continue;
  seen.add(flag);

  let def = null;
  const dm = desc.match(/\(default:\s*([^)]*)\)\s*$/i);
  if (dm) { def = dm[1].trim(); desc = desc.replace(/\s*\(default:\s*[^)]*\)\s*$/i, '').trim(); }

  /* Classify from the CLEANED desc, never the raw line. Passing m[2] left
     "(default: clusterbomb)" glued to the last enum value, so -mode came out
     with clusterbomb and pitchfork and silently lost sniper. */
  const takes = (def === 'false' || def === 'true') ? 'none' : inferTakes(flag, desc);
  const enumVals = takes === 'enum' ? (inferEnum(desc) || inferQuotedEnum(desc) || inferEitherOf(desc)) : null;

  flags.push({
    id: slug(flag),
    short: flag,
    long: null,
    takes,
    enum: enumVals,
    binds: null,
    required: false,
    /* Two wordings: "multiple -H flags are accepted" and a bare "(repeatable"
       (-preflight, -postflight and their -var partners). The second was missed. */
    repeatable: /multiple .* are accepted/i.test(desc) || /\(repeatable/i.test(desc),
    default: def,
    group,
    desc,
    help: '',
    warn: null,
    conflicts: [],
    requires: [],
    since: null,
    source: 'help',
  });
}

/* Relationships the tool states in its own words. Parsed rather than hand-coded,
   because the author's sentence is more authoritative than our assumption and it
   stays correct when the tool updates.
      "Implies -ac"                      -> requires ac
      "Used in conjunction with -e flag" -> requires e
      "Overrides -w"                     -> conflicts w
      "Client key needs to be defined"   -> handled by NAMED below, since the
                                            sentence names no flag token
   Anything not stated is left empty. The extractor never invents a relationship. */
const byToken = new Map(flags.map(f => [f.short, f]));
function ref(tok) { const f = byToken.get(tok); return f ? f.id : null; }

for (const f of flags) {
  const d = f.desc;

  for (const m of d.matchAll(/\bImplies\s+(-[A-Za-z0-9-]+)(?:\s+and\s+(-[A-Za-z0-9-]+))?/gi)) {
    for (const tok of [m[1], m[2]]) { const id = tok && ref(tok); if (id && id !== f.id) f.requires.push(id); }
  }
  for (const m of d.matchAll(/\bin conjunction with\s+(-{1,2}[A-Za-z0-9-]+)/gi)) {
    const id = ref(m[1].replace(/^--/, '-')); if (id && id !== f.id) f.requires.push(id);
  }
  for (const m of d.matchAll(/\bis required when\b[^.]*/gi)) { /* handled via the named flag below */ }
  for (const m of d.matchAll(/\bOverrides\s+(-[A-Za-z0-9-]+)/gi)) {
    const id = ref(m[1]); if (id && id !== f.id) f.conflicts.push(id);
  }
  f.requires = [...new Set(f.requires)];
  f.conflicts = [...new Set(f.conflicts)];
}

/* Stated in prose without a parseable token. Each is quoted from the help text
   so the claim is checkable against the source. */
const NAMED = [
  ['cc', 'requires', 'ck', 'Client key needs to be defined as well for this to work'],
  ['ck', 'requires', 'cc', 'Client certificate needs to be defined as well for this to work'],
  ['input-cmd', 'requires', 'input-num', '--input-num is required when using this input method'],
  /* Not from the help text — from the binary. ffuf only reads -of when -o is
     set, and otherwise ignores it silently: "ffuf -of bogus" runs happily,
     "ffuf -of bogus -o f" errors with "Unknown output file format (-of)".
     So picking a format with nowhere to write it does nothing, and the enum
     test could never reach the validation path. Found by test/enums.mjs. */
  ['of', 'requires', 'o', 'observed: -of is only read when -o is set (ffuf 2.1.0-dev)'],
];
for (const [from, kind, to, quote] of NAMED) {
  const f = flags.find(x => x.id === from);
  const t = flags.find(x => x.id === to);
  if (!f || !t) { console.error(`extract-ffuf: NAMED refers to a flag that does not exist: ${from} -> ${to}`); process.exit(1); }
  if (!f[kind].includes(to)) f[kind].push(to);
}

/* Conflicts must be symmetric; the checker enforces it, so do it here. */
for (const f of flags) {
  for (const c of f.conflicts) {
    const o = flags.find(x => x.id === c);
    if (o && !o.conflicts.includes(f.id)) o.conflicts.push(f.id);
  }
}

/* Known bindings. Deliberately explicit rather than inferred: a wrong binding
   silently produces a wrong command, which is the one failure mode this project
   exists to prevent. */
const BINDS = { u: 'target', w: 'wordlist', o: 'output' };
for (const f of flags) if (BINDS[f.id]) f.binds = BINDS[f.id];

const uFlag = flags.find(f => f.id === 'u');
const wFlag = flags.find(f => f.id === 'w');
/* NOT marked required, deliberately. ffuf accepts -request in place of -u and
   --input-cmd in place of -w, so demanding these two told someone running a
   perfectly valid "ffuf -request r.txt --input-cmd 'seq 1 10'" that -u and -w
   were missing. The real rule is one-of, and it lives in requiresOneOf. */

const doc = {
  id: 'ffuf',
  name: 'ffuf',
  summary: 'Fast web fuzzer for content discovery, parameters, vhosts and more.',
  category: 'recon',
  homepage: 'https://github.com/ffuf/ffuf',
  manual: 'data/manuals/ffuf.txt',
  helpCommand: 'ffuf -h',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: `${process.platform}-${process.arch}`,
  },
  modes: [{
    id: 'default',
    name: 'default',
    summary: 'Single mode. The FUZZ keyword marks the injection point.',
    usage: 'ffuf -u https://target/FUZZ -w wordlist.txt [flags]',
    flags: flags.map(f => f.id),
  }],
  inputs: [
    { id: 'target',   label: 'Target URL',  kind: 'url',  placeholder: 'https://example.com/FUZZ' },
    { id: 'wordlist', label: 'Wordlist',    kind: 'path', placeholder: '~/wordlists/SecLists/Discovery/Web-Content/common.txt' },
    { id: 'output',   label: 'Output file', kind: 'path', placeholder: 'results.json' },
  ],
  flags,
  /* ffuf's own words, from its startup errors:
       "-u flag or -request flag is required"
       "Either -w or --input-cmd flag is required"
     Marking -u and -w required outright would complain at someone who
     correctly used -request or --input-cmd instead. */
  requiresOneOf: [
    { ids: ['u', 'request'], label: 'the target' },
    { ids: ['w', 'input-cmd'], label: 'where the words come from' },
  ],
  recipes: [],
};

writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
console.log(`extract-ffuf: ${flags.length} flags -> ${OUT} (ffuf ${version})`);

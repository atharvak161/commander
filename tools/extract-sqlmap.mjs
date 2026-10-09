#!/usr/bin/env node
/**
 * sqlmap -> data/tools/sqlmap.json
 *
 * sqlmap's `-hh` truncates long option names to a fixed column — 59 of them,
 * "--openapi=OPENAP..", "-A AGENT, --user.." — and ignores COLUMNS, so no
 * terminal width recovers them. Parsing that output would invent flags.
 *
 * So the facts come from sqlmap's own optparse objects instead, via
 * tools/dump-sqlmap-options.py, which hooks add_option and lets sqlmap build
 * its own parser. That gives the full names, the real types and actions, the
 * declared defaults and the group titles in sqlmap's own order. It is the
 * declaration the help is merely a lossy rendering of.
 *
 * Enums stay conservative on purpose. Most sqlmap help strings carry an "e.g."
 * example, not a closed set, and reading those as enums is how you end up
 * offering three choices for a field that accepts anything. Only two shapes
 * count: an explicit numeric range ("1-5"), and "A, B or C". Whatever survives
 * is then put to the binary by test/enums.mjs, which fails if the set is not
 * actually closed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/sqlmap.mjs';

const DUMP = process.argv[2] || 'data/manuals/sqlmap.options.json';
const OUT = 'data/tools/sqlmap.json';
if (!existsSync(DUMP)) { console.error(`missing ${DUMP}; run tools/dump-sqlmap-options.py <libexec> > ${DUMP}`); process.exit(1); }

const { version, options, enforced } = JSON.parse(readFileSync(DUMP, 'utf8'));

const GROUP_SLUG = t => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const slug = s => s.replace(/^-+/, '').replace(/[^a-zA-Z0-9]+/g, '-');

/* A closed set, only in the two shapes sqlmap actually uses for one. */
function inferEnum(help, type) {
  /* "Level of tests to perform (1-5, default 1)" / "Verbosity level: 0-6" */
  const range = /\((\d)-(\d)[,)]|:\s*(\d)-(\d)\b/.exec(help);
  if (range) {
    const lo = +(range[1] ?? range[3]), hi = +(range[2] ?? range[4]);
    if (hi > lo && hi - lo <= 12) return Array.from({ length: hi - lo + 1 }, (_, i) => String(lo + i));
  }
  /* Text sets are NOT inferred from the help. sqlmap's help for --tor-type
     reads "(HTTP, SOCKS4 or SOCKS5 (default))" and omits HTTPS, which the
     binary accepts. The two options sqlmap really validates come from its own
     enum classes instead — see `enforced` in the dump. */
  return null;
}

/* sqlmap declares the type, so inference is only needed to narrow a string. */
function takesFor(o, enumVals) {
  if (o.action === 'store_true' || o.action === 'store_false' || o.action === 'help') return 'none';
  if (enumVals) return 'enum';
  if (o.type === 'int' || o.type === 'float') return 'int';
  const hint = `${o.dest || ''} ${o.metavar || ''} ${o.help || ''}`.toLowerCase();
  if (/\bfile\b|logfile|requestfile|configfile|bulkfile|\bpath\b|directory/.test(hint)) return 'path';
  if (/\burl\b|dork/.test(hint)) return 'url';
  if (/\bport\b/.test(hint)) return 'port';
  if (/\bhost\b|proxy/.test(hint)) return 'host';
  return 'string';
}

/* Ranges sqlmap documents but does not enforce. -v says "0-6" and accepts
   anything, including text, so offering six choices would be a lie. Proved by
   test/enums.mjs, which fails a set the binary does not actually close. */
const ADVISORY_ONLY = new Set(['-v']);

/* sqlmap states some defaults only in the help string — "(default 1)",
   "(default \"BEUSTQ\")" — while the option object carries None. Leaving it in
   the description shows the user a stray "(default 3)" where a default badge
   belongs. Eleven flags were affected.

   The pattern demands whitespace and content after the word, so --tor-type's
   nested "(HTTP, SOCKS4 or SOCKS5 (default))" — which marks WHICH value is the
   default rather than naming one — is left alone, as is --level's
   "(1-5, default 1)" where the paren opens before the range. */
const HELP_DEFAULT = /\s*\(default:?\s+([^()]+)\)\s*$/;
/* The other shape, where the default rides along inside a range:
   "Level of tests to perform (1-5, default 1)". The range stays in the
   description because it is explanatory; only the default moves. */
const HELP_DEFAULT_INNER = /,\s*default:?\s+([^(),]+)\)\s*$/;

function defaultFor(o) {
  if (o.default !== null && o.default !== undefined) return String(o.default);
  const h = o.help || '';
  const m = HELP_DEFAULT.exec(h) || HELP_DEFAULT_INNER.exec(h);
  return m ? m[1].trim().replace(/^"|"$/g, '') : null;
}

const flags = [];
const seen = new Set();
for (const o of options) {
  if (o.action === 'help') continue;                       // -h prints help and exits
  const short = o.short[0] || null;
  const long = o.long[0] || null;
  const token = long || short;                             // sqlmap's own preferred spelling
  if (!token) continue;
  const id = slug(token);
  if (seen.has(id)) continue;
  seen.add(id);

  /* sqlmap's own enum classes win over anything in the help text. */
  const enumVals = ADVISORY_ONLY.has(token) ? null
    : (enforced[long] || enforced[short] || inferEnum(o.help || '', o.type));
  flags.push({
    id,
    short: token,
    long: (long && short) ? short : null,                  // the alternate spelling
    takes: takesFor(o, enumVals),
    enum: enumVals,
    binds: id === 'url' ? 'target' : null,
    required: false,                                       // sqlmap accepts -u, -r, -l, -m, -g or -d
    repeatable: false,
    default: defaultFor(o),
    group: GROUP_SLUG(o.group),
    desc: (o.help || '').replace(HELP_DEFAULT, '').replace(HELP_DEFAULT_INNER, ')').replace(/\s+/g, ' ').trim(),
    help: '',
    warn: null,
    conflicts: [],
    requires: [],
    since: null,
    source: 'declaration',
  });
}

/* Flags that do the same job, for a recipe's "or change it" list. */
const _byId = new Map(flags.map ? [] : []);
for (const [aid, alts] of Object.entries(alternatives)) {
  const f = (Array.isArray(flags) ? flags : [...flags.values()]).find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => (Array.isArray(flags) ? flags : [...flags.values()]).some(x => x.id === a.id));
}

const tool = {
  id: 'sqlmap',
  name: 'sqlmap',
  summary: 'Automatic SQL injection detection and exploitation.',
  category: 'exploitation',
  manual: 'data/manuals/sqlmap.txt',
  helpCommand: 'sqlmap -hh',
  provenance: {
    toolVersion: version,
    source: 'declaration',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{ id: 'default', name: '', summary: 'Test the target for SQL injection.', flags: flags.map(f => f.id) }],
  inputs: [
    { id: 'target', label: 'Target URL', placeholder: 'http://site.example.com/page.php?id=1', help: 'The URL to test, including the parameter you want probed.' },
  ],
  flags,
  /* sqlmap's Target group carries its own rule: "At least one of these options
     has to be provided to define the target(s)". Without it, a bare "sqlmap"
     was offered as a finished command. */
  requiresOneOf: [
    /* The target SOURCES only. --openapi-base and --openapi-tags shape an
       OpenAPI target, they do not supply one. */
    { ids: flags.filter(f => f.group === 'target' && f.takes !== 'none' && !/^openapi-/.test(f.id)).map(f => f.id), label: 'something to test' },
  ],
  /* Curated, not parsed: which flags belong together for a job is a judgement
     no help text makes. Verified like any other command — tools/verify.mjs
     runs every recipe against the binary. */
  recipes,
};


/* The example values a recipe falls back to until the panel is filled in.
   Applied by id so the input literals stay about the input, not the examples. */
for (const i of tool.inputs || []) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
console.log(`extract-sqlmap: ${flags.length} flags -> ${OUT} (sqlmap ${version})`);
console.log(`  enums: ${flags.filter(f => f.enum).map(f => f.short).join(', ') || 'none'}`);

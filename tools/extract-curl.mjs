#!/usr/bin/env node
/**
 * curl -> data/tools/curl.json
 *
 * curl is the friendliest source so far: `--help all` prints every option in a
 * single consistent shape, and the man page gives a long block per option. So
 * the help supplies the list and the short description, and the man page is
 * read for the two things the help cannot say — whether a flag may be repeated
 * ("can be used several times", which curl writes 29 times) and a fuller
 * explanation.
 *
 * The URL is a TRAILING positional, like nmap's target: `curl [options] <url>`.
 *
 * Verification is safe for the usual reason: with no URL, curl parses every
 * option and then stops with "curl: (2) no URL specified". Nothing is fetched.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/curl.mjs';

const HELP = 'data/manuals/curl.help.txt';
const MAN = 'data/manuals/curl.txt';
const OUT = 'data/tools/curl.json';
for (const f of [HELP, MAN]) if (!existsSync(f)) { console.error(`missing ${f}`); process.exit(1); }

const version = (/^curl ([0-9.]+)/.exec(execFileSync('curl', ['--version'], { encoding: 'utf8' })) || [])[1] || 'unknown';
const slug = s => s.replace(/^-+/, '').replace(/[^a-zA-Z0-9]+/g, '-');

/* A help line:
       --abstract-unix-socket <path>   Connect via abstract Unix domain socket
   -a, --append                        Append to target file when uploading
   -E, --cert <certificate[:password]>  Client certificate file and password
   The short form is optional, the <arg> is optional, and the argument itself
   can contain nested brackets — "--aws-sigv4 <provider1[:prvdr2[:reg[:srv]]]>"
   — so the arg is taken as everything between the FIRST '<' and the LAST '>'
   on the option's own portion of the line.

   Not every argument is in angle brackets. Two are written bare:
       --preproxy [protocol://]host[:port]  Use this proxy first
    -x, --proxy [protocol://]host[:port]  Use this proxy
   Requiring '<' dropped BOTH LINES ENTIRELY, so curl shipped without --proxy,
   which is among the flags people reach for most. A square bracket is allowed
   to open an argument too; anything else after the name is the description,
   which in curl's help always starts with a capital letter.

   A short alias is not always a letter: curl uses "-#" for --progress-bar and
   "-:" for --next. Requiring [A-Za-z0-9] dropped both of those lines too. */
const LINE = /^\s*(?:(-[^\s,]),\s+)?(--[A-Za-z0-9][A-Za-z0-9.-]*)((?:\s+(?:<.*?>|\[\S*))?)\s\s+(\S.*?)\s*$/;

/* curl states a closed set in parentheses: "Certificate type (DER/PEM/ENG/P12)".
   Only that shape — anything looser would read an example as a rule.

   curl does not REJECT another value at parse time; it fails later, during the
   TLS handshake. The values are still right and a picker is still better than
   a free-text box, so the set is kept and marked `enumEnforced: false` — an
   honest statement that the tool documents these values rather than policing
   them, and the one test/enums.mjs uses to decide what it can prove. */
function inferEnum(desc) {
  const m = /\(([A-Za-z0-9.]+(?:\/[A-Za-z0-9.]+)+)\)\s*$/.exec(desc);
  if (!m) return null;
  const vals = m[1].split('/').map(v => v.trim()).filter(Boolean);
  return vals.length >= 2 ? vals : null;
}

function takesFor(arg, desc, enumVals) {
  if (!arg) return 'none';
  if (enumVals) return 'enum';
  /* An argument with alternatives is named by its FIRST one: "<header/@file>"
     is a header you may also read from a file, and "<data|filename>" is data.
     Typing on the whole string made --header a path, because the word "file"
     appears in it. */
  /* Strip a leading optional part before typing: "[protocol://]host[:port]"
     is a host, not whatever "[protocol:" looks like. */
  const a = arg.toLowerCase().replace(/^\[[^\]]*\]/, '').split(/[/|]/)[0].trim();
  /* Type on the LEADING identifier. "host[:port]" is a host that may carry a
     port, not a port — and checking for "port" anywhere matched it first, so
     --proxy came out as a port number. */
  const head = (a.match(/^[a-z][a-z0-9_-]*/) || [a])[0];
  if (/^@|file|filename|^dir$|^path$|cert|keyfile/.test(head)) return 'path';
  if (/^url$/.test(head)) return 'url';
  if (/^port$|^portnum/.test(head)) return 'port';
  if (/^host|^addr|^ip$|^server/.test(head)) return 'host';
  if (/file|\bpath\b|\bdir\b/.test(a)) return 'path';
  if (/\burl\b/.test(a)) return 'url';
  if (/seconds|time|num|size|offset|rate|count|amount|bytes|level|mode/.test(a)) return 'int';
  return 'string';
}

/* ---------------------------------------------------------------- help ---- */
const flags = new Map();
for (const raw of readFileSync(HELP, 'utf8').split('\n')) {
  const m = raw.match(LINE);
  if (!m) continue;
  const [, short, long, argRaw, desc] = m;
  const arg = (argRaw || '').trim().replace(/^<|>$/g, '') || null;
  const id = slug(long);
  if (flags.has(id)) continue;
  const enumVals = inferEnum(desc);
  flags.set(id, {
    id,
    short: long,                 // curl's canonical spelling is the long one
    long: short || null,         // the one-letter alias, when there is one
    takes: takesFor(arg, desc, enumVals),
    enum: enumVals,
    enumEnforced: enumVals ? false : undefined,
    binds: null,
    required: false,
    repeatable: false,
    default: null,
    group: 'options',
    desc: desc.trim(),
    help: '',
    warn: null,
    note: null,
    conflicts: [],
    requires: [],
    since: null,
    source: 'help',
  });
}

/* ----------------------------------------------------------------- man ---- */
/* Option blocks are a heading at five spaces and a body at twelve. The body is
   where curl says a flag may be given more than once. */
const manLines = readFileSync(MAN, 'utf8').split('\n');
const MAN_HEAD = /^ {5}(?:(-[A-Za-z0-9]),\s+)?(--[A-Za-z0-9][A-Za-z0-9.-]*)/;
let repeatable = 0, enriched = 0;
for (let i = 0; i < manLines.length; i++) {
  const h = manLines[i].match(MAN_HEAD);
  if (!h) continue;
  const f = flags.get(slug(h[2]));
  if (!f) continue;

  /* Read to the NEXT option heading, not to the first blank line. curl's
     blocks run to several paragraphs and the sentence that matters — "This
     option can be used several times" — is usually not in the first one.
     Stopping at the blank line found zero repeatable flags where there are
     twenty-nine. */
  const body = [];
  for (let j = i + 1; j < manLines.length; j++) {
    if (MAN_HEAD.test(manLines[j])) break;
    if (/^\s*$/.test(manLines[j])) continue;
    if (!/^ {10,}\S/.test(manLines[j])) break;
    body.push(manLines[j].trim());
  }
  /* The whole block, uncapped. A character cap here is how --header came out
     as "not repeatable": curl says so 50 lines into its block, past any
     reasonable cap. The cap belongs on what is STORED, not on what is read. */
  const text = body.join(' ');

  /* Repeatable only means something for a flag that TAKES a value, because
     the interface implements it as one value per line. curl says -O "can be
     used several times" — once per URL — but it takes no value, so there is
     nothing to list. Marking it repeatable produced an empty box. */
  if (f.takes !== 'none'
      && /can be used (?:several|multiple|many) times|may be (?:used|specified) multiple times/i.test(text)) {
    if (!f.repeatable) { f.repeatable = true; repeatable++; }
  }
  /* The man page's first sentence is usually fuller than the help's one-liner. */
  const first = (text.match(/^.*?\.(?:\s|$)/) || [text])[0].trim();
  if (first && first.length > f.desc.length && first.length < 240) { f.help = text.slice(0, 400); enriched++; }
  if (f.source === 'help') f.source = 'help+man';
}

const list = [...flags.values()].sort((a, b) => a.id.localeCompare(b.id));

/* Flags that do the same job, for a recipe's "or change it" list. */
const _byId = new Map(flags.map ? [] : []);
for (const [aid, alts] of Object.entries(alternatives)) {
  const f = (Array.isArray(flags) ? flags : [...flags.values()]).find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => (Array.isArray(flags) ? flags : [...flags.values()]).some(x => x.id === a.id));
}

const tool = {
  id: 'curl',
  name: 'curl',
  summary: 'Transfer data to or from a server over HTTP, FTP, SMTP and twenty other protocols.',
  category: 'http',
  manual: MAN,
  helpCommand: 'curl --help all',
  provenance: {
    toolVersion: version,
    source: 'help+man',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{ id: 'default', name: '', summary: 'Make a request.', flags: list.map(f => f.id) }],
  inputs: [
    {
      id: 'target',
      label: 'URL',
      placeholder: 'https://example.com/path?a=1',
      trailing: true,
      required: true,
      help: 'curl takes the URL as a bare argument at the end, not behind a flag. Several URLs are allowed.',
    },
  ],
  flags: list,
  /* Curated, not parsed: which flags belong together for a job is a judgement
     no help text makes. Verified like any other command — tools/verify.mjs
     runs every recipe against the binary. */
  recipes,
};


/* The example values a recipe falls back to until the panel is filled in.
   Applied by id so the input literals stay about the input, not the examples. */
for (const i of tool.inputs || []) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
console.log(`extract-curl: ${list.length} flags -> ${OUT} (curl ${version})`);
console.log(`  enums: ${list.filter(f => f.enum).map(f => f.short).join(', ') || 'none'}`);
console.log(`  repeatable: ${repeatable}, enriched from man: ${enriched}`);

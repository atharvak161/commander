#!/usr/bin/env node
/**
 * tshark -> data/tools/tshark.json
 *
 * tshark is the first tool here that is DANGEROUS TO PROBE NAIVELY. Every
 * other tool, given no target, prints its help and exits. tshark given no
 * arguments starts capturing live traffic off the default interface — so the
 * assumption the whole verification approach rests on ("no target means it
 * does nothing") is false for it.
 *
 * The safe mode is `-r <file>`: reading a capture file never touches the
 * network. tools/verify.mjs gives tshark a 24-byte empty pcap for every probe,
 * so flags are parsed and rejected exactly as normal with nothing captured.
 *
 * The help has two layouts and both need handling: a short spec keeps its
 * description on the same line, a long one puts it on the next, indented.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/tshark.mjs';

const HELP = 'data/manuals/tshark.help.txt';
const MAN = 'data/manuals/tshark.txt';
const OUT = 'data/tools/tshark.json';
for (const f of [HELP, MAN]) if (!existsSync(f)) { console.error(`missing ${f}`); process.exit(1); }

const version = (/\(Wireshark\) ([0-9.]+)/.exec(
  execFileSync('tshark', ['--version'], { encoding: 'utf8' })) || [])[1] || 'unknown';

const slug = s => s.replace(/^-+/, '').replace(/[^a-zA-Z0-9]+/g, '-');

const GROUPS = {
  'Capture interface': 'capture',
  'Capture display': 'capture',
  'Capture stop conditions': 'capture',
  'Capture output': 'capture',
  'Input file': 'input',
  'Processing': 'processing',
  'Output': 'output',
  'Diagnostic output': 'diagnostics',
  'Miscellaneous': 'misc',
};

function takesFor(arg, desc) {
  if (!arg) return 'none';
  const head = (arg.toLowerCase().match(/^[a-z][a-z0-9 _-]*/) || [arg.toLowerCase()])[0].trim();
  if (/file|outfile|infile|path/.test(head)) return 'path';
  if (/interface|iface/.test(head)) return 'host';
  if (/\bport\b/.test(head)) return 'port';
  if (/count|size|length|snaplen|num|level|seconds|interval|depth/.test(head)) return 'int';
  return 'string';
}

const lines = readFileSync(HELP, 'utf8').split('\n');
const flags = new Map();
let group = 'misc';

/* tshark's help has at least four shapes for one option, and a single regex
   that handles all of them is a regex nobody can check. Split the line into a
   SPEC and a DESCRIPTION at the first run of two spaces, then read the spec:

     -i <interface>, --interface <interface>   short and long, arg in brackets
     -p, --no-promiscuous-mode                 short and long, no arg
     -T pdml|ps|psml|json|...                  arg is a pipe-separated SET
     -E<fieldsoption>=<value>                  arg attached with no space
     --export-objects <protocol>,<destdir>     one arg containing a comma

   The description is on the same line, or on the next one indented past the
   spec column. */
const FLAGTOK = /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*/;

for (let i = 0; i < lines.length; i++) {
  const sec = lines[i].match(/^([A-Z][A-Za-z /]+):\s*$/);
  if (sec) { group = GROUPS[sec[1].trim()] ?? 'misc'; continue; }
  if (!/^ {2}-/.test(lines[i])) continue;

  const body = lines[i].slice(2);
  /* Normally a run of two spaces separates the spec from the description.
     One line uses a SINGLE space — "-E<fieldsoption>=<value> set options for
     output" — so the whole line read as the spec and -E was lost. tshark's
     descriptions start with a lowercase word or a capital sentence, never with
     '<' or '|', so a single space before a word is the separator too. */
  /* Where the spec ends and the description begins.
     Usually a run of two spaces. One line uses a SINGLE space
     ("-E<fieldsoption>=<value> set options for output"), so a single space
     counts too — but only outside angle brackets and only when what follows
     is prose. Without those two conditions the split landed inside an
     argument: "-a <autostop cond.> ..., --autostop ..." broke at the space
     before "cond.", which threw away the --autostop spelling along with six
     other long forms. */
  function specEnd(line) {
    const two = line.search(/\s{2,}/);
    let depth = 0;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (ch === '<' || ch === '[') depth++;
      else if (ch === '>' || ch === ']') depth = Math.max(0, depth - 1);
      else if (ch === ' ' && depth === 0) {
        const next = line.slice(k + 1).match(/^\S+/);
        if (!next) continue;
        const w = next[0];
        /* still part of the spec: another spelling, another argument, an
           alternation, or tshark's "..." meaning "repeatable" */
        if (/^[-<[]/.test(w) || w.includes('|') || /^\.{2,}/.test(w) || /^,/.test(w)) continue;
        return two === -1 ? k : Math.min(two, k);
      }
    }
    return two;
  }
  let gap = specEnd(body);
  let spec = (gap === -1 ? body : body.slice(0, gap)).trim();
  let desc = (gap === -1 ? '' : body.slice(gap).trim());
  if (!desc && /^ {20,}\S/.test(lines[i + 1] || '')) desc = lines[i + 1].trim();
  if (!desc) continue;

  /* Every flag spelling in the spec, and whatever is left is the argument. */
  const spellings = [];
  let restSpec = spec;
  for (const part of spec.split(/,\s+(?=-)/)) {
    const m = part.match(FLAGTOK);
    if (m) spellings.push(m[0]);
  }
  if (!spellings.length) continue;

  /* The argument: what follows the FIRST spelling, with any later spelling and
     its own copy of the argument removed. */
  const firstPart = spec.split(/,\s+(?=-)/)[0];
  let arg = firstPart.slice(spellings[0].length).trim() || null;
  if (arg) arg = arg.replace(/^[<\[]|[>\]]$/g, '').trim() || null;

  let def = null;
  const dm = desc.match(/\(def:\s*([^)]*)\)\s*$/i);
  if (dm) { def = dm[1].trim(); desc = desc.replace(/\s*\(def:\s*[^)]*\)\s*$/i, '').trim(); }

  const short = spellings.find(x => !x.startsWith('--')) || null;
  const long = spellings.find(x => x.startsWith('--')) || null;
  const token = short || long;
  const id = slug(token);
  if (flags.has(id)) continue;

  /* "pdml|ps|psml|json|..." is a closed set tshark prints inline. The trailing
     "?" is tshark's "list them for me", not a value. */
  let enumVals = null;
  if (arg && /^[A-Za-z0-9?]+(\|[A-Za-z0-9?]+)+$/.test(arg)) {
    enumVals = arg.split('|').map(v => v.trim()).filter(v => v && v !== '?');
  }

  flags.set(id, {
    id,
    short: token,
    long: (short && long) ? long : null,
    takes: enumVals ? 'enum' : takesFor(arg, desc),
    enum: enumVals,
    enumEnforced: enumVals ? true : undefined,
    binds: id === 'r' ? 'capture' : (id === 'i' ? 'iface' : null),
    required: false,
    repeatable: false,
    default: def,
    group,
    desc,
    help: '',
    warn: null,
    note: null,
    conflicts: [],
    requires: [],
    since: null,
    source: 'help',
  });
}

/* The man page carries options `tshark -h` does not print — --print-timers is
   one. The help is the better source for everything it covers (grouped, with
   defaults), so the man page is read only for what the help omits. */
const manLines = readFileSync(MAN, 'utf8').split('\n');
let fromMan = 0;
for (let i = 0; i < manLines.length; i++) {
  const m = manLines[i].match(/^ {5}(--[A-Za-z0-9][A-Za-z0-9-]*)(?:\s+<?([a-z][\w ]*)>?)?\s*$/);
  if (!m) continue;
  const id = slug(m[1]);
  if (flags.has(id)) continue;

  const body = [];
  for (let j = i + 1; j < manLines.length && body.join(' ').length < 300; j++) {
    if (/^ {5}\S/.test(manLines[j])) break;
    if (/^\s*$/.test(manLines[j])) { if (body.length) break; continue; }
    body.push(manLines[j].trim());
  }
  const desc = (body.join(' ').match(/^.*?\.(?:\s|$)/) || [body.join(' ')])[0].trim();
  if (!desc) continue;

  flags.set(id, {
    id, short: m[1], long: null, takes: takesFor(m[2] || null, desc), enum: null,
    binds: null, required: false, repeatable: false, default: null, group: 'misc',
    desc: desc.slice(0, 160), help: '', warn: null, note: null,
    conflicts: [], requires: [], since: null, source: 'man',
  });
  fromMan++;
}

const list = [...flags.values()].sort((a, b) => a.group.localeCompare(b.group) || a.id.localeCompare(b.id));
for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.get(aid);
  if (f) f.alternatives = alts.filter(a => flags.has(a.id));
}

const tool = {
  id: 'tshark',
  name: 'tshark',
  summary: 'Wireshark on the command line: capture packets, or read a capture and pull it apart.',
  category: 'traffic',
  manual: MAN,
  helpCommand: 'tshark -h',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{ id: 'default', name: '', summary: 'Capture or read packets.', flags: list.map(f => f.id) }],
  inputs: [
    { id: 'capture', label: 'Capture file', placeholder: '/path/to/capture.pcapng',
      help: 'A file to read with -r. Leave it empty and tshark captures live instead, which needs root.' },
    { id: 'iface', label: 'Interface', placeholder: 'en0',
      help: 'Which interface to capture on. Run tshark -D to list them.' },
  ],
  flags: list,
  recipes,
};

for (const i of tool.inputs || []) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
console.log(`extract-tshark: ${list.length} flags -> ${OUT} (tshark ${version}), ${fromMan} of them man-only`);

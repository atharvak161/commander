#!/usr/bin/env node
/**
 * nmap -> data/tools/nmap.json
 *
 * nmap is not ffuf. Three things make it harder, and each is handled explicitly.
 *
 * 1. `-h` is a SUMMARY. nmap says so itself and points at the man page. The help
 *    documents 98 flags, the man page 160. So both are read: help gives the
 *    grouping and the short description, man gives the rest and the longer prose.
 *    Every flag records which source it came from.
 *
 * 2. The help PACKS flags together, in five different shapes:
 *       -sS/sT/sA/sW/sM: TCP SYN/Connect()/ACK/Window/Maimon scans
 *       -PE/PP/PM: ICMP echo, timestamp, and netmask request discovery probes
 *       -n/-R: Never do DNS resolution/Always resolve
 *       -f; --mtu <val>: fragment packets (optionally w/given MTU)
 *       -g/--source-port <portnum>: Use given port number
 *    The first three are SEPARATE flags sharing a line; the last is ONE flag
 *    with a short and a long spelling; `-f; --mtu` is two flags that do not even
 *    take the same arguments. Reading any of these as a single token would be
 *    wrong in a different way each time.
 *
 * 3. THE TEXT PROPOSES, THE BINARY DECIDES. Neither document is authoritative:
 *    the man page's prose mentions `-oG-` and `-d9` as examples, which are not
 *    flags, and the help's packed forms hide real ones. So every candidate is
 *    put to nmap itself and dropped unless it is accepted. See tools/probe-nmap.mjs.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const HELP = 'data/manuals/nmap.help.txt';
const MAN  = 'data/manuals/nmap.txt';
const OUT  = 'data/tools/nmap.json';

for (const f of [HELP, MAN]) {
  if (!existsSync(f)) { console.error(`missing ${f}. Run: nmap -h > ${HELP} && man nmap | col -bx > ${MAN}`); process.exit(1); }
}

const version = (/Nmap version ([0-9.]+)/.exec(execFileSync('nmap', ['--version'], { encoding: 'utf8' })) || [])[1] || 'unknown';

const GROUPS = {
  'TARGET SPECIFICATION': 'target',
  'HOST DISCOVERY': 'discovery',
  'SCAN TECHNIQUES': 'scan',
  'PORT SPECIFICATION AND SCAN ORDER': 'ports',
  'SERVICE/VERSION DETECTION': 'version',
  'SCRIPT SCAN': 'script',
  'OS DETECTION': 'os',
  'TIMING AND PERFORMANCE': 'timing',
  'FIREWALL/IDS EVASION AND SPOOFING': 'evasion',
  'OUTPUT': 'output',
  'MISC': 'misc',
};

function slug(flag) { return flag.replace(/^-+/, '').replace(/[^a-zA-Z0-9]+/g, '-'); }

/* A value's type, from the name nmap gives the argument.
   Ordered, and anchored on word boundaries. A loose /ip/ substring matched
   "Lua scripts" and typed --script as a hostname; "num hosts" has to read as a
   count, not a host; and a MAC address is not an address in this sense. Order
   and boundaries do the work, so each rule can stay simple. */
function takesFor(arg, desc) {
  if (!arg) return 'none';
  const a = arg.toLowerCase();

  if (/\bmac\b/.test(a)) return 'string';                       // before \baddr
  if (/\bnum\b|number of|\bhow many\b/.test(a)) return 'int';   // before \bhost ("num hosts")
  if (/file|filename|basename|dirname|\bpath\b|directory/.test(a)) return 'path';
  if (/\bport/.test(a)) return 'port';
  if (/\burl\b/.test(a)) return 'url';
  if (/\bhost|\btarget|iface|interface|\bserv|\baddr|\bip\b|zombie|relay/.test(a)) return 'host';
  if (/level|size|tries|\bval\b|ratio|\brate\b|count|\btime|\bsec\b|\blen|\bttl\b|\bmtu\b|probes|retries/.test(a)) return 'int';
  return 'string';
}

const flags = new Map();   // id -> flag object
function add(token, { arg = null, desc = '', group = 'misc', source, long = null }) {
  const id = slug(token);
  const prev = flags.get(id);
  if (prev) {
    /* Keep the richer description, and never lose a group that help supplied. */
    if (desc && desc.length > (prev.desc || '').length) prev.desc = desc;
    if (group !== 'misc' && prev.group === 'misc') prev.group = group;
    if (arg && prev.takes === 'none') prev.takes = takesFor(arg, desc);
    if (long && !prev.long) prev.long = long;
    if (source && prev.source !== source) prev.source = 'help+man';
    return prev;
  }
  const f = {
    id,
    short: token,
    long,
    takes: takesFor(arg, desc),
    enum: null,
    binds: null,
    required: false,
    repeatable: false,
    default: null,
    group,
    desc: desc.trim(),
    help: '',
    warn: null,
    note: null,
    conflicts: [],
    requires: [],
    since: null,
    source,
  };
  flags.set(id, f);
  return f;
}

/* ---------------------------------------------------------------- help ---- */
/* nmap wraps long help entries onto deeper-indented continuation lines:
       -oN/-oX/-oS/-oG <file>: Output scan in normal, XML, s|<rIpt kIddi3,
          and Grepable format, respectively, to the given filename.
   Reading only the first line truncated four output flags mid-sentence and left
   --min-rtt-timeout describing itself as "Specifies". Join them first. */
const helpLines = [];
for (const raw of readFileSync(HELP, 'utf8').split('\n')) {
  const isEntry = /^\s{2}-/.test(raw);
  const isCont  = /^\s{4,}\S/.test(raw) && !isEntry;
  if (isCont && helpLines.length && /^\s{2}-/.test(helpLines[helpLines.length - 1])) {
    helpLines[helpLines.length - 1] += ' ' + raw.trim();
  } else helpLines.push(raw);
}

let group = 'misc';
for (const raw of helpLines) {
  const sec = raw.match(/^([A-Z][A-Z/ ]+):\s*$/);
  if (sec) { group = GROUPS[sec[1].trim()] ?? 'misc'; continue; }

  const m = raw.match(/^\s{2}(-{1,2}\S.*?):\s+(.+?)\s*$/);
  if (!m) continue;
  let [, spec, desc] = m;

  /* "-f; --mtu <val>" — two flags on one line, and they differ: -f takes
     nothing, --mtu takes a value. Split on ';' and treat each half alone. */
  for (let half of spec.split(/;\s*/)) {
    /* Pull the value spec off: "<file>", "[portlist]", "<0-5>".
       Cut at the FIRST bracket rather than matching a balanced pair at the end.
       nmap nests them — "--dns-servers <serv1[,serv2],...>" has a ']' inside
       the '<>' and a ",..." after it — so a [^>\]]+ pair never matched and the
       whole spec stayed glued to the token. The probe caught all three. */
    /* nmap writes some long options as "--script=<Lua scripts>". The '=' is
       notation for "this takes a value", not part of the name: leaving it on
       produced a flag literally called "--script=" and lost --script entirely,
       along with --script-args, --script-args-file and --script-help. */
    half = half.replace(/=(?=\s*[<\[])/, ' ').replace(/=(?=[A-Za-z])/, ' ');
    const bi = half.search(/[<\[]/);
    let arg = bi === -1 ? null
      : half.slice(bi).replace(/^[<\[]+/, '').replace(/[>\]]*[.,\s]*$/, '').trim() || null;
    let tokens = (bi === -1 ? half : half.slice(0, bi)).trim();

    /* "--script-args-file filename" — a value named without brackets, left over
       from the '=' form. Anything after the flag token is the value name. */
    const bare = tokens.match(/^(\S+)\s+(\S.*)$/);
    if (bare && !arg) { tokens = bare[1]; arg = bare[2]; }

    /* "-g/--source-port" is ONE flag with two spellings; "-PE/PP/PM" is three
       separate flags. The difference: a '/' followed by '-' starts a new flag
       only when both sides are full flags of the same kind. nmap writes an
       alias as short/long, and siblings as short/short-without-dash. */
    const parts = tokens.split('/').map(s => s.trim()).filter(Boolean);
    if (!parts.length) continue;

    const lead = parts[0];
    const dash = lead.startsWith('--') ? '--' : '-';

    /* An alias pair: "-g/--source-port". */
    if (parts.length === 2 && dash === '-' && parts[1].startsWith('--')) {
      add(lead, { arg, desc, group, source: 'help', long: parts[1] });
      continue;
    }

    /* "-T<0-5>" is six flags, not one. */
    if (lead === '-T' && arg && /^(\d)-(\d)$/.test(arg)) {
      const [, lo, hi] = /^(\d)-(\d)$/.exec(arg);
      for (let n = +lo; n <= +hi; n++) {
        add(`-T${n}`, { desc: `${desc} (template ${n})`, group, source: 'help' });
      }
      continue;
    }

    /* Two different things are written with a slash, and nmap distinguishes
       them by whether the dash is repeated:

         -sS/sT/sA/sW/sM   siblings of one family. The description is one
                           sentence with the alternatives inside it:
                           "TCP SYN/Connect()/ACK/Window/Maimon scans".
         -n/-R             independent flags that happen to be opposites. The
                           description is two whole clauses:
                           "Never do DNS resolution/Always resolve".

       Treating the second as the first corrupted both: -n came out as "Never do
       DNS resolution resolve [default: sometimes]". So siblings get the shared
       head and tail rebuilt around each alternative, and independent flags get
       their own clause verbatim. */
    const siblings = parts.length > 1 && parts.slice(1).every(p => !p.startsWith('-'));
    const descParts = desc.split('/');
    const aligned = parts.length > 1 && descParts.length === parts.length;

    parts.forEach((p, i) => {
      const token = p.startsWith('-') ? p : dash + p;
      let d = desc;
      if (aligned) d = siblings ? rebuild(desc, descParts, i) : descParts[i].trim();
      add(token, { arg, desc: d, group, source: 'help' });
    });
  }
}

/* "TCP SYN/Connect()/ACK/Window/Maimon scans" + index 2 -> "TCP ACK scans".
   The shared head and tail stay; only the alternative in the middle changes. */
function rebuild(desc, parts, i) {
  const head = parts[0].replace(/\S+$/, '');            // "TCP "
  const tail = (parts[parts.length - 1].match(/\s.*$/) || [''])[0];  // " scans"
  let mid = parts[i];
  if (i === 0) mid = parts[0].slice(head.length);
  if (i === parts.length - 1) mid = parts[i].slice(0, parts[i].length - tail.length);
  return (head + mid + tail).replace(/\s+/g, ' ').trim();
}

/* ----------------------------------------------------------------- man ---- */
/* Option paragraphs are indented five spaces and the line ENDS after the flag
   spec, optionally followed by a balanced parenthetical. Anchoring the end is
   what keeps prose out: the man page has lines like
       "-PE -PS443 -PA80 -PP options. The exceptions to this are the ARP (for"
   which start the same way but run on. */
const MAN_LINE = /^ {5}(-{1,2}[A-Za-z][A-Za-z0-9_-]*(?:[;,]\s*-{1,2}[A-Za-z][A-Za-z0-9_-]*)*)((?:\s+[a-z][A-Za-z0-9_ ,\[\]|-]*?)?)\s*(?:\(([^()]*)\))?\s*$/;

/* An option's parenthetical can wrap onto the next line:
       --max-os-tries (Set the maximum number of OS detection tries against a
           target)
   Requiring a balanced "(...)" on one line skipped six real entries, and lost
   --max-os-tries entirely along with -T's NAMED timing templates. Join an
   unclosed parenthetical with the line that finishes it before matching. */
const rawMan = readFileSync(MAN, 'utf8').split('\n');
const manLines = [];
for (let i = 0; i < rawMan.length; i++) {
  let l = rawMan[i];
  if (/^ {5}-{1,2}\S/.test(l) && (l.match(/\(/g) || []).length > (l.match(/\)/g) || []).length) {
    while (i + 1 < rawMan.length && (l.match(/\(/g) || []).length > (l.match(/\)/g) || []).length) {
      l += ' ' + rawMan[++i].trim();
    }
  }
  manLines.push(l);
}
for (let i = 0; i < manLines.length; i++) {
  const m = manLines[i].match(MAN_LINE);
  if (!m) continue;
  const [, spec, argRaw, paren] = m;
  const arg = (argRaw || '').trim() || null;
  let desc = (paren || '').trim();

  /* Six options carry no "(Short description)" — their explanation is only in
     the indented body below. An empty desc is a hole in the interface, so take
     the body's first sentence. */
  if (!desc) {
    const body = [];
    for (let j = i + 1; j < manLines.length && body.join(' ').length < 400; j++) {
      const l = manLines[j];
      if (/^\s*$/.test(l)) { if (body.length) break; continue; }
      if (!/^\s{7,}\S/.test(l)) break;
      body.push(l.trim());
    }
    const joined = body.join(' ');
    const stop = joined.search(/\.\s|\.$/);
    desc = (stop === -1 ? joined : joined.slice(0, stop + 1)).trim();
  }

  for (const tok of spec.split(/[;,]\s*/)) {
    add(tok.trim(), { arg, desc, group: 'misc', source: 'man' });
  }
}

/* Relationships nmap states in an ERROR rather than in its help, found by
   running it: "You cannot use -F (fast scan) or -p (explicit port selection)
   when not doing a port scan". -sL and -sn are the no-port-scan modes.

   Deliberately only these four edges. Scan types are NOT blanket-exclusive —
   nmap accepts -sL together with -sn — so inventing a rule like "one scan type
   at a time" would block valid commands. */
const OBSERVED_CONFLICTS = [['p', 'sL'], ['p', 'sn'], ['F', 'sL'], ['F', 'sn']];
for (const [a, b] of OBSERVED_CONFLICTS) {
  const fa = flags.get(a), fb = flags.get(b);
  if (!fa || !fb) continue;
  if (!fa.conflicts.includes(b)) fa.conflicts.push(b);
  if (!fb.conflicts.includes(a)) fb.conflicts.push(a);
}

/* The one piece of nmap syntax people reach for most and the help never spells
   out: the value "-" means every port. "-p-" in the wild is just -p with "-"
   as its value, which is why there is no separate -p- flag to pick. */
const PORT_HELP = 'Takes a range, a list, or "-" on its own for all 65535 ports. '
  + 'The familiar "-p-" is this flag with "-" as its value, so type a single dash here. '
  + 'Other forms: 22 / 1-1000 / 80,443,8080 / U:53,T:21-25 to mix protocols.';
if (flags.get('p')) flags.get('p').help = PORT_HELP;

/* -T has two spellings. The help shows "-T<0-5>", which expands to the six
   numeric flags above; the man page shows
   "-T paranoid|sneaky|polite|normal|aggressive|insane", which nmap also accepts
   and which is far more readable in a saved command. Both are real, so both are
   offered. Verified: all six names are accepted. */
/* -T0 and -T1 wait minutes between probes. A scan at -T0 can take days, and
   someone picking it from a button deserves to be told. */
const SLOW_TEMPLATES = { T0: 'paranoid', T1: 'sneaky' };
for (const [id] of Object.entries(SLOW_TEMPLATES)) {
  const f = flags.get(id);
  if (f) { f.warn = 'slow'; f.note = 'Waits minutes between probes. A full scan at this template can take days.'; }
}

const T_NAMES = ['paranoid', 'sneaky', 'polite', 'normal', 'aggressive', 'insane'];
const tExisting = flags.get('T');
if (tExisting) {
  /* The man pass already created -T from "-T paranoid|sneaky|..." but typed it
     as free text. The six names ARE the whole set, so make it a picker. */
  tExisting.takes = 'enum';
  tExisting.enum = T_NAMES;
  tExisting.default = tExisting.default || 'normal';
  tExisting.group = 'timing';
  tExisting.help = 'The same six templates as -T0 through -T5, in the order above: -T paranoid is -T0, '
    + '-T insane is -T5. The names are easier to read back in a saved command.';
} else {
  flags.set('T', {
    id: 'T', short: '-T', long: null, takes: 'enum', enum: T_NAMES, binds: null,
    required: false, repeatable: false, default: 'normal', group: 'timing',
    desc: 'Set a timing template by name. Higher is faster and noisier.',
    help: 'The same six templates as -T0 through -T5, in the order above: -T paranoid is -T0, -T insane is -T5. '
        + 'The names are easier to read back in a saved command.',
    warn: null, note: null, conflicts: [], requires: [], since: null, source: 'man',
  });
}

/* Spellings nmap still accepts and warns about. People copy them out of older
   walkthroughs, so a builder that cannot express them sends you to the terminal
   to hand-edit — and nmap names the replacement itself, which is worth showing. */
/* -4 is accepted by nmap and documented NOWHERE — not in -h, not in the man
   page's option list. It is the counterpart of -6 and forces IPv4, and people
   use it. Found by probing the single-character space rather than by reading,
   which is why tools/coverage.mjs now probes all 62. */
if (!flags.has('4')) {
  flags.set('4', {
    id: '4', short: '-4', long: null, takes: 'none', enum: null, binds: null,
    required: false, repeatable: false, default: null, group: 'misc',
    desc: 'Scan IPv4 addresses only. The counterpart of -6, and the default.',
    help: 'nmap accepts this but documents it in neither its help nor its man page.',
    warn: null, note: null, conflicts: ['6'], requires: [], since: null, source: 'observed',
  });
  const six = flags.get('6');
  if (six && !six.conflicts.includes('4')) six.conflicts.push('4');
}

const DEPRECATED = [
  ['-sP', 'sn', 'discovery', 'Ping scan. Deprecated spelling of -sn.'],
  ['-P0', 'Pn', 'discovery', 'Skip host discovery. Deprecated spelling of -Pn.'],
  ['-PN', 'Pn', 'discovery', 'Skip host discovery. Deprecated spelling of -Pn.'],
  ['-sR', 'sV', 'version',   'RPC scan. Now an alias for -sV, which it also activates.'],
];
for (const [tok, modern, group, desc] of DEPRECATED) {
  const id = slug(tok);
  if (flags.has(id)) continue;
  const m = flags.get(modern);
  flags.set(id, {
    id, short: tok, long: null, takes: 'none', enum: null, binds: null,
    required: false, repeatable: false, default: null, group,
    desc, help: '',
    warn: 'deprecated',
    note: `nmap prints "The ${tok} option is deprecated. Please use -${modern}" and carries on. Prefer -${modern}.`,
    conflicts: [], requires: [], since: null, source: 'observed',
  });
}

/* ------------------------------------------------------------- assemble --- */
/* Group order follows nmap's own help, not the alphabet. nmap presents its
   options in the order you actually use them — what to scan, how to find it,
   how to scan it, then output and odds and ends. Sorting alphabetically put
   MISC third and TARGET ninth, which reads as noise. */
const GROUP_ORDER = [...new Set(Object.values(GROUPS))];
const rank = g => { const i = GROUP_ORDER.indexOf(g); return i === -1 ? GROUP_ORDER.length : i; };
const list = [...flags.values()].sort((a, b) => rank(a.group) - rank(b.group) || a.id.localeCompare(b.id));

const tool = {
  id: 'nmap',
  name: 'nmap',
  summary: 'Network mapper: host discovery, port scanning, service and OS detection.',
  category: 'enumeration',
  manual: MAN,                    // a path: the page fetches it, so the 3,000-line
                                  // man page never rides along in the JSON

  helpCommand: 'nmap -h',
  provenance: {
    toolVersion: version,
    source: 'help+man',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [{ id: 'default', name: '', summary: 'Scan the given targets.', flags: list.map(f => f.id) }],
  inputs: [
    {
      id: 'target',
      label: 'Target',
      placeholder: '10.10.10.10  or  scanme.nmap.org  or  192.168.1.0/24',
      trailing: true,
      required: true,
      /* -iL reads targets from a file and -iR generates them, so a target on
         the command line is not required when either is picked. */
      requiredUnless: ['iL', 'iR'],
      help: 'Hosts, ranges or CIDR blocks. nmap takes these as bare arguments at the end, not behind a flag.',
    },
  ],
  flags: list,
  recipes: [],
};

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
console.log(`extract-nmap: ${list.length} flags -> ${OUT} (nmap ${version})`);
const bySrc = list.reduce((a, f) => (a[f.source] = (a[f.source] || 0) + 1, a), {});
console.log('  by source:', bySrc);

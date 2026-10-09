#!/usr/bin/env node
/**
 * gobuster -> data/tools/gobuster.json
 *
 * gobuster is the first tool here with real MODES. `dir`, `vhost`, `dns`,
 * `fuzz`, `tftp`, `s3` and `gcs` are subcommands, each with its own option set,
 * and the mode name is a literal argument: `gobuster dir -u ... -w ...`.
 *
 * Most options are shared, so one entry per mode-and-flag would duplicate the
 * 56 common ones seven times. But four flags genuinely MEAN different things
 * depending on the mode — --timeout defaults to 10s for HTTP, 1s for DNS and
 * TFTP; --domain is the target in dns but "the domain to append when using an
 * IP address as URL" in dir — and a single shared entry would hide that.
 *
 * So a flag is stored once, with a `perMode` override carrying only the fields
 * that actually differ. Nothing is duplicated and nothing is lost.
 *
 * Verification is safe: gobuster prints its help and exits when given no
 * target, so every flag parses with no packets sent.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/gobuster.mjs';

const OUT = 'data/tools/gobuster.json';
const MODES = [
  ['dir',   'Directory and file enumeration over HTTP.'],
  ['vhost', 'Virtual host enumeration. Point it at the IP, not the name.'],
  ['dns',   'DNS subdomain enumeration.'],
  ['fuzz',  'Fuzzing. Replaces the FUZZ keyword in the URL, headers or body.'],
  ['tftp',  'TFTP file enumeration.'],
  ['s3',    'AWS S3 bucket enumeration.'],
  ['gcs',   'Google Cloud Storage bucket enumeration.'],
];

const version = (/\b(\d+\.\d+\.\d+)\b/.exec(
  execFileSync('gobuster', ['--help'], { encoding: 'utf8' })) || [])[1] || 'unknown';

const slug = s => s.replace(/^-+/, '').replace(/[^a-zA-Z0-9]+/g, '-');

function takesFor(name, desc, hasValue) {
  if (!hasValue) return 'none';
  const h = `${name} ${desc}`.toLowerCase();
  /* Numbers are tested BEFORE hosts. "DNS resolver timeout" contains
     "resolver" and came out as a hostname; a duration is not a host. Same trap
     as nmap's loose /ip/, which matched "Lua scripts". */
  if (/timeout|delay|threads|\bnumber\b|times|offset|length|size|\bmax\b|retry|attempts|depth|codes/.test(h)) return 'int';
  if (/wordlist|\bfile\b|\bpath\b|\.pem|p12|patterns|output/.test(h)) return 'path';
  if (/\burl\b|proxy/.test(h)) return 'url';
  if (/\bport\b/.test(h)) return 'port';
  if (/\bip\b|server|domain|interface|resolver/.test(h)) return 'host';
  return 'string';
}

/* One help line:
     --url value, -u value                                    The target URL
     --follow-redirect, -r                                    Follow redirects (default: false)
     --headers value, -H value [ --headers value, -H value ]  Specify HTTP headers, -H 'a: 1'
   The spec and the description are separated by two or more spaces. Splitting
   there FIRST matters, because descriptions contain brackets of their own:
   --proxy's reads "[http(s)://host:port] or [socks5://host:port]", and the
   bracket notation that marks a repeatable flag only appears in the spec. */
const LINE = /^ {3}(-{1,2}\S.*?)\s{2,}(\S.*)$/;

const byId = new Map();
const modeFlags = new Map();

for (const [mode] of MODES) {
  const help = execFileSync('gobuster', [mode, '--help'], { encoding: 'utf8' });
  const ids = [];

  for (const raw of help.split('\n')) {
    const m = raw.match(LINE);
    if (!m) continue;
    let [, spec, desc] = m;
    desc = desc.trim();

    /* urfave/cli marks a repeatable (slice) flag by printing the spec twice
       inside brackets. Only --headers has it. */
    const repeatable = /\s\[\s.*\s\]$/.test(spec);
    if (repeatable) spec = spec.replace(/\s\[\s.*\s\]$/, '');

    let def = null;
    const dm = desc.match(/\(default:\s*(.*?)\)\s*$/);
    if (dm) { def = dm[1].trim(); desc = desc.replace(/\s*\(default:\s*.*?\)\s*$/, '').trim(); }

    const tokens = spec.split(',').map(t => t.trim()).filter(Boolean);
    const hasValue = tokens.some(t => /\svalue$/.test(t));
    const names = tokens.map(t => t.replace(/\svalue$/, '').trim());
    const long = names.find(n => n.startsWith('--')) || names[0];
    const short = names.find(n => n !== long) || null;
    const id = slug(long);
    if (id === 'help') continue;              // prints help and exits

    ids.push(id);
    const takes = takesFor(long, desc, hasValue);
    const entry = { desc, default: def, takes, binds: null, required: false };

    if (!byId.has(id)) byId.set(id, { id, long, short, repeatable, modes: {} });
    const f = byId.get(id);
    f.repeatable = f.repeatable || repeatable;
    f.modes[mode] = entry;
  }
  modeFlags.set(mode, ids);
}

/* What each mode cannot run without, established by running gobuster:
   every mode needs a wordlist, and the target flag differs — -u for dir, vhost
   and fuzz, --domain for dns, -s for tftp. s3 and gcs need only the wordlist.
   Without this the builder offered "gobuster dir" with Copy enabled, which is
   a command that only prints the help. */

/* Which flag is "the target" in each mode. The same box on the right serves
   all seven, which is the point of a constant input panel. --domain is the
   target in dns only; in dir and vhost it means something else entirely, so
   the binding has to be per-mode like the description. */
const TARGET_OF = { dir: 'url', vhost: 'url', fuzz: 'url', dns: 'domain', tftp: 'server' };
for (const [mode, flagId] of Object.entries(TARGET_OF)) {
  const f = byId.get(flagId);
  if (f && f.modes[mode]) { f.modes[mode].binds = 'target'; f.modes[mode].required = true; }
}
for (const f of byId.values()) {
  for (const [mode, e] of Object.entries(f.modes)) if (f.id === 'wordlist') { e.binds = 'wordlist'; e.required = true; }
}


/* gobuster's help has one copy-paste bug: --method carries the description of
   --client-cert-p12-password. Kept as a correction rather than silently shipped,
   because "the password to the p12 file" on the HTTP method field is worse than
   no description. The evidence is in the help itself: the flag is --method/-m,
   its default is "GET", and the string is verbatim another flag's. */
const CORRECTED = {
  method: {
    desc: 'HTTP method to use',
    note: "gobuster's own help gives this flag the description of --client-cert-p12-password. Corrected here; its default is GET.",
  },
};

/* Relationships in gobuster's own words: "Can't be used with interface" and
   "Can't be used with local-ip", each stated in five modes. */
function statedConflicts(desc, nameToId) {
  const out = [];
  for (const m of desc.matchAll(/can'?t be used with ([a-z0-9-]+)/gi)) {
    const id = nameToId.get(m[1]);
    if (id) out.push(id);
  }
  return out;
}
const nameToId = new Map([...byId.values()].map(f => [f.id, f.id]));

/* Collapse: fields identical in every mode live on the flag; the rest go in
   perMode. */
const flags = [];
for (const f of byId.values()) {
  const entries = Object.entries(f.modes);
  const pick = key => {
    const counts = new Map();
    for (const [, e] of entries) counts.set(JSON.stringify(e[key]), (counts.get(JSON.stringify(e[key])) || 0) + 1);
    return JSON.parse([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  };
  const base = { desc: pick('desc'), default: pick('default'), takes: pick('takes'), binds: pick('binds'), required: pick('required') };

  const perMode = {};
  for (const [mode, e] of entries) {
    const diff = {};
    for (const k of ['desc', 'default', 'takes', 'binds', 'required']) {
      if (JSON.stringify(e[k]) !== JSON.stringify(base[k])) diff[k] = e[k];
    }
    if (Object.keys(diff).length) perMode[mode] = diff;
  }

  const fix = CORRECTED[f.id] || {};
  flags.push({
    id: f.id,
    short: f.long,                 // gobuster's own preferred spelling is the long one
    long: f.short,                 // the short alias
    takes: base.takes,
    enum: null,
    binds: base.binds,
    required: base.required,
    repeatable: f.repeatable,
    default: base.default,
    group: 'options',
    desc: fix.desc || base.desc,
    help: '',
    warn: null,
    note: fix.note || null,
    conflicts: statedConflicts(base.desc, nameToId),
    requires: [],
    since: null,
    source: 'help',
    ...(Object.keys(perMode).length ? { perMode } : {}),
  });
}

/* Conflicts are symmetric. */
const byFlagId = new Map(flags.map(f => [f.id, f]));
for (const f of flags) {
  for (const c of f.conflicts) {
    const o = byFlagId.get(c);
    if (o && !o.conflicts.includes(f.id)) o.conflicts.push(f.id);
  }
}

flags.sort((a, b) => a.id.localeCompare(b.id));

/* Flags that do the same job, for a recipe's "or change it" list. */
const _byId = new Map(flags.map ? [] : []);
for (const [aid, alts] of Object.entries(alternatives)) {
  const f = (Array.isArray(flags) ? flags : [...flags.values()]).find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => (Array.isArray(flags) ? flags : [...flags.values()]).some(x => x.id === a.id));
}

const tool = {
  id: 'gobuster',
  name: 'gobuster',
  summary: 'Brute-force enumeration of directories, DNS subdomains, vhosts and buckets.',
  category: 'enumeration',
  manual: 'data/manuals/gobuster.txt',
  helpCommand: 'gobuster dir --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: MODES.map(([id, summary]) => ({ id, name: id, summary, flags: modeFlags.get(id) })),
  inputs: [
    { id: 'target', label: 'Target', placeholder: 'http://10.10.10.10/  or  example.com', help: 'Whatever the mode points at: a URL for dir, vhost and fuzz, a domain for dns, a server for tftp.' },
    { id: 'wordlist', label: 'Wordlist', placeholder: '/path/to/wordlist.txt', help: 'Path to the wordlist. gobuster also accepts - for stdin.' },
  ],
  flags,
  /* Curated, not parsed: which flags belong together for a job is a judgement
     no help text makes. Verified like any other command — tools/verify.mjs
     runs every recipe against the binary. */
  recipes,
};


/* The example values a recipe falls back to until the panel is filled in.
   Applied by id so the input literals stay about the input, not the examples. */
for (const i of tool.inputs || []) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
console.log(`extract-gobuster: ${flags.length} flags across ${MODES.length} modes -> ${OUT} (gobuster ${version})`);
console.log(`  per-mode overrides: ${flags.filter(f => f.perMode).map(f => f.short).join(', ') || 'none'}`);
console.log(`  conflicts: ${flags.filter(f => f.conflicts.length).map(f => f.short + '->' + f.conflicts).join(', ') || 'none'}`);
console.log(`  repeatable: ${flags.filter(f => f.repeatable).map(f => f.short).join(', ') || 'none'}`);

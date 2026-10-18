#!/usr/bin/env node
/**
 * openssl -> data/tools/openssl.json
 *
 * A LOCAL tool (OpenSSL 3.6.4), read from each subcommand's own `-help`.
 *
 * openssl is really fifty-odd sub-tools under one binary, so it is modelled the
 * way docker and gobuster are: one mode per subcommand, each mode's flags read
 * live from `openssl <cmd> -help`. The set below is the security-relevant
 * slice - TLS inspection, certificate and key work, and the crypto primitives -
 * not the whole catalogue. s_server (binds a port and blocks), the slow
 * parameter generators (dhparam/dsaparam/ecparam), speed (benchmarks), and the
 * engine/fips/deprecated commands are left out on purpose: they add little to a
 * reference and would stand up servers or grind for minutes during verification.
 *
 * Two things the parser has to get right:
 *   - the same flag token can mean different things in different subcommands
 *     (-in is a certificate in x509, a plain input file in enc), so a flag whose
 *     value KIND differs across modes carries a perMode override, exactly like
 *     gobuster. A difference of wording alone does not; a difference of arity or
 *     value set does.
 *   - `-*` ("any supported cipher") is a note, not a flag, and is dropped.
 *
 * Safe to probe: every subcommand validates its flags and answers
 * "Unknown option ..." for a bad one, before it does any work. verify.mjs runs
 * each with stdin closed so the stdin-reading subcommands (enc, dgst, x509) get
 * an immediate EOF instead of blocking, and pins s_client to a dead loopback
 * port so a valid flag cannot reach the network. (s_time is left out: it loops
 * connections for its full -time window, which would hang every probe.)
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples, trailing } from './recipes/openssl.mjs';

const OUT = 'data/tools/openssl.json';

/* The modelled subcommands, in a sensible reading order (TLS, then certs, then
   keys, then primitives, then containers). Each becomes a mode. */
const MODES = [
  { id: 's_client',  summary: 'Open a TLS/SSL connection to a server and show the certificate, chain and negotiated parameters.' },
  { id: 'ciphers',   summary: 'List the cipher suites a protocol or cipher string selects.' },
  { id: 'x509',      summary: 'Display, convert, sign and edit X.509 certificates.' },
  { id: 'req',       summary: 'Create and process certificate signing requests and self-signed certificates.' },
  { id: 'verify',    summary: 'Verify a certificate chain against trusted roots.' },
  { id: 'crl',       summary: 'Display and convert certificate revocation lists.' },
  { id: 'genrsa',    summary: 'Generate an RSA private key.' },
  { id: 'rsa',       summary: 'Display, convert and re-encrypt an RSA key.' },
  { id: 'pkey',      summary: 'Display and convert a private or public key of any algorithm.' },
  { id: 'pkeyutl',   summary: 'Sign, verify, encrypt, decrypt and derive with a key.' },
  { id: 'dgst',      summary: 'Hash a file, or compute an HMAC or a signature over it.' },
  { id: 'enc',       summary: 'Symmetric-cipher encrypt or decrypt, with base64 and a passphrase KDF.' },
  { id: 'mac',       summary: 'Compute a MAC (HMAC, CMAC, GMAC, KMAC, Poly1305).' },
  { id: 'passwd',    summary: 'Hash a password in crypt, MD5, SHA-256 or SHA-512 form.' },
  { id: 'rand',      summary: 'Emit cryptographically strong random bytes, in hex or base64.' },
  { id: 'prime',     summary: 'Test a number for primality, or generate a prime.' },
  { id: 'kdf',       summary: 'Derive a key with a KDF (HKDF, PBKDF2, scrypt, ...).' },
  { id: 'pkcs12',    summary: 'Build and parse PKCS#12 (.p12/.pfx) bundles of keys and certificates.' },
  { id: 'pkcs8',     summary: 'Convert private keys to and from PKCS#8 format.' },
  { id: 'asn1parse', summary: 'Dump the ASN.1 structure of a DER or PEM file.' },
];

function help(cmd) {
  try {
    return execFileSync('sh', ['-c', 'openssl "$1" -help 2>&1', '--', cmd],
      { encoding: 'utf8', timeout: 8000, maxBuffer: 1 << 20 });
  } catch (e) { return String(e.stdout || '') + String(e.stderr || ''); }
}

const version = (() => {
  try { return (/OpenSSL\s+([0-9][\w.]*)/.exec(execFileSync('openssl', ['version'], { encoding: 'utf8' })) || [])[1] || 'unknown'; }
  catch { return 'unknown'; }
})();

/* " -flag", " -flag metavar", " -flag PEM|DER|ENGINE", " -flag +int" then 2+
   spaces then the description. The metavar is one whitespace-free token. */
const OPT = /^\s+(-[A-Za-z0-9*][\w.|-]*)(?:\s+(\S+))?\s{2,}(\S.*?)\s*$/;
const SECTION = /^([A-Za-z][\w /+-]*?)\s*:\s*$/;

/** Parse one subcommand's -help into a list of flag records. */
/* openssl's per-subcommand help is the authority on a flag's arity, with rare
   omissions. `prime -help` lists "-in" with no metavar, yet the binary opens
   the next argument as a file (`prime -in foo` -> "Error opening file foo"), so
   it takes a value. The binary decides: correct the few flags whose help omits
   their metavar. Each entry here was confirmed by running the real command. */
const ARITY_FIX = { prime: { in: 'path' } };

function parseMode(cmd) {
  const text = help(cmd);
  const out = [];
  let group = 'options';
  let inParams = false;
  for (const line of text.split('\n')) {
    const sm = line.match(SECTION);
    if (sm && !/^\s/.test(line)) {
      const name = sm[1].trim();
      if (/^Usage/i.test(name)) continue;
      inParams = /^Parameters$/i.test(name);
      group = name.replace(/\s*options$/i, '').trim().toLowerCase() || 'options';
      continue;
    }
    if (inParams) continue;                    // positionals, not flags
    const m = line.match(OPT);
    if (!m) continue;
    const tok = m[1];
    if (tok === '-*' || tok === '-') continue; // "any supported cipher" note
    const id = tok.replace(/^-/, '');
    if (id === 'help' || out.some(f => f.id === id)) continue;
    const mv = m[2] || null;
    let takes = 'none', en = null;
    if (ARITY_FIX[cmd] && ARITY_FIX[cmd][id]) takes = ARITY_FIX[cmd][id];
    else if (mv) {
      if (mv.includes('|')) { takes = 'enum'; en = mv.split('|').map(s => s.trim()).filter(Boolean); }
      else if (/^(infile|outfile)$/.test(mv) || /file$/i.test(mv)) takes = 'path';
      else takes = 'string';
    }
    out.push({ id, short: tok, takes, enum: en, desc: m[3].replace(/\s+/g, ' ').trim(), group });
  }
  return out;
}

/* Parse every mode, then fold the per-mode flag lists into one global flag
   table. A flag's base is its first appearance; a later mode that differs in
   arity (takes) or value set (enum) adds a perMode override carrying the
   differing fields plus that mode's wording. Wording-only differences keep the
   base: the tooltip is close enough and the JSON stays lean. */
const perModeLists = {};
for (const m of MODES) perModeLists[m.id] = parseMode(m.id);

const base = new Map();       // id -> base flag record
const perMode = new Map();    // id -> { modeId: overrideObj }

for (const m of MODES) {
  for (const f of perModeLists[m.id]) {
    if (!base.has(f.id)) {
      base.set(f.id, { id: f.id, short: f.short, takes: f.takes, enum: f.enum, desc: f.desc, group: f.group });
      continue;
    }
    const b = base.get(f.id);
    const enumDiff = JSON.stringify(b.enum) !== JSON.stringify(f.enum);
    if (b.takes !== f.takes || enumDiff) {
      if (!perMode.has(f.id)) perMode.set(f.id, {});
      perMode.get(f.id)[m.id] = { takes: f.takes, enum: f.enum, desc: f.desc };
    }
  }
}

const flags = [...base.values()].map(f => {
  const rec = {
    id: f.id, short: f.short, long: null,
    takes: f.takes, enum: f.enum,
    binds: null, required: false, repeatable: false, default: null,
    group: f.group, desc: f.desc,
    help: '', warn: null, conflicts: [], requires: [], since: null, source: 'help',
  };
  if (perMode.has(f.id)) rec.perMode = perMode.get(f.id);
  return rec;
}).sort((a, b) => a.id.localeCompare(b.id));

for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.find(x => x.id === aid);
  if (f) f.alternatives = alts.filter(a => flags.some(x => x.id === a.id));
}

const modes = MODES.map(m => ({
  id: m.id,
  name: m.id,
  summary: m.summary,
  usage: `openssl ${m.id} [options]${trailing[m.id] ? ' ' + trailing[m.id].usage : ''}`,
  flags: perModeLists[m.id].map(f => f.id),
}));

/* Trailing positionals, scoped to the modes that take them (genrsa numbits,
   ciphers cipherstring, prime number). Withheld during verification. */
const inputs = [];
for (const [mode, t] of Object.entries(trailing)) {
  inputs.push({
    id: t.id, label: t.label, kind: t.kind || 'string',
    placeholder: t.placeholder, help: t.help + ' Withheld during verification.',
    trailing: [mode],
    ...(examples[t.id] ? { example: examples[t.id] } : {}),
  });
}

const tool = {
  id: 'openssl',
  name: 'openssl',
  summary: 'The TLS and crypto multitool: inspect TLS services, read and convert certificates and keys, hash, encrypt and derive.',
  category: 'crypto',
  homepage: 'https://www.openssl.org/',
  manual: 'data/manuals/openssl.txt',
  helpCommand: 'openssl <command> -help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes,
  inputs,
  flags,
  recipes,
};

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
/* Keep one combined manual dump for the "view help" link. */
writeFileSync('data/manuals/openssl.txt',
  MODES.map(m => `=== openssl ${m.id} -help ===\n${help(m.id)}`).join('\n'));

const withOverride = flags.filter(f => f.perMode).length;
console.log(`extract-openssl: ${flags.length} unique flags across ${modes.length} modes -> ${OUT} (openssl ${version})`);
console.log(`  perMode overrides: ${withOverride}, enum flags: ${flags.filter(f => f.takes === 'enum').length}, ` +
            `path: ${flags.filter(f => f.takes === 'path').length}, boolean: ${flags.filter(f => f.takes === 'none').length}`);
console.log(`  biggest modes: ${modes.map(m => [m.id, m.flags.length]).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x.join(':')).join(', ')}`);

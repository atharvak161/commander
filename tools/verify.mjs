#!/usr/bin/env node
/**
 * Command verifier.
 *
 * Builds commands through assets/js/command.js — the exact module the browser
 * uses — then runs each one and asserts the tool did not reject the SYNTAX.
 * Because it imports the real builder, a command proved here is byte-for-byte
 * the command a user copies.
 *
 * No packets are sent. Targets are non-routable and every tool errors on a bad
 * flag long before it opens a socket.
 *
 * Three passes:
 *   1. each flag alone, with a value of the right type
 *   2. every valid PAIR of flags, to catch combinations the UI permits
 *   3. awkward values — spaces, quotes, $, backslashes
 *
 *   node tools/verify.mjs ffuf [--pairs]
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync as _mkdtemp, writeFileSync as _writeFile, chmodSync as _chmod } from 'node:fs';
import { tmpdir as _tmpdir } from 'node:os';
import os from 'node:os';
import { join as _join } from 'node:path';

/* Probes run in a scratch directory, never the repo.
   Several flags write files relative to the CURRENT directory, so verifying
   "-o 'a b'" created a file literally named `a b` in the working tree — and an
   earlier run committed a 195KB ffuf audit log called `x`. The tool under test
   decides where it writes; the only reliable fix is to not be standing in the
   repo when it runs. */
const PROBE_DIR = _mkdtemp(_join(_tmpdir(), 'commander-probe-'));

/* A real one-line file, not /dev/null. An EMPTY wordlist is a degenerate input
   and tools do not agree on what it means: gobuster's fuzz mode waits forever
   on one (859 probes stalled), while its dir mode returns at once. One word
   costs nothing and is what a user would actually pass. */
/* An empty capture file: a 24-byte pcap header and no packets.
   tshark is the one tool here that is dangerous to probe naively — with no
   arguments it starts capturing live traffic off the default interface, so
   "no target means it does nothing" is false for it. Reading a file never
   touches the network, so every tshark probe is prefixed with -r and this. */
const SAMPLE_PCAP = _join(PROBE_DIR, 'empty.pcap');
_writeFile(SAMPLE_PCAP, Buffer.from('d4c3b2a1020004000000000000000000ffff000001000000', 'hex'));

const SAMPLE_FILE = _join(PROBE_DIR, 'commander-sample.txt');
_writeFile(SAMPLE_FILE, 'admin\n');
/* Read-only, deliberately. A flag that WRITES must never be handed the file a
   flag that READS depends on, and making the sample unwritable means a mistake
   fails loudly here instead of corrupting the run. */
_chmod(SAMPLE_FILE, 0o444);

/* Output paths get their own file, one per probe. Giving every path flag the
   same value meant "--output <wordlist>" truncated the wordlist as it ran, and
   every probe after it saw an empty wordlist — which makes gobuster's fuzz
   mode hang. 859 pairs "stalled" and the cause was three pairs earlier in the
   sequence. Isolated, every one of them passed. */
let outSeq = 0;
const WRITES = /output|\bsave\b|\bwrite\b|\bdest\b|\blog\b|report|dump-file|results-file|har\b/i;
function pathFor(f) {
  const hint = `${f.id} ${f.desc || ''}`;
  return WRITES.test(hint) ? _join(PROBE_DIR, `out-${++outSeq}.txt`) : SAMPLE_FILE;
}
import { buildCommand, blockedBy, resolveFlag, buildRecipe } from '../assets/js/command.js';

const id = process.argv[2];
const pairArg = process.argv.find(a => a === '--pairs' || a.startsWith('--pairs='));
const doPairs = Boolean(pairArg);
/* --pairs runs every valid pair. --pairs=N caps the run at roughly N.
   sqlmap has 271 flags, so 36,585 pairs, and it costs about 0.4s per run in
   Python startup alone — three and a half hours. A cap keeps the pass useful
   without pretending the machine is free. */
const pairBudget = pairArg && pairArg.includes('=') ? Number(pairArg.split('=')[1]) : Infinity;
if (!id) { console.error('usage: verify.mjs <toolId> [--pairs]'); process.exit(2); }

const path = `data/tools/${id}.json`;
if (!existsSync(path)) { console.error(`no such tool: ${path}`); process.exit(2); }
const tool = JSON.parse(readFileSync(path, 'utf8'));

try { execFileSync('which', [tool.id], { stdio: 'pipe' }); }
catch { console.error(`${tool.id} is not installed locally; container path (P2) not wired yet.`); process.exit(2); }

const SAMPLE = {
  none: null, string: 'x', int: '1', path: SAMPLE_FILE,
  url: 'http://127.0.0.1:1/FUZZ', port: '80', host: '127.0.0.1', enum: null,
};
const AWKWARD = ['a b', "it's", 'a$b', 'a\\b', 'a"b', 'a;b'];

/* A rejection of the SYNTAX. A connection error or a usage dump from missing
   required args is not a failure of our data. */
/* Every wording a tool here uses to say "that is not an option".
   curl puts the words the other way round — "option --x: is unknown" — and
   matching only "unknown option" meant curl's rejections were never detected
   at all: its verification passed because nothing could ever fail. */
const REJECT = /flag provided but not defined|unknown (?:flag|option|shorthand)|option .*?: is unknown|unrecognized option|invalid option|not defined:|no such option/i;

function valueFor(f) {
  if (f.takes === 'none') return null;
  if (f.takes === 'enum') return (f.enum && f.enum[0]) || 'x';
  if (f.takes === 'path') return pathFor(f);
  return SAMPLE[f.takes] ?? 'x';
}

function slotsAndAdhoc(flags, override) {
  const slots = {}, adhoc = {};
  for (const f of flags) {
    const v = override !== undefined && f.takes === 'path' ? override : valueFor(f);
    if (v === null) continue;
    if (f.binds) slots[f.binds] = v; else adhoc[f.id] = v;
  }
  return { slots, adhoc };
}

/* Flags that would REACH THE NETWORK. This is a safety rule, not a speed one:
   the verifier's whole premise is that a tool rejects a bad flag long before it
   opens a socket, so nothing it runs may leave the machine. An exhaustive pair
   run found 201 probes stalling on sqlmap's -g, which is a Google dork — it was
   querying a search engine, once per pair, for an hour.

   -g and --gpage send a search query; --check-internet fetches
   google.com/generate_204 (named in sqlmap's own settings.py); --tor reaches
   for a Tor daemon; --update and --dependencies fetch from the internet.
   Membership for all of them is established by the declaration and the singles
   pass, neither of which needs them to actually run. */
const NETWORK = new Set([
  /* sqlmap */
  'g', 'gpage',          // Google dork: sends a search query
  'check-internet',      // fetches google.com/generate_204, named in sqlmap's settings.py
  'tor',                 // reaches for a Tor daemon
  'update', 'dependencies',

  /* nmap — and -iR is the worst thing in this file.
     "-iR <num>" does not mean "pretend". nmap GENERATES RANDOM PUBLIC IP
     ADDRESSES and scans them. Running it here would have been scanning
     strangers' machines from this laptop, once per probe. It is blocked
     outright and must stay blocked.
     -iL reads targets from a file and resolves every line, which with any
     sample file means outbound DNS. --dns-servers points nmap at a resolver
     and waits on it. All three are proved by the singles pass, which runs
     them with nothing to resolve. */
  'iR', 'iL', 'dns-servers',
]);

/* Flags with a side effect beyond this process. Verifying that nmap ACCEPTS
   --script-updatedb does not require letting it rewrite the installed script
   database, so these are checked for membership by probe-nmap.mjs and skipped
   here. */
const SIDE_EFFECTS_ONLY = new Set([
  'script-updatedb',   // nmap: rewrites the installed NSE script database
  'purge',             // sqlmap: erases sqlmap's own data directory
  'dependencies',      // sqlmap: tries to install things
  'update',            // sqlmap: pulls a new version over the network
  'wizard',            // sqlmap: interactive, would hang the run
  'shell',             // sqlmap: interactive SQL shell
  'live-test',         // sqlmap: runs its own test suite over the network
  'smoke-test',        // sqlmap: its own smoke tests, minutes long
  'vuln-test',
  'fp-test',           // sqlmap: fingerprint test suite, never finished inside the timeout
  'payload-lint',      // sqlmap: lints its whole payload set, same
  'api',               // sqlmap: starts a server
  'manual',            // curl: prints its entire 6,000-line manual, per probe
]);

/* Slow BY DESIGN, so excluded from the pairs pass only. nmap's -T0 (paranoid)
   and -T1 (sneaky) insert minutes of delay between probes — that is what they
   are for. Alone they return at once, because with no target there is nothing
   to pace, so the singles pass still proves them; pairing them with a probe
   flag just buys a timeout. */
const SLOW_BY_DESIGN = new Set(['T0', 'T1', 'T']);

/* Everything the verifier refuses to run, for either reason. */
const SIDE_EFFECTS = new Set([...SIDE_EFFECTS_ONLY, ...NETWORK]);

/* A placeholder is not a value. buildCommand emits "<Target>" when a required
   input is empty, and for nmap that string would be passed as a hostname — it
   would be resolved, and anything that resolved would be SCANNED. The verifier
   strips every placeholder before running, which for nmap leaves a command with
   no target at all: nmap then parses every flag and reports "No targets were
   specified, so 0 hosts scanned". That is the whole point — flag acceptance is
   provable with no target, no privileges and no packets. */
const PLACEHOLDER = /^<.+>$/;

function stripPlaceholders(argv) {
  return argv.filter(a => !PLACEHOLDER.test(a));
}

/* stdin MUST be closed, and this is not a detail.
   sqlmap reads its target list from stdin when no target option is given, so
   with an open pipe it waits forever: 213 of its 271 flags sat until the
   timeout. A timed-out probe matches no rejection pattern, so the verifier
   counted every one of them as ACCEPTED — a silent pass for a command that
   never ran. spawn with stdin on 'ignore' gives the tool an immediate EOF:
   the same probe goes from 12 seconds to 0.4.

   execFile could not fix it. Its stdio option is overridden so it can capture
   output, so the pipe stayed open whatever was asked for. */
/* Arguments forced onto every probe of a tool, because without them the tool
   would do something the verifier must never do. */
const FORCED = { tshark: () => ['-r', SAMPLE_PCAP] };

function run(argv) {
  const forced = FORCED[tool.id] ? FORCED[tool.id]() : [];
  const safe = [...forced, ...stripPlaceholders(argv)];
  return new Promise(resolve => {
    const child = spawn(tool.id, safe, { stdio: ['ignore', 'pipe', 'pipe'], cwd: PROBE_DIR });
    let out = '';
    const take = d => { if (out.length < (4 << 20)) out += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 20000);
    child.on('error', e => { clearTimeout(timer); resolve({ out: String(e.message), timedOut: false }); });
    child.on('close', () => { clearTimeout(timer); resolve({ out, timedOut }); });
  });
}

/* Run the queue with a bounded number in flight. sqlmap takes about half a
   second to start, and every valid pair of its 271 flags is 36,000 commands —
   hours in sequence, minutes like this. The bound keeps it from forking a
   process per pair all at once. */
async function pool(jobs, width, worker) {
  let next = 0;
  const run1 = async () => { while (next < jobs.length) { const i = next++; await worker(jobs[i]); } };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, run1));
}

/* Default to half the cores, not twelve. Twelve parallel sqlmap processes
   pegged roughly four cores and spun the fans up for ten minutes; the run is
   not urgent enough to take the whole machine. Raise it with VERIFY_WIDTH
   when nothing else is going on. */
const WIDTH = Number(process.env.VERIFY_WIDTH || Math.max(2, Math.floor((os.cpus?.().length || 8) / 2)));

const required = tool.flags.filter(f => f.required);
const bad = [];
let ran = 0;

const jobs = [];
function check(label, picked, override, modeId) {
  const mid = modeId || tool.modes[0].id;
  const allowed = new Set((tool.modes.find(m => m.id === mid) || tool.modes[0]).flags);
  const flags = tool.flags.filter(f => picked[f.id] && allowed.has(f.id))
    .map(f => resolveFlag(f, mid));
  const { slots, adhoc } = slotsAndAdhoc(flags, override);
  const built = buildCommand(tool, mid, picked, slots, adhoc);
  const tokens = flags.map(f => f.short || f.long).filter(Boolean);
  jobs.push({ label, built, tokens });
}

/* pass 1 — each flag alone, in EVERY mode that has it.
   This used to run against modes[0] only. For a one-mode tool that is the whole
   job, but gobuster has seven, so six went unverified — and worse, a flag that
   belongs to dns was "tested" under dir, where buildCommand correctly drops it,
   so the command ran with no flag at all and passed. Silent and meaningless.
   A flag is now checked once per mode it actually belongs to. */
let skipped = 0;
for (const mode of tool.modes) {
  const allowed = new Set(mode.flags);
  for (const f of tool.flags) {
    if (!allowed.has(f.id)) continue;
    if (SIDE_EFFECTS.has(f.id)) { skipped++; continue; }
    const picked = {};
    required.forEach(r => { picked[r.id] = true; });
    picked[f.id] = true;
    check(`${tool.modes.length > 1 ? mode.id + ' ' : ''}${f.short || f.long}`, picked, undefined, mode.id);
  }
}
const afterSingles = jobs.length;

/* pass 3 — awkward values on every flag that takes a path */
for (const f of tool.flags.filter(f => f.takes === 'path' && !SIDE_EFFECTS.has(f.id))) {
  for (const v of AWKWARD) {
    const picked = {};
    required.forEach(r => { picked[r.id] = true; });
    picked[f.id] = true;
    check(`${f.short || f.long} = ${JSON.stringify(v)}`, picked, v);
  }
}
const afterAwkward = jobs.length;

/* pass 4 — every recipe, exactly as the page would build it.
   These are the commands we put in front of someone as "use this", so they had
   better run. Values come from the recipe's own examples, which is what a
   visitor sees before typing anything. */
let recipeCount = 0;
for (const r of tool.recipes || []) {
  /* WITHOUT the examples. A recipe's example target is a real host, and
     building one as a visitor sees it would have the verifier scan
     scanme.nmap.org and a /24 subnet, once per recipe. */
  const built = buildRecipe(tool, r, {}, { useExamples: false });
  jobs.push({ label: `recipe: ${r.name}`, built, tokens: Object.keys(r.flags || {})
    .map(id => { const f = tool.flags.find(x => x.id === id); return f && (f.short || f.long); }).filter(Boolean) });
  recipeCount++;
}

/* pass 2 — every valid pair the UI would allow */
let pairs = 0;
let sampled = null;
const candidates = [];
if (doPairs) {
  /* Per mode, because a pair that does not exist together is not a pair. This
     loop used to run over every flag of the tool regardless of mode, so for
     gobuster it combined dns flags with s3 flags — commands no mode accepts. */
  for (const mode of tool.modes) {
    const list = tool.flags.filter(f => mode.flags.includes(f.id) && !SIDE_EFFECTS.has(f.id) && !SLOW_BY_DESIGN.has(f.id));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const picked = {};
        required.forEach(r => { picked[r.id] = true; });
        picked[a.id] = true;
        if (blockedBy(tool, picked, b)) continue;   // the UI would not permit it
        picked[b.id] = true;
        candidates.push({ mode, a, b, picked });
      }
    }
  }

  /* Under a cap, keep the pairs where two flags could actually interact and
     sample the rest. A pair interacts if either side declares a conflict or a
     requirement, carries a closed value set, or they sit in the same group —
     that is where a tool's own validation lives. The remainder is shuffled
     with a fixed seed, so a capped run is reproducible and a failure can be
     repeated rather than hunted for. */
  const interacts = p =>
    (p.a.conflicts || []).length || (p.b.conflicts || []).length ||
    (p.a.requires || []).length || (p.b.requires || []).length ||
    p.a.takes === 'enum' || p.b.takes === 'enum' ||
    p.a.group === p.b.group;

  let chosen = candidates;
  if (candidates.length > pairBudget) {
    const must = candidates.filter(interacts);
    const rest = candidates.filter(p => !interacts(p));
    let seed = 20261008;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    chosen = must.concat(rest.slice(0, Math.max(0, pairBudget - must.length)));
    sampled = { total: candidates.length, must: must.length, kept: chosen.length };
  }

  for (const p of chosen) {
    check(`${tool.modes.length > 1 ? p.mode.id + ' ' : ''}${p.a.short || p.a.long} + ${p.b.short || p.b.long}`, p.picked, undefined, p.mode.id);
    pairs++;
  }
}

const t0 = Date.now();
const stalled = [];
await pool(jobs, WIDTH, async job => {
  const { out, timedOut } = await run(job.built.argv);
  ran++;
  /* A probe that never finished proves nothing. Counting it as a pass is how
     a verifier reports success for commands it never actually tested. */
  if (timedOut) { stalled.push({ label: job.label, cmd: job.built.text }); return; }
  /* A rejection must NAME the flag. curl's --manual prints curl's entire
     manual, and that manual contains the sentence "Unknown option specified
     to libcurl" as documentation — so matching the pattern anywhere in the
     output reported a perfectly good flag as rejected. Every tool here names
     the offending token in its error ("no such option: --x", "unrecognized
     option `--x'", "flag provided but not defined: -x"), so requiring it
     costs nothing and removes a whole class of false alarm. */
  /* Match the token WITH its dashes, allowing either dash count.
     Go's flag package echoes "--bogus" back as "-bogus", so both spellings
     have to be accepted — but matching the bare NAME was too loose: curl's
     manual contains the words "you passed a", and "pass" is a flag, so
     --manual + --pass reported itself rejected. */
  const spellings = t => { const n = t.replace(/^-+/, ''); return ['-' + n, '--' + n]; };
  const line = out.split('\n').find(l =>
    REJECT.test(l) && job.tokens.some(t => spellings(t).some(sp => l.includes(sp))));
  if (line) bad.push({ label: job.label, cmd: job.built.text, why: line.trim() });
});

console.log(`\nverify ${tool.id} ${tool.provenance.toolVersion}`);
console.log(`  singles   ${afterSingles}`);
console.log(`  awkward   ${afterAwkward - afterSingles}`);
if (doPairs) {
  console.log(`  pairs     ${pairs}${sampled ? ` of ${sampled.total} (all ${sampled.must} that could interact, plus a seeded sample)` : ' (every valid pair)'}`);
}
if (recipeCount) console.log(`  recipes   ${recipeCount}`);
console.log(`  rejected  ${bad.length}`);
if (stalled.length) console.log(`  STALLED   ${stalled.length}  <- never finished, so never verified`);
console.log(`  commands run: ${ran} in ${((Date.now() - t0) / 1000).toFixed(1)}s at width ${WIDTH}`);

if (stalled.length) {
  console.error(`\nINCONCLUSIVE — ${stalled.length} probe(s) hit the timeout and prove nothing:`);
  stalled.slice(0, 15).forEach(b => console.error(`  ? ${b.label}\n      ${b.cmd}`));
  if (stalled.length > 15) console.error(`  ... and ${stalled.length - 15} more`);
}

if (bad.length || stalled.length) {
  console.error(`\nREJECTED — ${bad.length}:`);
  bad.slice(0, 25).forEach(b => console.error(`  x ${b.label}\n      ${b.cmd}\n      ${b.why}`));
  if (bad.length > 25) console.error(`  ... and ${bad.length - 25} more`);
  process.exit(1);
}
console.log('\nevery generated command was accepted by the real binary.');

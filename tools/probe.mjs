#!/usr/bin/env node
/**
 * The binary decides — for any tool.
 *
 * A tool's own help can list an option the build does not actually support.
 * macOS curl prints --socks5-gssapi-service in `--help all` and then answers
 * "option --socks5-gssapi-service: is unknown", because the option name is
 * compiled in but the library behind it is not. Shipping it would offer a flag
 * that cannot work, on this machine, today.
 *
 * So every extracted flag is put to the binary and dropped unless accepted.
 * This is the generic form of tools/probe-nmap.mjs, which keeps its own file
 * because nmap needs more than membership.
 *
 *   node tools/probe.mjs curl [--dry-run]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, writeFileSync as wf, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEmptyPcap, forcedArgs, UNSAFE } from './probe-safety.mjs';

const id = process.argv[2];
const apply = !process.argv.includes('--dry-run');
if (!id) { console.error('usage: probe.mjs <toolId> [--dry-run]'); process.exit(2); }

const FILE = `data/tools/${id}.json`;
const tool = JSON.parse(readFileSync(FILE, 'utf8'));
const DIR = mkdtempSync(join(tmpdir(), `commander-probe-${id}-`));
const SAMPLE = join(DIR, 'sample.txt');
wf(SAMPLE, 'admin\n'); chmodSync(SAMPLE, 0o444);

const REJECT = /flag provided but not defined|unknown (?:flag|option|shorthand)|option .*?: is unknown|unrecognized option:?|invalid option|not defined:|no such option/i;

/* The safety rules, shared with verify.mjs and coverage.mjs so they cannot
   drift apart. This runner used to have none of its own, and ran bare tshark
   commands that opened a network interface. */
const PCAP = writeEmptyPcap(DIR);
const FORCED = forcedArgs(tool.id, PCAP);

/* Flags that would reach the network or change this machine. Their membership
   is established by the help text alone; running them is not worth it. */
const SKIP = new Set([...UNSAFE, 'help', 'version']);

const VALUE = { none: null, string: 'x', int: '1', path: SAMPLE,
  url: 'http://127.0.0.1:1/', port: '80', host: '127.0.0.1', enum: null };

function run(argv) {
  const r = spawnSync(tool.name, [...FORCED, ...argv], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, cwd: DIR, encoding: 'utf8' });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

const dropped = [];
let kept = 0, skipped = 0;
for (const f of tool.flags) {
  if (SKIP.has(f.id)) { skipped++; kept++; continue; }
  const tok = f.short || f.long;
  const v = f.takes === 'none' ? null : (f.takes === 'enum' ? (f.enum && f.enum[0]) : VALUE[f.takes] ?? 'x');
  const out = run(v == null ? [tok] : [tok, String(v)]);
  const line = out.split('\n').find(l => REJECT.test(l) && l.includes(tok.replace(/^-+/, '')));
  if (line) dropped.push({ tok, why: line.trim() }); else kept++;
}

console.log(`probe ${tool.id} ${tool.provenance.toolVersion}: ${kept} accepted, ${dropped.length} dropped, ${skipped} skipped as unsafe to run`);
if (dropped.length) {
  console.log('\nthe help lists these but the binary refuses them:');
  dropped.forEach(d => console.log(`  - ${d.tok.padEnd(26)} ${d.why}`));
}

if (apply && dropped.length) {
  const gone = new Set(dropped.map(d => d.tok));
  tool.flags = tool.flags.filter(f => !gone.has(f.short || f.long));
  const ids = new Set(tool.flags.map(f => f.id));
  tool.modes.forEach(m => { m.flags = m.flags.filter(x => ids.has(x)); });
  writeFileSync(FILE, JSON.stringify(tool, null, 2) + '\n');
  console.log(`\nwrote ${FILE} (${tool.flags.length} flags)`);
} else if (!apply) console.log('\n--dry-run: nothing written');

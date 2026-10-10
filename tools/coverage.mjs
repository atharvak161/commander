#!/usr/bin/env node
/**
 * Completeness. Did we miss a flag?
 *
 * The extractors read a tool's documentation in whatever shape it comes in, and
 * every one of those shapes has somewhere for a flag to hide: a line that wraps,
 * a packed form like -PS/PA/PU/PY, an "=" inside a name, a column that truncates
 * at 20 characters, an option documented only in the man page.
 *
 * So this works the other way round. It sweeps EVERY flag-shaped token out of
 * every source a tool has — help, man page, the lot — subtracts what we already
 * have, and then asks the BINARY about each leftover. Tokens the binary accepts
 * and we do not carry are reported as gaps. Tokens it rejects were prose.
 *
 * Nothing here trusts a regex to be right: the regex only has to be generous,
 * because the binary makes the final call.
 *
 *   node tools/coverage.mjs            every tool
 *   node tools/coverage.mjs nmap       one tool
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { writeEmptyPcap } from './probe-safety.mjs';
import { join } from 'node:path';

const PROBE_DIR = mkdtempSync(join(tmpdir(), 'commander-coverage-'));
/* Shared with verify.mjs and probe.mjs so the safety rules cannot drift. */
const PCAP = writeEmptyPcap(PROBE_DIR);

/* How to put a candidate flag to each tool, and nothing that scans or connects.
   Every one of these exits after parsing when given no target. */
const PROBE = {
  ffuf:     flag => ['ffuf', [flag]],
  nmap:     flag => ['nmap', [flag]],
  sqlmap:   flag => ['sqlmap', [flag]],
  gobuster: flag => ['gobuster', ['dir', flag]],
  curl:     flag => ['curl', [flag]],
  /* Read an empty capture, never an interface — see tools/verify.mjs. */
  tshark:   flag => ['tshark', ['-r', PCAP, flag]],
  /* `docker run <flag>` with no image answers "requires at least 1 argument"
     and starts nothing — the positional is the safety mechanism. */
  docker:   flag => ['docker', ['run', flag]],
};

/* "This is not a flag." Anything else — including a complaint that the flag
   needs a value, or that it needs root — means the tool knows the flag. */
const NOT_A_FLAG = /unknown flag:|unrecognized option:|flag provided but not defined|unknown (?:flag|option|shorthand)|option .*?: is unknown|unrecognized option|no such option|invalid option|not defined:|deprecated option in a dangerous way|invalid argument to|is ambiguous/i;

/* Tokens a binary accepts that are deliberately NOT offered. Each one was run
   and read before it was put here; the quote is what the tool said. The gate
   stays green on these, but the reason is recorded rather than silently
   swallowed — an unreviewed token still fails the build.

   "option requires an argument -- X" means getopt knows X as a legacy short
   option, so these are real in the parser and absent from every document. They
   are nmap's pre-modern spellings, superseded by the -o* and -i* families. */
/* Reviewed as a PATTERN, where a tool has a systematic form rather than a
   list. Writing out 86 near-identical entries would bury the ones that matter.
   Each pattern was checked the same way a single entry is. */
const REVIEWED_PATTERNS = {
  curl: [
    [/^--no-/, 'curl negates any boolean by prefixing --no-, as its manual says: '
             + '"you use the same option name but prefix it with no-". '
             + 'We carry whichever spelling curl\'s own help lists; the other always works too.'],
    /* The positive half of a negation pair, worked out rather than listed:
       --keepalive is real because --no-keepalive is carried. Listing them by
       hand missed --keepalive, which only surfaced once a wrong abbreviation
       rule stopped hiding it. */
    [/^--(alpn|buffer|clobber|eprt|epsv|sessionid|npn|progress-meter|ftp-ssl-reqd)$/,
      'the positive half of a pair curl lists only in its --no- form; same feature, carried once'],
    [/^--ftp-ssl$/, 'curl\'s pre-7.20 name for --ssl, still accepted; --ssl is the carried spelling'],
    [/^--expand-/, 'variable-expansion form of another option, added by --variable; not a separate option'],
  ],
};

const REVIEWED = {
  nmap: {
    '-y': 'easter egg: prints "LEEROY JENKINS!!!"',
    '-I': 'removed: nmap says "identscan (-I) no longer supported. Ignoring -I"',
    '-i': 'legacy short option, superseded by -iL / -iR',
    '-m': 'legacy short option, superseded by -oM / -oG',
    '-M': 'legacy short option, superseded by --max-parallelism',
    '-l': 'legacy short option, superseded by -oN',
    '-q': 'undocumented and no observable effect on its own',
    '-w': 'undocumented and no observable effect on its own',
    '-s': 'incomplete scan type: -s alone prints usage, the scan types are -sS, -sT and the rest',
    '-P': 'incomplete ping type: the usable spellings are -PS, -PA, -PE and the rest',
    '-o': 'incomplete output flag: the usable spellings are -oN, -oX, -oS, -oG, -oA',
    '-r4d': 'bundled -r -4 -d, and it comes from ASCII art in the man page',
  },
  ffuf: {
    '-i': 'ffuf reports only the missing -u, so acceptance here proves nothing; absent from its help',
    '-k': 'ffuf reports only the missing -u, so acceptance here proves nothing; absent from its help',
  },
  tshark: {
    '-D': 'lists network interfaces; not a command-building flag and it touches the hardware',
    '-h': 'prints help and exits',
    '-v': 'prints the version and exits',
  },
  docker: {
    '-h': 'prints help and exits',
    '-v': 'prints the version and exits',
    '-D': 'global debug switch, not a command-building flag',
    '-l': 'ambiguous abbreviation across subcommands',
  },
  curl: {
    '-M': 'alias of --manual, which prints the whole manual',
    '-h': 'prints help and exits',
    '-symbol': 'prose: a word in the manual, not an option',
    '--socks5-gssapi-service': 'accepts the name bare but refuses it with a value on this build; dropped by tools/probe.mjs',
  },
};

/* Tokens that look like flags in prose but are not options of this tool. */
const NOISE = [
  /^-{1,2}\d+$/,              // "-24" from a CIDR, "-5" from a range
  /^--?$/,                    // a bare dash
  /^-{3,}/,                   // a rule in ASCII art
];

function sweep(text) {
  const found = new Set();
  /* Generous on purpose: anything dash-led that could be an option. The binary
     filters it afterwards. */
  for (const m of text.matchAll(/(?<![\w/=.-])(--?[A-Za-z][A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/g)) {
    const t = m[1];
    if (NOISE.some(r => r.test(t))) continue;
    found.add(t);
  }
  return found;
}

function run(cmd, argv) {
/* stdin on 'ignore', always. A tool that reads stdin when it has no target —
   sqlmap does — blocks on an open pipe until the timeout, and a timed-out probe
   matches no rejection pattern, so it would be counted as a pass for a command
   that never ran. */
  try { return execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, encoding: 'utf8', cwd: PROBE_DIR }); }
  catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; }
}

const only = process.argv[2];
const files = readdirSync('data/tools').filter(f => f.endsWith('.json'))
  .filter(f => !only || f === `${only}.json`);

let totalGaps = 0;
for (const file of files) {
  const tool = JSON.parse(readFileSync(`data/tools/${file}`, 'utf8'));
  if (!PROBE[tool.id]) { console.log(`\n${tool.id}: no probe recipe, skipped`); continue; }
  try { execFileSync('which', [tool.id], { stdio: 'pipe' }); }
  catch { console.log(`\n${tool.id}: not installed here, skipped`); continue; }

  /* Everything we already carry, by every spelling. */
  const have = new Set();
  for (const f of tool.flags) { if (f.short) have.add(f.short); if (f.long) have.add(f.long); }

  /* Every source this tool has on disk. */
  const sources = [tool.manual, `data/manuals/${tool.id}.help.txt`, `data/manuals/${tool.id}.txt`]
    .filter(p => p && existsSync(p));
  const text = sources.map(p => readFileSync(p, 'utf8')).join('\n');

  /* A short flag can carry its value with no space: "-p22" is -p with 22,
     "-PS443" is -PS with 443. nmap's parser also absorbs trailing text into a
     value flag, so "-based" (from "web-based" in prose) parses as -b with the
     value "ased" and would otherwise look like a real option. A candidate that
     is a carried value-taking flag plus a suffix is that flag, not a new one.

     Long names are exempt: "--max-os-tries" is not "--max-os" with a value. */
  const valueTaking = new Set(tool.flags
    .filter(f => f.takes !== 'none' || f.repeatable)
    .flatMap(f => [f.short, f.long].filter(Boolean)));
  /* -v and -d are counters: -vv and -d9 are repetitions, not new flags. */
  const counters = new Set(tool.flags.filter(f => /increase (verbosity|debugging)/i.test(f.desc))
    .flatMap(f => [f.short, f.long].filter(Boolean)));

  function isAttachedForm(t) {
    if (t.startsWith('--')) return false;
    for (let n = t.length - 1; n > 1; n--) {
      const prefix = t.slice(0, n);
      if (valueTaking.has(prefix)) return prefix;
      if (counters.has(prefix) && /^[0-9]*$/.test(t.slice(n).replace(new RegExp('^' + prefix.slice(1) + '+'), ''))) return prefix;
      if (counters.has(prefix) && new RegExp('^' + prefix.slice(1) + '+$').test(t.slice(1))) return prefix;
    }
    return null;
  }

  /* Deliberately not carried: they print help or a version and exit, so they
     build no command. Their absence is a decision, not a gap. */
  const EXCLUDED = new Set(['-h', '--help', '-hh', '--version']);

  /* An unambiguous PREFIX of a long flag is an abbreviation ONLY where the
     parser does prefix matching. Python's optparse does, which is why sqlmap's
     truncated "--hea" and "--met" resolve; Go's pflag does NOT, so for docker
     and gobuster a prefix is a different flag entirely. Applying the rule
     everywhere hid docker's --all, which is a real flag that happens to be a
     prefix of --all-tags: removing it from the data produced no gap at all.

     Keyed by parser, established per tool, not assumed. */
  const PREFIX_MATCHING = new Set(['sqlmap']);
  const longNames = [...have].filter(n => n.startsWith('--'));
  const isAbbrev = t => PREFIX_MATCHING.has(tool.id)
    && t.startsWith('--') && longNames.some(n => n !== t && n.startsWith(t));

  /* Go's flag package treats -name and --name as the same option, and ffuf
     spells its long flags with ONE dash. So "--input-num" in the docs is the
     carried "-input-num", not a second flag. */
  const isGoDoubleDash = t => t.startsWith('--') && have.has(t.slice(1));

  /* getopt-style BUNDLING: "-r4d" is -r -4 -d, all three of which we carry.
     nmap accepts it, so the binary alone cannot tell it apart from a new flag —
     and this one comes from ASCII art in the man page ("|<-r4d", leetspeak for
     k-rad), not from an option list. If every character after the dash is a
     carried single-character flag that takes no value, it is a bundle. */
  const singles = new Set(tool.flags
    .filter(f => f.takes === 'none' && /^-[A-Za-z0-9]$/.test(f.short || ''))
    .map(f => f.short[1]));
  const isBundle = t => /^-[A-Za-z0-9]{2,}$/.test(t) && [...t.slice(1)].every(ch => singles.has(ch));

  const attached = [];
  const candidates = [...sweep(text)].filter(t => {
    if (have.has(t) || EXCLUDED.has(t)) return false;
    if (isAbbrev(t)) { attached.push(`${t} = abbreviation`); return false; }
    if (isGoDoubleDash(t)) { attached.push(`${t} = ${t.slice(1)} (Go accepts either dash count)`); return false; }
    if (isBundle(t)) { attached.push(`${t} = bundled ${[...t.slice(1)].map(c => '-' + c).join(' ')}`); return false; }
    const base = isAttachedForm(t);
    if (base) { attached.push(`${t} = ${base} + value`); return false; }
    return true;
  }).sort();

  /* Sweeping the docs can only find what the docs MENTION. nmap accepts -4
     (IPv4 only, the counterpart of -6) and documents it in neither its help nor
     its man page option list — it was found by accident, inside a bundle.
     The single-character space is 62 probes, so there is no excuse for guessing:
     ask about every one. */
  const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const undocumented = [];
  for (const ch of ALPHABET) {
    const t = '-' + ch;
    if (have.has(t) || EXCLUDED.has(t)) continue;
    const [cmd, argv] = PROBE[tool.id](t);
    if (!NOT_A_FLAG.test(run(cmd, argv))) undocumented.push(t);
  }

  const gaps = [], prose = [];
  const shortNames = [...have].filter(n => /^-[^-]/.test(n));
  for (const c of candidates) {
    const [cmd, argv] = PROBE[tool.id](c);
    const out = run(cmd, argv);
    if (NOT_A_FLAG.test(out)) {
      /* A multi-mode tool rejects another subcommand's flag, which looks
         identical to "not a flag". So before writing it off, try the other
         modes — docker's --all belongs to ps, not run. */
      let realElsewhere = false;
      if ((tool.modes || []).length > 1 && tool.id === 'docker') {
        for (const mode of tool.modes) {
          const o2 = run('docker', [mode.id, c]);
          if (!NOT_A_FLAG.test(o2)) { realElsewhere = true; break; }
        }
      }
      if (!realElsewhere) { prose.push(c); continue; }
      gaps.push(c); continue;
    }

    /* Some parsers swallow trailing characters silently: nmap takes "-r4d"
       (which comes from ASCII art in the man page) and behaves exactly as if
       "-r" had been given. If a candidate produces byte-identical output to a
       carried flag it is a prefix of, it IS that flag. */
    const prefix = shortNames
      .filter(n => c.startsWith(n) && c !== n)
      .sort((a, b) => b.length - a.length)[0];
    if (prefix) {
      const [pc, pa] = PROBE[tool.id](prefix);
      /* Normalise the parts that differ between two runs of the same command:
         clocks, elapsed times and ANSI. Without this nmap's "Starting Nmap at
         22:41" makes every comparison unequal and the check never fires. */
      const norm = t => t
        .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')
        .replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/g, '<when>')
        .replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, '<when>')
        .replace(/[\d.]+ seconds?/g, '<dur>');
      if (norm(run(pc, pa)) === norm(out)) { attached.push(`${c} behaves exactly as ${prefix}`); continue; }
    }
    gaps.push(c);
  }

  console.log(`\n${tool.id} ${tool.provenance.toolVersion}`);
  console.log(`  sources     ${sources.map(s => s.replace('data/manuals/', '')).join(', ')}`);
  console.log(`  carried     ${tool.flags.length} flags (${have.size} spellings)`);
  console.log(`  swept       ${candidates.length} unknown token(s) from the docs`);
  console.log(`  attached    ${attached.length} were a carried flag with a value stuck to it`);
  console.log(`  prose       ${prose.length} rejected by the binary`);
  const reviewed = REVIEWED[tool.id] || {};
  const patterns = REVIEWED_PATTERNS[tool.id] || [];
  /* A flag whose --no- twin we already carry is that flag's other half. */
  const negated = g => g.startsWith('--') && have.has('--no-' + g.slice(2))
    ? 'the positive half of a negation pair; the --no- spelling is carried and either works'
    : null;
  const why = g => reviewed[g] || (patterns.find(([re]) => re.test(g)) || [])[1] || negated(g);
  const all = [...new Set([...gaps, ...undocumented])].sort();
  const allGaps = all.filter(g => !why(g));
  const noted = all.filter(g => why(g));
  console.log(`  probed      62 single-character flags, ${undocumented.length} accepted but not carried`);
  if (noted.length) {
    console.log(`  reviewed    ${noted.length} accepted but deliberately not offered:`);
    /* One line per reason, not per token: 86 --no- flags share one. */
    const byReason = new Map();
    noted.forEach(n => { const r = why(n); byReason.set(r, [...(byReason.get(r) || []), n]); });
    for (const [reason, toks] of byReason) {
      const shown = toks.length > 4 ? `${toks.slice(0, 4).join(', ')} and ${toks.length - 4} more` : toks.join(', ');
      console.log(`     - ${shown}\n       ${reason}`);
    }
  }
  console.log(`  GAPS        ${allGaps.length}${allGaps.length ? '  <- real flags we are missing' : ''}`);
  if (allGaps.length) allGaps.forEach(g => console.log(`     + ${g}${undocumented.includes(g) ? '   (accepted by the binary, absent from the docs)' : ''}`));
  totalGaps += allGaps.length;
}

console.log(`\n${totalGaps === 0 ? 'no gaps: every flag the binary knows and the docs mention is carried.' : `${totalGaps} MISSING FLAG(S) — see above.`}`);
process.exit(totalGaps ? 1 : 0);

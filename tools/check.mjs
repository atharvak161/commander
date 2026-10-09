#!/usr/bin/env node
/**
 * Consistency checker. Runs on pre-commit; a broken tool file cannot land.
 *
 * Every rule here exists because its absence would let a wrong command reach a
 * user. Each one is proved by reintroducing the bug it catches — see test/.
 *
 * New checks go ABOVE the verdict block at the bottom. A check appended after it
 * runs but can never report, which is a lesson learned the hard way elsewhere.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const fail = [];
const warn = [];
const TOOLS = 'data/tools';
const FRESH_DAYS = 180;

const files = existsSync(TOOLS)
  ? readdirSync(TOOLS).filter(f => f.endsWith('.json'))
  : [];

if (!files.length) fail.push('data/tools/ holds no tool files.');

const manifestPath = 'data/manifest.json';
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : null;

const TAKES = new Set(['none','string','int','path','url','port','enum','host']);
/* `warn` is a CATEGORY, because it drives a badge on the flag button. Prose
   belongs in `note`, which the tooltip shows. Mixing the two put whole
   sentences where an icon name goes. */
const WARNS = new Set(['root','slow','noisy','destructive','deprecated']);

for (const file of files) {
  const rel = `${TOOLS}/${file}`;
  let t;
  try { t = JSON.parse(readFileSync(rel, 'utf8')); }
  catch (e) { fail.push(`${rel}: not valid JSON — ${e.message}`); continue; }

  const expectId = file.replace(/\.json$/, '');
  if (t.id !== expectId) fail.push(`${rel}: id "${t.id}" does not match the filename.`);

  for (const k of ['name','summary','category','manual','helpCommand','provenance','modes','inputs','flags'])
    if (t[k] === undefined) fail.push(`${rel}: missing required key "${k}".`);
  if (!t.flags) continue;

  /* "At least one of these" must name real flags, or the interface would demand
     something that does not exist, and must offer a genuine choice — a group of
     one is just a required flag wearing a different hat. */
  const flagIds = new Set((t.flags || []).map(f => f.id));
  for (const g of t.requiresOneOf || []) {
    const ids = g.ids || [];
    for (const id of ids) if (!flagIds.has(id)) fail.push(`${rel}: requiresOneOf names "${id}", which is not a flag of ${t.id}.`);
    if (ids.length < 2) fail.push(`${rel}: requiresOneOf group "${g.label || ''}" has ${ids.length} option(s); fewer than two is just a required flag.`);
    if (!g.label) fail.push(`${rel}: requiresOneOf group has no label, so the message would not say what the choice is for.`);
  }

  // provenance
  const p = t.provenance || {};
  for (const k of ['toolVersion','source','tier','verifiedAt'])
    if (!p[k]) fail.push(`${rel}: provenance.${k} is missing. Every tool records where its data came from.`);
  if (p.verifiedAt) {
    const age = Math.round((Date.now() - new Date(p.verifiedAt)) / 86400000);
    if (Number.isNaN(age)) fail.push(`${rel}: provenance.verifiedAt is not a date.`);
    else if (age > FRESH_DAYS) warn.push(`${rel}: data is ${age} days old. Re-extract.`);
  }
  if (p.tier && !['A','B','C'].includes(p.tier)) fail.push(`${rel}: provenance.tier must be A, B or C.`);

  // manual file must exist, because the help tab reads it
  if (t.manual && !existsSync(t.manual)) fail.push(`${rel}: manual "${t.manual}" is not on disk.`);

  // flags
  const ids = new Set();
  const inputIds = new Set((t.inputs || []).map(i => i.id));
  for (const f of t.flags) {
    const at = `${rel}: flag ${f.short || f.long || f.id}`;
    if (!f.id) { fail.push(`${at} has no id.`); continue; }
    if (ids.has(f.id)) fail.push(`${at}: duplicate id "${f.id}".`);
    ids.add(f.id);
    if (!f.short && !f.long) fail.push(`${at}: needs a short or long form.`);
    if (!f.desc) fail.push(`${at}: has no description. Every flag is explained or it does not ship.`);
    if (!TAKES.has(f.takes)) fail.push(`${at}: takes "${f.takes}" is not a known value type.`);
    if (f.takes === 'enum' && (!Array.isArray(f.enum) || !f.enum.length))
      fail.push(`${at}: takes "enum" but enum is empty.`);
    if (f.takes !== 'enum' && f.enum) fail.push(`${at}: has enum values but takes is "${f.takes}".`);
    if (!f.group) fail.push(`${at}: has no group.`);
    if (!f.source) fail.push(`${at}: has no source.`);
    if (f.warn && !WARNS.has(f.warn)) fail.push(`${at}: warn "${f.warn}" is not a known warning.`);
    if (f.note != null && typeof f.note !== 'string') fail.push(`${at}: note must be a string.`);
    if (f.enumEnforced !== undefined && typeof f.enumEnforced !== 'boolean')
      fail.push(`${at}: enumEnforced must be true or false.`);
    if (f.enumEnforced !== undefined && f.takes !== 'enum')
      fail.push(`${at}: enumEnforced is set but takes is "${f.takes}", so there is no set to enforce.`);
    if (f.repeatable && f.takes === 'none')
      fail.push(`${at}: repeatable but takes no value, so there is nothing to repeat in the interface.`);

    /* perMode may only name modes this tool actually has, or a flag would carry
       an override that never applies and nobody would notice. */
    for (const mid of Object.keys(f.perMode || {})) {
      if (!t.modes.some(m => m.id === mid)) fail.push(`${at}: perMode names "${mid}", which is not a mode of ${t.id}.`);
    }
    if (f.binds && !inputIds.has(f.binds)) fail.push(`${at}: binds to "${f.binds}", which is not a declared input.`);
    if (f.takes === 'none' && f.binds) fail.push(`${at}: takes no value but binds to an input.`);
    if ((f.conflicts || []).includes(f.id)) fail.push(`${at}: conflicts with itself.`);
    if ((f.requires || []).includes(f.id)) fail.push(`${at}: requires itself.`);
  }

  // referential integrity
  for (const f of t.flags) {
    for (const c of f.conflicts || [])
      if (!ids.has(c)) fail.push(`${rel}: flag ${f.id} conflicts with "${c}", which does not exist.`);
    for (const r of f.requires || [])
      if (!ids.has(r)) fail.push(`${rel}: flag ${f.id} requires "${r}", which does not exist.`);
  }

  // conflicts must be symmetric, or the UI greys out one direction only
  for (const f of t.flags) {
    for (const c of f.conflicts || []) {
      const other = t.flags.find(x => x.id === c);
      if (other && !(other.conflicts || []).includes(f.id))
        fail.push(`${rel}: ${f.id} conflicts with ${c}, but ${c} does not conflict back. Conflicts are symmetric.`);
    }
  }

  // modes
  if (!t.modes || !t.modes.length) fail.push(`${rel}: no modes. A tool without subcommands still declares one.`);
  for (const m of t.modes || []) {
    if (!m.id) fail.push(`${rel}: a mode has no id.`);
    for (const fid of m.flags || [])
      if (!ids.has(fid)) fail.push(`${rel}: mode "${m.id}" lists flag "${fid}", which does not exist.`);
  }

  // manifest both ways
  if (manifest) {
    const listed = (manifest.tools || []).some(x => x.id === t.id);
    if (!listed) fail.push(`${rel}: not listed in the manifest, so the home grid will never show it.`);
  }
}

if (manifest) {
  for (const m of manifest.tools || [])
    if (!files.includes(`${m.id}.json`))
      fail.push(`manifest lists "${m.id}" but data/tools/${m.id}.json does not exist.`);
}

if (warn.length) {
  console.warn(`\nWARN — ${warn.length}:`);
  warn.forEach(w => console.warn(`  ! ${w}`));
}
/* Nothing unexpected at the repo root.
   A tool under test writes where IT chooses, relative to the current directory.
   Verifying "-o x" left a 195KB ffuf audit log called `x` at the root and it was
   committed twice before anyone noticed. verify.mjs now runs probes in a scratch
   directory, and this check is the backstop: an unrecognised root file fails the
   commit instead of shipping. Add deliberate new root files to the list. */
const ROOT_ALLOWED = new Set([
  '.gitignore', '.nojekyll', 'README.md', 'index.html', 'LICENSE',
  'CNAME', '.github', '.githooks', '.gstack', 'assets', 'data', 'tools', 'test', '.git',
]);
for (const entry of readdirSync('.')) {
  if (!ROOT_ALLOWED.has(entry)) {
    fail.push(`repo root: unexpected entry "${entry}". If it is deliberate add it to ROOT_ALLOWED in tools/check.mjs; if a tool probe wrote it, quarantine it with bin/safe-delete.`);
  }
}

if (fail.length) {
  console.error(`\nFAIL — ${fail.length} problem(s):`);
  fail.forEach(f => console.error(`  x ${f}`));
  process.exit(1);
}
console.log(`\nPASS — ${files.length} tool file(s), all consistent.`);

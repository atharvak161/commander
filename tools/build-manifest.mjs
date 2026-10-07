#!/usr/bin/env node
/**
 * Builds data/manifest.json from the tool files.
 *
 * The manifest carries a flat flag index so the home search can find a flag
 * without knowing which tool owns it — "-sV" or "wordlist" should land you
 * somewhere useful. Derived, never hand-written, so it cannot drift.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const files = readdirSync('data/tools').filter(f => f.endsWith('.json'));
const tools = [];
const flagIndex = [];

for (const f of files.sort()) {
  const t = JSON.parse(readFileSync(`data/tools/${f}`, 'utf8'));
  tools.push({
    id: t.id, name: t.name, category: t.category,
    summary: t.summary, flagCount: t.flags.length,
  });
  for (const fl of t.flags) {
    flagIndex.push({ t: t.id, f: [fl.short, fl.long].filter(Boolean).join(', '), d: fl.desc });
  }
}

writeFileSync('data/manifest.json', JSON.stringify({ tools, flagIndex }, null, 2) + '\n');
console.log(`build-manifest: ${tools.length} tool(s), ${flagIndex.length} flags indexed`);

#!/usr/bin/env node
/**
 * docker -> data/tools/docker.json
 *
 * docker is the most dangerous tool in the catalogue to probe, and the only one
 * whose danger is not about the network. The daemon is running; `docker run`
 * starts a container, `docker pull` downloads from the internet, `docker rm`
 * and the prune commands delete things. A careless probe does real damage to
 * the machine it runs on.
 *
 * Two facts make it safe anyway:
 *
 *   1. The CLI parses flags BEFORE it contacts the daemon. `docker run --bogus`
 *      answers "unknown flag" instantly and reaches nothing.
 *   2. Almost every subcommand REQUIRES a positional — an image, a container,
 *      a path. `docker run --rm` answers "requires at least 1 argument" and
 *      starts nothing. Withholding the positional is the safety mechanism, and
 *      the verifier already strips placeholders.
 *
 * So the modes modelled here are, deliberately, the subcommands that require a
 * positional, plus the two harmless read-only ones. Anything that ACTS when
 * given no argument — events and stats stream forever, load reads stdin, login
 * and logout reach the network, the prune family deletes — is listed in
 * EXCLUDED with its reason rather than quietly left out.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { recipes, alternatives, examples } from './recipes/docker.mjs';

const OUT = 'data/tools/docker.json';
const version = (/Docker version ([0-9.]+)/.exec(
  execFileSync('docker', ['--version'], { encoding: 'utf8' })) || [])[1] || 'unknown';

/* Subcommands that need a positional, so withholding it cannot act. */
const SAFE = [
  ['run',     'Create and start a container from an image.'],
  ['create',  'Create a container without starting it.'],
  ['exec',    'Run a command inside a container that is already running.'],
  ['build',   'Build an image from a Dockerfile.'],
  ['pull',    'Download an image from a registry.'],
  ['push',    'Upload an image to a registry.'],
  ['logs',    'Show the output of a container.'],
  ['inspect', 'Print everything the daemon knows about an object, as JSON.'],
  ['cp',      'Copy files between a container and the host.'],
  ['start',   'Start a stopped container.'],
  ['stop',    'Stop a running container.'],
  ['restart', 'Restart a container.'],
  ['kill',    'Send a signal to a container.'],
  ['rm',      'Remove a container.'],
  ['rmi',     'Remove an image.'],
  ['commit',  'Make an image from a container’s current state.'],
  ['save',    'Write an image to a tar archive.'],
  ['tag',     'Give an image another name.'],
  ['search',  'Search Docker Hub for images.'],
  ['port',    'Show the port mappings of a container.'],
  ['top',     'Show the processes running inside a container.'],
  ['diff',    'Show what has changed in a container’s filesystem.'],
  ['export',  'Write a container’s filesystem to a tar archive.'],
  ['import',  'Make an image from a tar archive.'],
  ['attach',  'Attach your terminal to a running container.'],
  ['pause',   'Suspend every process in a container.'],
  ['unpause', 'Resume a paused container.'],
  ['rename',  'Rename a container.'],
  ['update',  'Change the resource limits of a running container.'],
  ['wait',    'Block until a container stops, then print its exit code.'],
  ['history', 'Show the layers an image is built from.'],
];

/* Harmless with no argument: they read and print. */
const SAFE_BARE = [
  ['ps',     'List containers.'],
  ['images', 'List images.'],
];

/* Deliberately not modelled, each for a reason that is not "we ran out of time". */
export const EXCLUDED = {
  events:  'streams until interrupted, so a probe would never return',
  stats:   'streams until interrupted',
  load:    'reads an archive from stdin and would block',
  login:   'reaches a registry and prompts for credentials',
  logout:  'reaches a registry',
  system:  'a namespace whose subcommands include prune, which deletes',
  volume:  'a namespace whose subcommands include prune',
  network: 'a namespace whose subcommands include prune',
  image:   'a namespace whose subcommands include prune',
  container: 'a namespace whose subcommands include prune',
  swarm:   'swarm init changes the daemon’s mode',
  init:    'writes a Dockerfile and compose file into the current directory',
  bake:    'its target is optional, so a bare invocation can build',
  compose: 'a namespace; compose up starts services',
};

const slug = s => s.replace(/^-+/, '').replace(/[^a-zA-Z0-9]+/g, '-');

/* docker prints a type after the flag name: "list", "map", "string", "int",
   "uint16", "bytes", "duration". "list" and "map" mean the flag may be given
   more than once, which is docker's way of saying repeatable. */
function typeOf(word, name, desc) {
  if (!word) return { takes: 'none', repeatable: false };
  const w = word.toLowerCase();
  const repeatable = w === 'list' || w === 'map';
  if (/^(int|uint\d*|float\d*|bytes|duration)$/.test(w)) return { takes: 'int', repeatable };
  const h = `${name} ${desc}`.toLowerCase();
  if (/\bfile\b|\bpath\b|dockerfile|cert|\bdir\b/.test(h)) return { takes: 'path', repeatable };
  if (/\bport\b/.test(h)) return { takes: 'port', repeatable };
  if (/\bhost\b|\bip\b\b|address/.test(h)) return { takes: 'host', repeatable };
  return { takes: 'string', repeatable };
}

const flags = new Map();   // id -> flag, shared across modes
const modeFlags = new Map();

/* "  -a, --attach list       Attach to STDIN, STDOUT or STDERR"
   "      --add-host list     Add a custom host-to-IP mapping"
   Descriptions wrap onto following lines indented past the description column. */
const LINE = /^\s{2,}(?:(-[a-zA-Z]),\s+)?(--[a-z][a-z0-9-]*)(?:\s+(\S+))?\s{2,}(\S.*?)\s*$/;

for (const [cmd] of [...SAFE, ...SAFE_BARE]) {
  let help;
  try { help = execFileSync('docker', [cmd, '--help'], { encoding: 'utf8', timeout: 15000 }); }
  catch (e) { help = String(e.stdout || ''); }

  const ids = [];
  const lines = help.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LINE);
    if (!m) continue;
    const [, short, long, typeWord, descStart] = m;

    /* Pull in wrapped continuation lines. */
    let desc = descStart;
    for (let j = i + 1; j < lines.length; j++) {
      if (LINE.test(lines[j]) || /^\s*$/.test(lines[j]) || /^[A-Z]/.test(lines[j].trim())) break;
      if (!/^\s{20,}\S/.test(lines[j])) break;
      desc += ' ' + lines[j].trim();
    }

    let def = null;
    const dm = desc.match(/\(default\s+([^)]*)\)\s*$/i);
    if (dm) { def = dm[1].trim(); desc = desc.replace(/\s*\(default\s+[^)]*\)\s*$/i, '').trim(); }

    const id = slug(long);
    ids.push(id);
    const { takes, repeatable } = typeOf(typeWord, long, desc);

    if (!flags.has(id)) {
      flags.set(id, {
        id, short: long, long: short || null, takes, enum: null, binds: null,
        required: false, repeatable, default: def, group: 'options',
        desc: desc.trim(), help: '', warn: null, note: null,
        conflicts: [], requires: [], since: null, source: 'help',
        _modes: {},
      });
    }
    const f = flags.get(id);
    f._modes[cmd] = { desc: desc.trim(), default: def, takes, repeatable };
  }
  modeFlags.set(cmd, [...new Set(ids)]);
}

/* Collapse per-mode differences the way gobuster does: the common value lives
   on the flag, and only what genuinely differs goes in perMode. */
for (const f of flags.values()) {
  const entries = Object.entries(f._modes);
  const pick = key => {
    const counts = new Map();
    for (const [, e] of entries) {
      const k = JSON.stringify(e[key]);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return JSON.parse([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  };
  /* `repeatable` belongs in the per-mode set too. --attach is a list in run
     and a plain boolean in start; carrying one answer for both made the
     interface offer a multi-value box for a flag that takes no value. */
  const base = { desc: pick('desc'), default: pick('default'), takes: pick('takes'), repeatable: pick('repeatable') };
  Object.assign(f, base);
  f.repeatable = base.repeatable;

  const perMode = {};
  for (const [cmd, e] of entries) {
    const diff = {};
    for (const k of ['desc', 'default', 'takes', 'repeatable']) {
      if (JSON.stringify(e[k]) !== JSON.stringify(base[k])) diff[k] = e[k];
    }
    if (Object.keys(diff).length) perMode[cmd] = diff;
  }
  if (Object.keys(perMode).length) f.perMode = perMode;
  delete f._modes;
}

const list = [...flags.values()].sort((a, b) => a.id.localeCompare(b.id));
for (const [aid, alts] of Object.entries(alternatives)) {
  const f = flags.get(aid);
  if (f) f.alternatives = alts.filter(a => flags.has(a.id));
}

const tool = {
  id: 'docker',
  name: 'docker',
  summary: 'Build, run and manage containers and images.',
  category: 'containers',
  manual: 'data/manuals/docker.txt',
  helpCommand: 'docker run --help',
  provenance: {
    toolVersion: version,
    source: 'help',
    tier: 'A',
    verifiedAt: new Date().toISOString().slice(0, 10),
    host: 'darwin-arm64',
  },
  modes: [...SAFE, ...SAFE_BARE].map(([id, summary]) => ({
    id, name: id, summary, flags: modeFlags.get(id) || [],
  })),
  /* Which subcommand takes which positional. `docker run IMAGE` and
     `docker exec CONTAINER` put different things in the same place, and
     `docker ps` takes neither — so the trailing input is listed per mode
     rather than set once for the tool. */
  inputs: [
    {
      id: 'image', label: 'Image', placeholder: 'nginx:alpine',
      help: 'The image to use, with an optional tag.',
      trailing: ['run', 'create', 'pull', 'push', 'rmi', 'save', 'history', 'tag'],
      required: true,
    },
    {
      id: 'container', label: 'Container', placeholder: 'my-container',
      help: 'A container name or id. Run docker ps to list them.',
      trailing: ['exec', 'logs', 'start', 'stop', 'restart', 'kill', 'rm', 'inspect',
                 'commit', 'port', 'top', 'diff', 'export', 'attach', 'pause',
                 'unpause', 'rename', 'update', 'wait', 'cp'],
      required: true,
    },
    {
      /* docker exec needs a command after the container, and run accepts one
         after the image. It comes last, so it is listed last. */
      id: 'command', label: 'Command', placeholder: '/bin/sh',
      help: 'What to run inside. Required for exec; optional for run, where it overrides the image default.',
      trailing: ['exec', 'run', 'create'],
    },
  ],
  flags: list,
  recipes,
};

for (const i of tool.inputs || []) if (examples[i.id]) i.example = examples[i.id];

writeFileSync(OUT, JSON.stringify(tool, null, 2) + '\n');
console.log(`extract-docker: ${list.length} flags across ${tool.modes.length} subcommands -> ${OUT} (docker ${version})`);
console.log(`  repeatable: ${list.filter(f => f.repeatable).length}`);
console.log(`  per-mode overrides: ${list.filter(f => f.perMode).length}`);
console.log(`  deliberately excluded: ${Object.keys(EXCLUDED).length} subcommands`);

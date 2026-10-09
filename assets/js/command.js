/**
 * Command building — the single source of truth.
 *
 * Imported by the browser (assets/js/app.js) and by the verifier
 * (tools/verify.mjs). There is exactly one implementation, so a command the
 * tests prove valid is byte-for-byte the command the user copies. Two copies of
 * this logic would drift, and the drift would be invisible until someone pasted
 * a broken command into a terminal.
 */

/* Quote only where a shell would need it. Over-quoting is as wrong as
   under-quoting: it changes the bytes the tool receives. */
export function shellQuote(v) {
  if (v === '' || v == null) return v;
  const s = String(v);
  return /[\s"'$`\\<>|&;()*?!#~\[\]{}]/.test(s)
    ? "'" + s.replace(/'/g, "'\\''") + "'"
    : s;
}

export function flagById(tool, id) {
  return tool.flags.find(f => f.id === id);
}

/**
 * A flag as it behaves IN THIS MODE.
 *
 * Most flags mean the same thing everywhere, but some do not: gobuster's
 * --timeout defaults to 10s over HTTP and 1s for DNS and TFTP, and --domain is
 * the target in `dns` while in `dir` it is "the domain to append when using an
 * IP address as URL". Storing those separately would duplicate the 56 shared
 * flags across seven modes; storing one shared entry would hide the difference.
 * So the flag carries a `perMode` override of only the fields that differ, and
 * everything reads the flag through here.
 */
export function resolveFlag(flag, modeId) {
  const over = flag.perMode && flag.perMode[modeId];
  return over ? Object.assign({}, flag, over) : flag;
}

export function modeFlags(tool, modeId) {
  const m = tool.modes.find(x => x.id === modeId) || tool.modes[0];
  return tool.flags.filter(f => m.flags.includes(f.id));
}

/**
 * @param {object}  tool    parsed data/tools/<id>.json
 * @param {string}  modeId
 * @param {object}  picked  { flagId: true }
 * @param {object}  slots   { inputId: value }
 * @param {object}  adhoc   { flagId: value }  values for flags with no bound slot
 * @returns {{argv: string[], text: string, pieces: object[], issues: object[]}}
 *
 * `argv` is what an executor would pass; `text` is what the user copies. They
 * are built from the same list, so the thing tested is the thing shipped.
 */
export function buildCommand(tool, modeId, picked, slots, adhoc) {
  slots = slots || {};
  adhoc = adhoc || {};
  const m = tool.modes.find(x => x.id === modeId) || tool.modes[0];
  const flags = modeFlags(tool, m.id);

  const pieces = [];
  const issues = [];
  const argv = [];

  pieces.push({ tok: tool.name, label: 'the tool', help: tool.summary, kind: 'bin' });
  if (tool.modes.length > 1) {
    pieces.push({ tok: m.name, label: 'mode: ' + m.summary.replace(/\.$/, ''), help: m.summary, kind: 'mode' });
    argv.push(m.name);
  }

  /* Required flags lead: they are the subject of the command. */
  const ordered = flags.slice().sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0));

  for (const raw of ordered) {
    if (!picked[raw.id]) continue;
    const f = resolveFlag(raw, m.id);
    const tok = f.short || f.long;
    let val = '';
    let missing = false;
    if (f.takes !== 'none') {
      val = f.binds ? (slots[f.binds] || '') : (adhoc[f.id] || '');
      /* A repeatable flag is filled one value per line, so "nothing useful
         typed" means every line is blank — not just an empty box. Without this
         a box holding two newlines produced -H '  ', a header made of
         whitespace, with no warning. */
      if (f.repeatable && !String(val).split('\n').some(v => v.trim())) val = '';
      if (!val) {
        const label = f.binds
          ? ((tool.inputs.find(i => i.id === f.binds) || {}).label || f.binds)
          : 'a value';
        issues.push({ err: true, text: `${tok} needs ${label} — fill it in on the right.` });

        /* A flag awaiting a value emits a VISIBLE placeholder, never a bare
           token. Bare tokens built "ffuf -u -w /list", where ffuf reads -w as
           the value of -u: a command that looks assembled, is wrong, and fails
           in a way that does not point at the cause. The placeholder is quoted,
           so it survives a paste as one literal argument and the tool complains
           about the obviously fake value instead. */
        val = `<${label}>`;
        missing = true;
      }
    }
    /* A repeatable flag is given once per value. ffuf's -H and gobuster's
       --headers are the common case: two or three headers in one command is
       ordinary, and emitting only the first silently dropped the rest. Values
       are entered one per line, so a value that itself contains a comma or a
       space is still a single value. */
    const values = (f.repeatable && !missing)
      ? String(val).split('\n').map(v => v.trim()).filter(Boolean)
      : [val];

    for (const v of (values.length ? values : [val])) {
      argv.push(tok);
      if (v) argv.push(v);
      pieces.push({
        tok: tok + (v ? ' ' + shellQuote(v) : ''),
        label: f.desc,
        help: f.help || '',
        warn: f.warn,
        kind: 'flag',
        missing,
        note: f.note || null,
      });
    }
  }

  /* "At least one of these." Some requirements are not per-flag: ffuf says
     "-u flag or -request flag is required" and "Either -w or --input-cmd flag
     is required"; sqlmap's Target group says "At least one of these options
     has to be provided to define the target(s)". Marking one member required
     would be wrong — it would complain at someone who correctly used the other
     — and marking none left "sqlmap" on its own offered as a finished command. */
  for (const group of tool.requiresOneOf || []) {
    const members = group.ids.filter(id => (m.flags || []).includes(id));
    if (!members.length) continue;
    if (members.some(id => picked[id])) continue;
    const names = members.map(id => { const f = flagById(tool, id); return f ? (f.short || f.long) : id; });
    issues.push({ err: true, text: `${tool.name} needs one of ${names.join(', ')}${group.label ? ' — ' + group.label : ''}.` });
  }

  /* Trailing positionals. ffuf names its target with -u; nmap takes it as a
     bare argument at the end, and sqlmap accepts both. So an input may declare
     itself trailing, and it is appended after every flag — which is also the
     only position nmap accepts it in.

     `requiredUnless` covers the real case that the positional is not always
     needed: nmap wants a target, unless -iL reads one from a file or -iR
     generates random ones. Demanding a target then would be wrong. */
  for (const i of (tool.inputs || []).filter(x => x.trailing)) {
    let val = slots[i.id] || '';
    let missing = false;
    if (!val) {
      const satisfied = (i.requiredUnless || []).some(id => picked[id]);
      if (!i.required || satisfied) continue;
      issues.push({ err: true, text: `${tool.name} needs ${i.label} — fill it in on the right.` });
      val = `<${i.label}>`;
      missing = true;
    }
    argv.push(val);
    pieces.push({
      tok: shellQuote(val),
      label: i.label,
      help: i.help || '',
      kind: 'positional',
      missing,
    });
  }

  for (const raw2 of flags) {
    const f = resolveFlag(raw2, m.id);
    if (f.required && !picked[f.id]) {
      issues.push({ err: true, text: `${f.short || f.long} is required by ${tool.name}${tool.modes.length > 1 ? ' ' + m.name : ''}.` });
    }
    if (!picked[f.id]) continue;
    for (const r of f.requires || []) {
      const o = flagById(tool, r);
      if (o && !picked[r]) issues.push({ err: false, text: `${f.short || f.long} needs ${o.short || o.long}.` });
    }
  }

  return { argv, text: pieces.map(p => p.tok).join(' '), pieces, issues };
}

/** Which already-picked flag blocks this one, or null. */
export function blockedBy(tool, picked, f) {
  for (const id of Object.keys(picked)) {
    if (!picked[id]) continue;
    const other = flagById(tool, id);
    if (!other) continue;
    if ((other.conflicts || []).includes(f.id)) return other;
    if ((f.conflicts || []).includes(id)) return other;
  }
  return null;
}

/**
 * A ready-made command.
 *
 * A recipe names the flags and the values that make a real, sensible command
 * for one job — "stealth SYN scan", "dump a database", "POST some JSON". It is
 * built through buildCommand like everything else, deliberately: the same
 * quoting, the same ordering, the same conflict handling, and the verifier can
 * run every recipe against the real binary because it is just another command.
 *
 * Values come from the user first and the example second. Before you have
 * typed a target, a recipe shows a complete command against `example.com` so
 * you can read it and see the shape; the moment you fill the panel in, every
 * recipe on the page switches to your values. Nothing shows "<Target>" — a
 * recipe is meant to be readable on its own.
 */
export function buildRecipe(tool, recipe, slots, opts) {
  const mode = recipe.mode || tool.modes[0].id;
  const picked = Object.create(null);
  const adhoc = Object.create(null);
  const boundFromRecipe = Object.create(null);

  for (const [id, v] of Object.entries(recipe.flags || {})) {
    const f = flagById(tool, id);
    if (!f) continue;
    picked[id] = true;
    if (v !== true && v != null && v !== '') {
      /* A value given to a BOUND flag becomes that input's value. A recipe
         should not have to know which flags are wired to the panel: saying
         "-o ffuf.json" means write to ffuf.json, and before this it was
         silently dropped and the command showed "-o '<Output file>'". */
      if (f.binds) boundFromRecipe[f.binds] = String(v);
      else adhoc[id] = String(v);
    }
  }

  /* Whatever the user has typed wins; otherwise the input's example.
     `useExamples: false` leaves every unfilled input EMPTY, which is what the
     verifier wants: a recipe's example target is a real host — scanme.nmap.org,
     a /24 — and running the recipe as written would scan it. With the examples
     withheld the target becomes a placeholder, which the verifier strips, and
     the flags are still proved against the binary with nothing to aim at. */
  const useExamples = !opts || opts.useExamples !== false;
  const filled = Object.create(null);
  for (const i of tool.inputs || []) {
    const given = (slots || {})[i.id];
    filled[i.id] = (given && String(given).trim()) ? given
      : (boundFromRecipe[i.id] ?? (useExamples ? (recipe.examples?.[i.id] ?? i.example ?? '') : ''));
  }

  const built = buildCommand(tool, mode, picked, filled, adhoc);
  /* A recipe is complete by construction, so an unfilled-value complaint would
     only ever mean the data is wrong — keep real errors, drop the rest. */
  return { ...built, usingExample: (tool.inputs || []).some(i => !((slots || {})[i.id] || '').trim() && filled[i.id]) };
}

/** Other flags that do the same job, for the "or swap it for" line. */
export function alternativesFor(tool, flag, modeId) {
  return (flag.alternatives || [])
    .map(a => ({ ...a, flag: flagById(tool, a.id) }))
    .filter(a => a.flag && (!modeId || !tool.modes.find(m => m.id === modeId) ||
                            tool.modes.find(m => m.id === modeId).flags.includes(a.id)))
    .map(a => ({ token: a.flag.short || a.flag.long, when: a.when, desc: resolveFlag(a.flag, modeId).desc }));
}

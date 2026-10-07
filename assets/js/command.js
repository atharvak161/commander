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

  for (const f of ordered) {
    if (!picked[f.id]) continue;
    const tok = f.short || f.long;
    let val = '';
    if (f.takes !== 'none') {
      val = f.binds ? (slots[f.binds] || '') : (adhoc[f.id] || '');
      if (!val) {
        const label = f.binds
          ? ((tool.inputs.find(i => i.id === f.binds) || {}).label || f.binds)
          : 'a value';
        issues.push({ err: true, text: `${tok} needs ${label} — fill it in on the right.` });
      }
    }
    argv.push(tok);
    if (val) argv.push(val);
    pieces.push({
      tok: tok + (val ? ' ' + shellQuote(val) : ''),
      label: f.desc,
      help: f.help || '',
      warn: f.warn,
      kind: 'flag',
    });
  }

  for (const f of flags) {
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

/* commander — client-side only. Nothing here sends anything anywhere.
   No framework, no build. What is committed is what runs. */
(function () {
  'use strict';

  var manifest = null;          // data/manifest.json
  var tool = null;              // the loaded tool document
  var manual = '';              // raw manual text for the help tab
  var mode = null;              // current mode id
  var picked = Object.create(null);   // flagId -> true
  var slots = Object.create(null);    // inputId -> string (persists across tools)
  var openPiece = null;         // which explainer piece is expanded

  var el = {};
  function $(id) { return document.getElementById(id); }

  /* Everything interpolated into innerHTML goes through esc(), including values
     that come from the tool JSON. That data is committed to this repo and gated
     by tools/check.mjs, so it is trusted — but a reference tool for security
     people is the wrong place to rely on that, and escaping costs nothing.
     The two exceptions are deliberate: encodeURIComponent() in an href, which
     percent-encodes quotes and cannot break the attribute, and Number() on a
     count. Command text goes to textContent, never innerHTML. */
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }

  /* Slot values survive moving between tools: you usually run three tools
     against the same target in a row. Per-browser only, never sent anywhere. */
  try { slots = JSON.parse(sessionStorage.getItem('commander.slots') || '{}') || {}; } catch (e) { slots = {}; }
  function saveSlots() { try { sessionStorage.setItem('commander.slots', JSON.stringify(slots)); } catch (e) {} }

  /* ---------------- routing ---------------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    if (!parts.length) return showHome();
    showTool(decodeURIComponent(parts[0]), parts[1] || null);
  }

  /* ---------------- home ---------------- */
  function showHome() {
    tool = null;
    el.home.hidden = false;
    el.tool.hidden = true;
    document.title = 'commander';
    if (el.q.value.trim()) return renderSearch(el.q.value.trim());
    renderGrid();
  }

  function renderGrid() {
    el.res.hidden = true;
    el.cats.hidden = false;
    if (!manifest) return;
    var byCat = {};
    manifest.tools.forEach(function (t) { (byCat[t.category] = byCat[t.category] || []).push(t); });
    el.cats.innerHTML = Object.keys(byCat).sort().map(function (c) {
      return '<section class="cat"><div class="cat-h">' + esc(c) + '</div><div class="grid">' +
        byCat[c].map(function (t) {
          return '<a class="card" href="#/' + encodeURIComponent(t.id) + '">' +
            '<div class="n">' + esc(t.name) + '</div>' +
            '<div class="s">' + esc(t.summary) + '</div>' +
            (t.flagCount ? '<div class="m">' + (Number(t.flagCount) || 0) + ' flags</div>' : '') +
            '</a>';
        }).join('') + '</div></section>';
    }).join('');
  }

  /* Global search covers tools AND individual flags, so you can look up a flag
     you half-remember without knowing which tool it belongs to. */
  function renderSearch(q) {
    el.cats.hidden = true;
    el.res.hidden = false;
    var needle = q.toLowerCase();
    var tools = (manifest ? manifest.tools : []).filter(function (t) {
      return (t.id + ' ' + t.name + ' ' + t.summary + ' ' + t.category).toLowerCase().indexOf(needle) >= 0;
    });
    var flags = (manifest && manifest.flagIndex ? manifest.flagIndex : []).filter(function (f) {
      return (f.f + ' ' + f.d).toLowerCase().indexOf(needle) >= 0;
    }).slice(0, 60);

    var out = '';
    if (tools.length) {
      out += '<div class="res-g">Tools</div>' + tools.map(function (t) {
        return '<a class="hit" href="#/' + encodeURIComponent(t.id) + '"><code>' + esc(t.name) + '</code>' +
          '<div class="d">' + esc(t.summary) + '</div></a>';
      }).join('');
    }
    if (flags.length) {
      out += '<div class="res-g">Flags</div>' + flags.map(function (f) {
        return '<a class="hit" href="#/' + encodeURIComponent(f.t) + '"><code>' + esc(f.f) + '</code>' +
          '<span class="in">in ' + esc(f.t) + '</span><div class="d">' + esc(f.d) + '</div></a>';
      }).join('');
    }
    el.res.innerHTML = out || '<div class="empty">Nothing matches &ldquo;' + esc(q) + '&rdquo;.</div>';
  }

  /* ---------------- tool ---------------- */
  function showTool(id, tab) {
    if (!manifest) return;
    if (!manifest.tools.some(function (t) { return t.id === id; })) {
      el.home.hidden = false; el.tool.hidden = true;
      el.cats.hidden = true; el.res.hidden = false;
      el.res.innerHTML = '<div class="empty">No tool called &ldquo;' + esc(id) + '&rdquo;.</div>';
      return;
    }
    el.home.hidden = true;
    el.tool.hidden = false;
    document.title = id + ' — commander';

    if (tool && tool.id === id) return renderTool(tab);

    fetch('data/tools/' + encodeURIComponent(id) + '.json')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (doc) {
        tool = doc;
        picked = Object.create(null);
        adhoc = Object.create(null);
        mode = doc.modes[0].id;
        openPiece = null;
        return fetch(doc.manual).then(function (r) { return r.ok ? r.text() : ''; })
          .catch(function () { return ''; });
      })
      .then(function (txt) { manual = txt || ''; renderTool(tab); })
      .catch(function () {
        el.tool.innerHTML = '<div class="empty">Could not load ' + esc(id) + '.</div>';
      });
  }

  function currentMode() {
    return tool.modes.find(function (m) { return m.id === mode; }) || tool.modes[0];
  }
  function modeFlags() {
    var allowed = currentMode().flags;
    return tool.flags.filter(function (f) { return allowed.indexOf(f.id) >= 0; });
  }
  function flagById(id) { return tool.flags.find(function (f) { return f.id === id; }); }

  function renderTool(tab) {
    tab = tab || 'build';
    var p = tool.provenance || {};
    el.tool.innerHTML =
      '<div class="tool-h"><h1>' + esc(tool.name) + '</h1><p class="sum">' + esc(tool.summary) + '</p></div>' +
      '<div class="prov"><b>v' + esc(p.toolVersion) + '</b> &middot; read from <b>' + esc(p.source) +
        '</b> &middot; verified <b>' + esc(p.verifiedAt) + '</b>' +
        (tool.homepage ? ' &middot; <a href="' + esc(tool.homepage) + '" target="_blank" rel="noopener noreferrer">homepage</a>' : '') +
      '</div>' +
      '<div class="tabs" role="tablist">' +
        '<button class="tab" role="tab" data-tab="build" aria-selected="' + (tab === 'build') + '">Build a command</button>' +
        '<button class="tab" role="tab" data-tab="manual" aria-selected="' + (tab === 'manual') + '">Manual</button>' +
      '</div>' +
      '<div id="pane"></div>';

    el.tool.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/' + encodeURIComponent(tool.id) + '/' + b.dataset.tab;
      });
    });
    if (tab === 'manual') renderManual(); else renderBuild();
  }

  /* ---------------- manual tab ---------------- */
  function renderManual() {
    $('pane').innerHTML =
      '<p class="manhint">Exactly what the tool prints, unedited. Prefer your own terminal? Copy the command and run it there for the current version.</p>' +
      '<div class="man-tools">' +
        '<input id="manq" type="search" placeholder="Search the manual" aria-label="Search the manual">' +
        '<button class="helpcmd" id="copyhelp">Copy &ldquo;' + esc(tool.helpCommand) + '&rdquo;</button>' +
      '</div><pre class="manual" id="manbody"></pre>';

    var body = $('manbody');
    function paint(q) {
      if (!q) { body.textContent = manual; return; }
      var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      body.innerHTML = esc(manual).replace(re, '<mark>$1</mark>');
    }
    paint('');
    $('manq').addEventListener('input', function () { paint(this.value.trim()); });
    $('copyhelp').addEventListener('click', function () {
      copy(tool.helpCommand, this, 'Copy &ldquo;' + esc(tool.helpCommand) + '&rdquo;');
    });
  }

  /* ---------------- build tab ---------------- */
  function renderBuild() {
    var modesHtml = tool.modes.length > 1
      ? '<div class="modes">' + tool.modes.map(function (m) {
          return '<button class="mode" data-mode="' + esc(m.id) + '" aria-pressed="' + (m.id === mode) + '">' + esc(m.name) + '</button>';
        }).join('') + '</div>'
      : '';

    $('pane').innerHTML = modesHtml +
      '<div class="cols"><div id="picker"></div>' +
      '<aside class="panel"><h2>Your values</h2><div id="slots"></div></aside></div>' +
      '<div class="cmdwrap">' +
        '<div class="cmdbar"><p class="cmd" id="cmd"></p><button class="copy" id="copy">Copy</button></div>' +
        '<div class="issues" id="issues"></div>' +
        '<div class="explain"><div class="explain-h">What this command does, piece by piece</div><div class="pieces" id="pieces"></div></div>' +
        '<div class="auth"><b>You run this, not the site.</b> commander generates text and executes nothing. ' +
          'Only point a generated command at a system you own or have written permission to test.</div>' +
      '</div>';

    $('pane').querySelectorAll('.mode').forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.dataset.mode;
        picked = Object.create(null);
        openPiece = null;
        renderBuild();
      });
    });
    $('copy').addEventListener('click', function () { copy(buildCommand().text, this, 'Copy'); });

    renderPicker();
    renderSlots();
    renderCommand();
  }

  /* A flag is blocked when something already picked conflicts with it. The
     reason is shown rather than the button just going dead. */
  function blockedBy(f) {
    for (var id in picked) {
      if (!picked[id]) continue;
      var other = flagById(id);
      if (!other) continue;
      if ((other.conflicts || []).indexOf(f.id) >= 0) return other;
      if ((f.conflicts || []).indexOf(id) >= 0) return other;
    }
    return null;
  }

  function renderPicker() {
    var groups = {};
    modeFlags().forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    $('picker').innerHTML = Object.keys(groups).map(function (g) {
      return '<div class="fg"><div class="fg-h">' + esc(g) + '</div><div class="flags">' +
        groups[g].map(function (f) {
          var b = blockedBy(f);
          var on = !!picked[f.id];
          var warn = f.warn ? '<span class="wn" title="' + esc(f.warn) + '">' + ({root:'&#9888;',slow:'&#9203;',noisy:'&#128226;',destructive:'&#9888;'}[f.warn] || '') + '</span>' : '';
          return '<button class="flag" data-id="' + esc(f.id) + '" aria-pressed="' + on + '"' +
            (b && !on ? ' disabled title="Conflicts with ' + esc(b.short || b.long) + '"' : '') + '>' +
            esc(f.short || f.long) + (f.required ? '<span class="req">*</span>' : '') + warn + '</button>';
        }).join('') + '</div></div>';
    }).join('');

    $('picker').querySelectorAll('.flag').forEach(function (b) {
      var f = flagById(b.dataset.id);
      b.addEventListener('click', function () {
        if (b.disabled) return;
        if (picked[f.id]) { delete picked[f.id]; }
        else {
          picked[f.id] = true;
          /* Pull in anything this flag declares it needs. Doing it silently is
             wrong, so it is surfaced as an issue line below the command. */
          (f.requires || []).forEach(function (r) { if (flagById(r)) picked[r] = true; });
        }
        openPiece = null;
        renderPicker(); renderSlots(); renderCommand();
      });
      b.addEventListener('mouseenter', function () { showTip(b, f); });
      b.addEventListener('focus', function () { showTip(b, f); });
      b.addEventListener('mouseleave', hideTip);
      b.addEventListener('blur', hideTip);
    });
  }

  var tipEl = null;
  function showTip(anchor, f) {
    hideTip();
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    var forms = [f.short, f.long].filter(Boolean).join(', ');
    tipEl.innerHTML = '<div class="t">' + esc(forms) + (f.takes !== 'none' ? ' &lt;' + esc(f.takes) + '&gt;' : '') + '</div>' +
      esc(f.desc) +
      (f.help ? '<div style="margin-top:6px">' + esc(f.help) + '</div>' : '') +
      (f.warn ? '<div class="wn">' + esc({root:'Needs root.',slow:'Slow.',noisy:'Noisy — this will show in logs.',destructive:'Destructive — can change or delete data.'}[f.warn] || f.warn) + '</div>' : '') +
      '<div class="meta">' +
        (f.default ? 'default: ' + esc(f.default) + ' &middot; ' : '') +
        (f.requires && f.requires.length ? 'needs ' + esc(f.requires.map(function(r){var x=flagById(r);return x?(x.short||x.long):r;}).join(', ')) + ' &middot; ' : '') +
        (f.conflicts && f.conflicts.length ? 'clashes with ' + esc(f.conflicts.map(function(c){var x=flagById(c);return x?(x.short||x.long):c;}).join(', ')) + ' &middot; ' : '') +
        'from ' + esc(f.source) +
      '</div>';
    document.body.appendChild(tipEl);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + window.scrollY + 6;
    var left = Math.min(r.left + window.scrollX, window.innerWidth - tipEl.offsetWidth - 12);
    tipEl.style.top = top + 'px';
    tipEl.style.left = Math.max(8, left) + 'px';
  }
  function hideTip() { if (tipEl) { tipEl.remove(); tipEl = null; } }

  /* Flags that take a value but are not bound to a named slot still need
     somewhere to type. Without this the command bar says "needs a value" and
     offers no way to give one, which is a dead end rather than a warning. */
  var adhoc = Object.create(null);   // flagId -> string

  function unboundPicked() {
    return modeFlags().filter(function (f) {
      return picked[f.id] && f.takes !== 'none' && !f.binds;
    });
  }

  /* Only the slots the current selection actually needs are shown. */
  function activeSlots() {
    var need = {};
    modeFlags().forEach(function (f) { if (picked[f.id] && f.binds) need[f.binds] = true; });
    return (tool.inputs || []).filter(function (i) { return need[i.id]; });
  }

  function renderSlots() {
    var act = activeSlots();
    var loose = unboundPicked();

    if (!act.length && !loose.length) {
      $('slots').innerHTML = '<p class="none">Pick a flag that takes a value and its box appears here.</p>';
      return;
    }

    var html = act.map(function (i) {
      var users = modeFlags().filter(function (f) { return picked[f.id] && f.binds === i.id; })
        .map(function (f) { return f.short || f.long; }).join(', ');
      return '<div class="slot"><label for="slot-' + esc(i.id) + '">' + esc(i.label) + '</label>' +
        '<input id="slot-' + esc(i.id) + '" value="' + esc(slots[i.id] || '') + '" placeholder="' + esc(i.placeholder || '') + '">' +
        '<div class="used">used by ' + esc(users) + '</div></div>';
    }).join('');

    html += loose.map(function (f) {
      var tok = f.short || f.long;
      return '<div class="slot"><label for="adhoc-' + esc(f.id) + '">' + esc(tok) +
        ' <span style="color:var(--text-faint)">&lt;' + esc(f.takes) + '&gt;</span></label>' +
        '<input id="adhoc-' + esc(f.id) + '" value="' + esc(adhoc[f.id] || '') + '" placeholder="' + esc(f.takes) + '">' +
        '<div class="used">' + esc(f.desc.slice(0, 54)) + '</div></div>';
    }).join('');

    $('slots').innerHTML = html;

    act.forEach(function (i) {
      $('slot-' + i.id).addEventListener('input', function () {
        slots[i.id] = this.value; saveSlots(); renderCommand();
      });
    });
    loose.forEach(function (f) {
      $('adhoc-' + f.id).addEventListener('input', function () {
        adhoc[f.id] = this.value; renderCommand();
      });
    });
  }

  /* Quote only when the shell would need it. Over-quoting is as wrong as
     under-quoting: it changes what the tool receives. */
  function q(v) {
    if (v === '' || v == null) return v;
    return /[\s"'$`\\<>|&;()*?!#~\[\]{}]/.test(v) ? "'" + String(v).replace(/'/g, "'\\''") + "'" : v;
  }

  /* One place builds the command, and the explainer reads the same pieces, so
     the two can never disagree. */
  function buildCommand() {
    var pieces = [];
    var issues = [];
    var m = currentMode();

    pieces.push({ tok: tool.name, label: 'the tool', help: tool.summary, kind: 'bin' });
    if (tool.modes.length > 1) pieces.push({ tok: m.name, label: 'mode: ' + m.summary.replace(/\.$/, ''), help: m.summary, kind: 'mode' });

    /* Required flags lead. They are the subject of the command - the target and
       the wordlist - and burying them behind optional ones makes it harder to
       read, which defeats the point of the explainer below. */
    var ordered = modeFlags().slice().sort(function (a, b) {
      return (b.required ? 1 : 0) - (a.required ? 1 : 0);
    });

    ordered.forEach(function (f) {
      if (!picked[f.id]) return;
      var tok = f.short || f.long;
      var val = '';
      if (f.takes !== 'none') {
        val = f.binds ? (slots[f.binds] || '') : (adhoc[f.id] || '');
        if (!val) {
          var label = f.binds
            ? ((tool.inputs.find(function (i) { return i.id === f.binds; }) || {}).label || f.binds)
            : 'a value';
          issues.push({ err: true, text: tok + ' needs ' + label + ' — fill it in on the right.' });
        }
      }
      pieces.push({
        tok: tok + (val ? ' ' + q(val) : ''),
        label: f.desc,
        help: f.help || '',
        warn: f.warn,
        kind: 'flag',
      });
    });

    modeFlags().forEach(function (f) {
      if (f.required && !picked[f.id]) {
        issues.push({ err: true, text: (f.short || f.long) + ' is required by ' + tool.name + (tool.modes.length > 1 ? ' ' + m.name : '') + '.' });
      }
      if (!picked[f.id]) return;
      (f.requires || []).forEach(function (r) {
        var o = flagById(r);
        if (o && !picked[r]) issues.push({ err: false, text: (f.short || f.long) + ' needs ' + (o.short || o.long) + '.' });
      });
    });

    return { text: pieces.map(function (p) { return p.tok; }).join(' '), pieces: pieces, issues: issues };
  }

  function renderCommand() {
    var b = buildCommand();
    $('cmd').textContent = b.text;
    $('issues').innerHTML = b.issues.map(function (i) {
      return '<div class="issue' + (i.err ? ' err' : '') + '">' + esc(i.text) + '</div>';
    }).join('');

    /* A piece only becomes a button when there is a longer explanation behind
       it. A control that looks interactive and does nothing is worse than a
       plain label, and `help` is empty until the human writing pass fills it. */
    $('pieces').innerHTML = b.pieces.map(function (p, idx) {
      var more = p.help && p.help !== p.label;
      var tag = more ? 'button' : 'div';
      return '<' + tag + ' class="piece' + (more ? '' : ' static') + '"' + (more ? ' data-i="' + idx + '"' : '') + '>' +
        '<div class="tok">' + esc(p.tok) + '</div>' +
        '<div class="arrow">&#8595;</div>' +
        '<div class="lbl">' + esc(p.label) + '</div>' +
        (p.warn ? '<div class="wn">' + esc({root:'needs root',slow:'slow',noisy:'noisy',destructive:'destructive'}[p.warn] || p.warn) + '</div>' : '') +
        (openPiece === idx && more ? '<div class="more">' + esc(p.help) + '</div>' : '') +
        '</' + tag + '>';
    }).join('');

    $('pieces').querySelectorAll('button.piece').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = Number(btn.dataset.i);
        openPiece = (openPiece === i) ? null : i;
        renderCommand();
      });
    });
  }

  function copy(text, btn, restore) {
    var done = function () {
      var old = btn.innerHTML; btn.textContent = 'Copied';
      setTimeout(function () { btn.innerHTML = restore || old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacy(text, done); });
    } else { legacy(text, done); }
  }
  function legacy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    ta.remove();
  }

  /* ---------------- boot ---------------- */
  document.addEventListener('DOMContentLoaded', function () {
    el.home = $('home'); el.tool = $('toolview'); el.cats = $('cats'); el.res = $('results'); el.q = $('q');

    el.q.addEventListener('input', function () {
      var v = this.value.trim();
      if (location.hash && location.hash !== '#/' && v) location.hash = '#/';
      if (!tool) { v ? renderSearch(v) : renderGrid(); }
    });

    fetch('data/manifest.json')
      .then(function (r) { return r.json(); })
      .then(function (m) { manifest = m; route(); })
      .catch(function () { el.cats.innerHTML = '<div class="empty">Could not load the tool list.</div>'; });

    window.addEventListener('hashchange', function () { hideTip(); route(); });
  });
})();

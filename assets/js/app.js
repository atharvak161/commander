/* commander — client-side only. Nothing here sends anything anywhere.
   No framework, no build. What is committed is what runs.

   Command building lives in command.js and is imported, not reimplemented:
   the verifier imports the same module, so the command the tests prove valid
   is byte-for-byte the command shown here. */
import { buildCommand as build, blockedBy as blocked, shellQuote, resolveFlag,
         buildRecipe, alternativesFor } from './command.js?v=aa98b59808';

(function () {
  'use strict';

  /* Written by tools/stamp.mjs from a hash of data/. Appended to every data
     fetch so a deploy cannot be served stale JSON from a browser cache. */
  var ASSET_V = 'bd44f84f76';
  function dataUrl(path) { return ASSET_V ? path + '?v=' + ASSET_V : path; }

  var manifest = null;          // data/manifest.json
  var tool = null;              // the loaded tool document
  var manual = '';              // raw manual text for the help tab
  var mode = null;              // current mode id
  var picked = Object.create(null);   // flagId -> true
  var slots = Object.create(null);    // inputId -> string, per tool
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


  /* ---- engagement context (typed, shared across tools) ----
     Set a value once, and the tools that take that exact TYPE prefill it.
     TYPED on purpose: a host is not a URL is not a FUZZ-url. The map below
     only pairs an input with a context key when the shapes genuinely match,
     so setting a host fills nmap and gobuster but never the URL-shaped inputs
     of curl, sqlmap or ffuf. That mismatch is the bug this design avoids:
     sqlmap's URL once leaked into nmap and produced an impossible command.
     Prefill only ever fills an EMPTY slot; it never overwrites what you typed. */
  var ctx = { host: '', wordlist: '', lhost: '', lport: '' };
  var CTX_FIELDS = [
    { key: 'host', label: 'Target host / IP', ph: '10.10.10.10' },
    { key: 'wordlist', label: 'Wordlist', ph: '/path/to/wordlist.txt' },
    { key: 'lhost', label: 'Your IP (LHOST)', ph: '10.10.14.1' },
    { key: 'lport', label: 'Port (LPORT)', ph: '4444' },
  ];
  /* tool.id + '/' + input.id  ->  context key. Only safe, type-matched pairs. */
  var CTX_MAP = {
    'nmap/target': 'host',
    'gobuster/target': 'host',
    'ffuf/wordlist': 'wordlist',
    'gobuster/wordlist': 'wordlist',
  };
  function loadCtx() {
    try {
      var v = JSON.parse(sessionStorage.getItem('commander.ctx') || 'null');
      if (v && typeof v === 'object') Object.keys(ctx).forEach(function (k) {
        if (typeof v[k] === 'string') ctx[k] = v[k];
      });
    } catch (e) {}
  }
  function saveCtx() { try { sessionStorage.setItem('commander.ctx', JSON.stringify(ctx)); } catch (e) {} }
  /* Fill empty, type-matched slots for the current tool from the context. */
  function applyCtxToSlots() {
    if (!tool) return;
    (tool.inputs || []).forEach(function (i) {
      var key = CTX_MAP[tool.id + '/' + i.id];
      if (key && ctx[key] && !(slots[i.id] || '').trim()) {
        slots[i.id] = ctx[key];
      }
    });
    saveSlots();
  }

  /* Slot values are remembered PER TOOL, never shared between them.
     They used to be shared, on the theory that you run several tools against
     the same target in a row. In practice the tools do not want the same shape
     of target: ffuf wants a URL containing FUZZ, sqlmap wants a URL with a
     parameter, nmap wants a host or a CIDR block and does not take a URL at
     all. Carrying sqlmap's URL into nmap silently produced
     "nmap 'http://site.example.com/page.php?id=1'" — a filled-in box, no
     warning, and a command that cannot work. Per-browser only, never sent
     anywhere, and it degrades to empty if storage is unavailable. */
  function slotKey() { return 'commander.slots.' + (tool ? tool.id : '_none'); }
  function loadSlots() {
    try { slots = JSON.parse(sessionStorage.getItem(slotKey()) || '{}') || {}; }
    catch (e) { slots = Object.create(null); }
  }
  function saveSlots() { try { sessionStorage.setItem(slotKey(), JSON.stringify(slots)); } catch (e) {} }

  /* ---------------- routing ---------------- */
  var lastRoute = null;
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/').filter(Boolean);
    /* A new view starts at the top. Without this you click a tool from halfway
       down the grid and land halfway down the tool page, with the back control
       already scrolled up behind the sticky header. Switching tabs inside one
       view keeps your place, which is what you want there. */
    if (parts[0] !== lastRoute) { window.scrollTo(0, 0); lastRoute = parts[0] || null; }
    if (!parts.length) return showHome();
    if (parts[0] === 'methodology') return showMethodology(parts[1] || null);
    if (parts[0] === 'shells') return showShells(parts[1] || null);
    if (parts[0] === 'payloads') return showPayloads(parts[1] || null);
    if (parts[0] === 'cheatsheet') return showCheat(parts[1] || null);
    if (parts[0] === 'notes') return showNotes();
    showTool(decodeURIComponent(parts[0]), parts[1] || null);
  }

  /* ---------------- home ---------------- */
  var NAV = { tools: 'nav-tools', meth: 'nav-meth', shells: 'nav-shells', payloads: 'nav-payloads', cheat: 'nav-cheat', notes: 'nav-notes' };
  function setNav(which) {
    Object.keys(NAV).forEach(function (k) {
      var a = $(NAV[k]);
      if (a) a.setAttribute('aria-current', k === which ? 'page' : 'false');
    });
  }

  /* Every view that is not the home grid gets one back control, in the same
     shape as the link out to the portfolio. Browser back only works if you
     arrived by a link; this works however you got here, including a pasted
     deep link or a reload. */
  function setBack(label, href) {
    var b = $('back');
    if (!b) return;
    if (!label) { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = '\u2190 ' + label;
    b.setAttribute('href', href);
  }


  /* One place that hides every section view. Each show* calls this, then
     reveals its own. Prevents the cross-view leaks the ad-hoc per-view hiding
     kept reintroducing as sections were added. */
  function hideAllViews() {
    el.home.hidden = true;
    el.tool.hidden = true;
    if (el.meth) el.meth.hidden = true;
    if (el.shells) el.shells.hidden = true;
    if (el.payloads) el.payloads.hidden = true;
    if (el.cheat) el.cheat.hidden = true;
    if (el.notes) el.notes.hidden = true;
  }

  function showHome() {
    setNav('tools');
    setBack(null);
    tool = null;
    el.home.hidden = false;
    el.tool.hidden = true;
    if (el.meth) el.meth.hidden = true;
    if (el.shells) el.shells.hidden = true;
    if (el.payloads) el.payloads.hidden = true;
    if (el.cheat) el.cheat.hidden = true;
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
      hideAllViews(); el.home.hidden = false;
      el.cats.hidden = true; el.res.hidden = false;
      setBack('All tools', '#/');
      el.res.innerHTML = '<div class="empty">No tool called &ldquo;' + esc(id) + '&rdquo;.</div>';
      return;
    }
    hideAllViews();
    setNav('tools');
    el.tool.hidden = false;
    setBack('All tools', '#/');
    document.title = id + ' — commander';

    if (tool && tool.id === id) return renderTool(tab);

    fetch(dataUrl('data/tools/' + encodeURIComponent(id) + '.json'))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (doc) {
        tool = doc;
        loadSlots();          // this tool's own values, never another tool's
        applyCtxToSlots();     // prefill empty, type-matched slots from the context
        picked = Object.create(null);
        adhoc = Object.create(null);
        mode = doc.modes[0].id;
        openPiece = null;
        return fetch(dataUrl(doc.manual)).then(function (r) { return r.ok ? r.text() : ''; })
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
    var mid = currentMode().id;
    /* Resolved for THIS mode, so the tooltip, the type of the input box and
       which slot a flag binds to all match the mode you are actually in.
       gobuster's --timeout is 10s in dir and 1s in dns; --domain is the target
       in dns and something else entirely in dir. */
    return tool.flags
      .filter(function (f) { return allowed.indexOf(f.id) >= 0; })
      .map(function (f) { return resolveFlag(f, mid); });
  }
  /* Resolved for the current mode. The tooltip, the value box and the
     explainer all come through here, and an unresolved lookup showed
     gobuster's --timeout as "HTTP Timeout, default 10s" while you were in dns
     mode, where it is the DNS resolver timeout and defaults to 1s. */
  function flagById(id) {
    var f = tool.flags.find(function (x) { return x.id === id; });
    return f ? resolveFlag(f, currentMode().id) : f;
  }

  function renderTool(tab) {
    tab = tab || 'build';
    var p = tool.provenance || {};
    el.tool.innerHTML =
      '<div class="tool-h"><h1>' + esc(tool.name) + '</h1><p class="sum">' + esc(tool.summary) + '</p></div>' +
      '<div class="prov"><b>v' + esc(p.toolVersion) + '</b> &middot; read from <b>' + esc(p.source) +
        '</b> &middot; verified <b>' + esc(p.verifiedAt) + '</b>' +
        (tool.homepage ? ' &middot; <a href="' + esc(tool.homepage) + '" target="_blank" rel="noopener noreferrer">homepage</a>' : '') +
      '</div>' +
      ctxBarHtml(tool) +
      '<div class="tabs" role="tablist">' +
        '<button class="tab" role="tab" data-tab="build" aria-selected="' + (tab === 'build') + '">Build a command</button>' +
        ((tool.recipes || []).length
          ? '<button class="tab" role="tab" data-tab="ready" aria-selected="' + (tab === 'ready') + '">Ready-made <span class="cnt">' + Number(tool.recipes.length) + '</span></button>'
          : '') +
        '<button class="tab" role="tab" data-tab="manual" aria-selected="' + (tab === 'manual') + '">Manual</button>' +
      '</div>' +
      '<div id="pane"></div>';

    el.tool.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () {
        location.hash = '#/' + encodeURIComponent(tool.id) + '/' + b.dataset.tab;
      });
    });
    wireCtxBar();
    if (tab === 'manual') renderManual();
    else if (tab === 'ready') renderReady();
    else renderBuild();
  }

  /* The context bar shows only the fields that can actually fill one of this
     tool's inputs, so it never offers a box that does nothing here. LHOST and
     LPORT are shown on the Shells tab instead, where they belong. */
  function ctxBarHtml(t) {
    var keys = {};
    (t.inputs || []).forEach(function (i) {
      var k = CTX_MAP[t.id + '/' + i.id]; if (k) keys[k] = true;
    });
    var fields = CTX_FIELDS.filter(function (f) { return keys[f.key]; });
    if (!fields.length) return '';
    return '<div class="ctxbar"><span class="ctxbar-l">Set once, fills below:</span>' +
      fields.map(function (f) {
        return '<label class="ctxf"><span>' + esc(f.label) + '</span>' +
          '<input id="ctx-' + f.key + '" value="' + esc(ctx[f.key]) + '" placeholder="' + esc(f.ph) +
          '" spellcheck="false" autocomplete="off"></label>';
      }).join('') + '</div>';
  }
  function wireCtxBar() {
    CTX_FIELDS.forEach(function (f) {
      var node = $('ctx-' + f.key); if (!node) return;
      node.addEventListener('input', function () {
        ctx[f.key] = node.value; saveCtx();
        /* fill matching empty slots, then repaint the slot inputs and command */
        applyCtxToSlots();
        syncSlotInputs();
      });
    });
  }
  /* Push context-filled slot values into the visible slot inputs without a full
     re-render, so the cursor in the context bar is not disturbed. */
  function syncSlotInputs() {
    (tool.inputs || []).forEach(function (i) {
      var el2 = $('slot-' + i.id);
      if (el2 && el2.value !== (slots[i.id] || '')) el2.value = slots[i.id] || '';
      var el3 = $('rslot-' + i.id);
      if (el3 && el3.value !== (slots[i.id] || '')) el3.value = slots[i.id] || '';
    });
    if (typeof renderCommand === 'function') try { renderCommand(); } catch (e) {}
    if (typeof paintRecipes === 'function') try { paintRecipes(); } catch (e) {}
  }


  /* ---------------- shells ---------------- */
  /* Nothing here runs. The browser substitutes three values into published
     payload strings and hands you text, exactly like the command builders.
     Payload text lives in data/shells.json, so a new payload is a data edit. */
  var SHELLS = null;
  var shellCfg = { ip: '10.10.14.1', port: '4444', shell: '/bin/sh', enc: 'none' };

  function loadShellCfg() {
    try {
      var v = JSON.parse(sessionStorage.getItem('commander.shell') || 'null');
      if (v && typeof v === 'object') Object.keys(shellCfg).forEach(function (k) {
        if (typeof v[k] === 'string') shellCfg[k] = v[k];
      });
    } catch (e) {}
    /* LHOST/LPORT are shared with the engagement context. The context wins if set. */
    if (ctx.lhost) shellCfg.ip = ctx.lhost;
    if (ctx.lport) shellCfg.port = ctx.lport;
  }
  function saveShellCfg() {
    try { sessionStorage.setItem('commander.shell', JSON.stringify(shellCfg)); } catch (e) {}
  }

  /* btoa throws on anything above U+00FF and apply() on a long array can blow
     the stack, so chunk it. Payloads are ASCII, but a pasted target name might
     not be, and a thrown exception would take the whole page down. */
  function b64(str) {
    try {
      var out = '';
      for (var i = 0; i < str.length; i += 4096) {
        out += String.fromCharCode.apply(null, Array.prototype.map.call(
          str.slice(i, i + 4096), function (c) { return c.charCodeAt(0) & 0xff; }));
      }
      return btoa(out);
    } catch (e) { return ''; }
  }
  /* powershell -e wants UTF-16LE, not UTF-8. Getting this wrong is the single
     most common reason an encoded PowerShell payload silently does nothing. */
  function b64utf16le(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      bytes.push(c & 0xff, (c >> 8) & 0xff);
    }
    var out = '';
    for (var j = 0; j < bytes.length; j += 4096) {
      out += String.fromCharCode.apply(null, bytes.slice(j, j + 4096));
    }
    try { return btoa(out); } catch (e) { return ''; }
  }

  function fillShell(text, payload) {
    var sh = (payload && payload.fixedShell) || shellCfg.shell;
    return String(text)
      .replace(/\{ip\}/g, shellCfg.ip || '{ip}')
      .replace(/\{port\}/g, shellCfg.port || '{port}')
      .replace(/\{shell\}/g, sh);
  }

  /* {b64ps} is the PowerShell TCP payload, encoded. It is resolved from the
     data rather than duplicated here, so editing that payload updates both. */
  function resolveB64ps(text) {
    if (text.indexOf('{b64ps}') === -1) return text;
    var src = '';
    SHELLS.groups.some(function (g) {
      return g.payloads.some(function (pl) {
        if (pl.id !== 'powershell-tcp') return false;
        src = fillShell(pl.text, pl);
        return true;
      });
    });
    var inner = src.replace(/^powershell\s+-nop\s+-w\s+hidden\s+-c\s+"/, '').replace(/"$/, '');
    return text.replace(/\{b64ps\}/g, b64utf16le(inner) || '<powershell payload unavailable>');
  }

  function encodePayload(cmd) {
    if (shellCfg.enc === 'url') return encodeURIComponent(cmd);
    if (shellCfg.enc === 'double') return encodeURIComponent(encodeURIComponent(cmd));
    if (shellCfg.enc === 'b64') {
      var e = b64(cmd);
      return e ? 'echo ' + e + ' | base64 -d | ' + (shellCfg.shell || '/bin/sh') : cmd;
    }
    return cmd;
  }

  function payloadText(pl) {
    return encodePayload(resolveB64ps(fillShell(pl.text, pl)));
  }

  function showShells(which) {
    tool = null;
    hideAllViews();
    el.shells.hidden = false;
    setNav('shells');
    setBack('All tools', '#/');
    document.title = 'Reverse shells — commander';

    if (SHELLS) return renderShells(which);
    el.shells.innerHTML = '<p class="manhint">Loading…</p>';
    fetch(dataUrl('data/shells.json'))
      .then(function (r) { return r.json(); })
      .then(function (d) { SHELLS = d; loadShellCfg(); renderShells(which); })
      .catch(function () {
        el.shells.innerHTML = '<div class="empty">Could not load the shell data.</div>';
      });
  }

  function renderShells(which) {
    var tabs = SHELLS.groups.map(function (g) { return { id: g.id, name: g.name }; })
      .concat([{ id: 'listeners', name: 'Listeners' }, { id: 'upgrade', name: 'Upgrade a shell' }]);
    var active = which && tabs.some(function (t) { return t.id === which; }) ? which : tabs[0].id;

    el.shells.innerHTML =
      '<div class="tool-h"><h1>Reverse shells</h1>' +
        '<p class="sum">Fill in your address and port once. Every payload below updates. ' +
        'Nothing is executed and nothing leaves your browser — this page does string ' +
        'substitution and hands you text.</p></div>' +
      '<div class="shcfg">' +
        field('sh-ip', 'Your IP (LHOST)', shellCfg.ip, 'text', '10.10.14.1') +
        field('sh-port', 'Port (LPORT)', shellCfg.port, 'text', '4444') +
        select('sh-shell', 'Shell', SHELLS.shells, shellCfg.shell) +
        select('sh-enc', 'Encoding', SHELLS.encodings.map(function (e) { return e.id; }),
               shellCfg.enc, SHELLS.encodings) +
      '</div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="tab" role="tab" data-m="' + esc(t.id) + '" aria-selected="' +
          (t.id === active) + '">' + esc(t.name) + '</button>';
      }).join('') + '</div>' +
      '<div id="shpane"></div>';

    el.shells.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#/shells/' + b.dataset.m; });
    });
    bindShellCfg(active);
    renderShellPane(active);
  }

  function field(id, label, val, type, ph) {
    return '<label class="shf"><span>' + esc(label) + '</span>' +
      '<input id="' + id + '" type="' + type + '" value="' + esc(val) +
      '" placeholder="' + esc(ph) + '" spellcheck="false" autocomplete="off"></label>';
  }
  function select(id, label, values, cur, meta) {
    return '<label class="shf"><span>' + esc(label) + '</span><select id="' + id + '">' +
      values.map(function (v) {
        var name = v;
        if (meta) { var m = meta.find(function (x) { return x.id === v; }); if (m) name = m.name; }
        return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' +
          esc(name) + '</option>';
      }).join('') + '</select></label>';
  }

  function bindShellCfg(active) {
    [['sh-ip', 'ip'], ['sh-port', 'port'], ['sh-shell', 'shell'], ['sh-enc', 'enc']]
      .forEach(function (pair) {
        var node = $(pair[0]);
        if (!node) return;
        node.addEventListener('input', function () {
          shellCfg[pair[1]] = node.value;
          if (pair[1] === 'ip') { ctx.lhost = node.value; saveCtx(); }
          if (pair[1] === 'port') { ctx.lport = node.value; saveCtx(); }
          saveShellCfg();
          renderShellPane(active);     // re-render the list, never the inputs
        });
      });
  }

  function cmdRow(pl, idx) {
    var text = payloadText(pl);
    return '<div class="shp">' +
      '<div class="shp-h"><span class="shp-n">' + esc(pl.name) + '</span>' +
        (pl.platform && pl.platform !== 'linux'
          ? '<span class="shp-p">' + esc(pl.platform) + '</span>' : '') +
        '<button class="shp-c" data-i="' + idx + '">Copy</button></div>' +
      '<pre class="shp-t"><code></code></pre>' +
      (pl.note ? '<p class="shp-d">' + esc(pl.note) + '</p>' : '') +
      (pl.warn ? '<div class="mwarn">' + esc(pl.warn) + '</div>' : '') +
    '</div>';
  }

  function renderShellPane(active) {
    var pane = $('shpane');
    if (!pane) return;
    var list, intro = '';

    if (active === 'listeners') {
      list = SHELLS.listeners;
      intro = 'Run one of these on your own machine first. The payload has nowhere to connect ' +
              'to until something is listening.';
    } else if (active === 'upgrade') {
      return renderUpgrade(pane);
    } else {
      var g = SHELLS.groups.find(function (x) { return x.id === active; });
      if (!g) return;
      list = g.payloads;
      intro = g.intro;
    }

    pane.innerHTML = '<p class="readyhint">' + esc(intro) + '</p>' +
      '<div class="shgrid">' + list.map(cmdRow).join('') + '</div>';

    /* Command text goes in through textContent, never innerHTML: it is full of
       angle brackets and quotes, and a payload is exactly the kind of string
       that must never be parsed as markup. */
    var codes = pane.querySelectorAll('.shp-t code');
    list.forEach(function (pl, i) { if (codes[i]) codes[i].textContent = payloadText(pl); });

    pane.querySelectorAll('.shp-c').forEach(function (b) {
      b.addEventListener('click', function () {
        copy(payloadText(list[Number(b.dataset.i)]), b, 'Copy');
      });
    });
  }

  function renderUpgrade(pane) {
    pane.innerHTML =
      '<p class="readyhint">A reverse shell is not a terminal. No job control, no tab ' +
      'completion, Ctrl-C kills your listener instead of the remote process, and sudo and ' +
      'ssh refuse to run at all. Three steps fix it.</p>' +
      SHELLS.upgrade.map(function (st) {
        return '<div class="shup"><div class="shup-h">' + esc(st.name) + '</div>' +
          '<p class="shup-w">' + esc(st.why) + '</p>' +
          '<pre class="shup-t"><code></code></pre></div>';
      }).join('');
    var codes = pane.querySelectorAll('.shup-t code');
    SHELLS.upgrade.forEach(function (st, i) {
      if (codes[i]) codes[i].textContent = st.cmds.map(function (c) {
        return fillShell(c, null);
      }).join('\n');
    });
  }


  /* ---------------- payloads ---------------- */
  /* Static reference vectors. No substitution: the page shows the text and a
     copy button. Data in data/payloads.json, so a new payload is a data edit. */
  var PAYLOADS = null;
  function showPayloads(which) {
    tool = null;
    hideAllViews();
    el.payloads.hidden = false;
    setNav('payloads');
    setBack('All tools', '#/');
    document.title = 'Payloads — commander';
    if (PAYLOADS) return renderPayloads(which);
    el.payloads.innerHTML = '<p class="manhint">Loading…</p>';
    fetch(dataUrl('data/payloads.json'))
      .then(function (r) { return r.json(); })
      .then(function (d) { PAYLOADS = d; renderPayloads(which); })
      .catch(function () { el.payloads.innerHTML = '<div class="empty">Could not load the payload data.</div>'; });
  }
  function renderPayloads(which) {
    var tabs = PAYLOADS.groups.map(function (g) { return { id: g.id, name: g.name }; });
    var active = which && tabs.some(function (t) { return t.id === which; }) ? which : tabs[0].id;
    el.payloads.innerHTML =
      '<div class="tool-h"><h1>Payloads</h1>' +
        '<p class="sum">Proof-of-concept vectors for authorized web testing, from OWASP WSTG and ' +
        'PayloadsAllTheThings. Paste one into your own test request. Nothing here runs.</p></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="tab" role="tab" data-m="' + esc(t.id) + '" aria-selected="' +
          (t.id === active) + '">' + esc(t.name) + '</button>';
      }).join('') + '</div><div id="plpane"></div>';
    el.payloads.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#/payloads/' + b.dataset.m; });
    });
    renderPayloadPane(active);
  }
  function renderPayloadPane(active) {
    var pane = $('plpane'); if (!pane) return;
    var g = PAYLOADS.groups.find(function (x) { return x.id === active; });
    if (!g) return;
    pane.innerHTML = '<p class="readyhint">' + esc(g.intro) +
      (g.wstg ? ' <b>' + esc(g.wstg) + '</b>' : '') + '</p>' +
      '<div class="shgrid">' + g.payloads.map(function (pl, i) {
        return '<div class="shp">' +
          '<div class="shp-h"><button class="shp-c" data-i="' + i + '">Copy</button></div>' +
          '<pre class="shp-t"><code></code></pre>' +
          '<p class="shp-d">' + esc(pl.note) + '</p>' +
          (pl.warn ? '<div class="mwarn">' + esc(pl.warn) + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    var codes = pane.querySelectorAll('.shp-t code');
    g.payloads.forEach(function (pl, i) { if (codes[i]) codes[i].textContent = pl.text; });
    pane.querySelectorAll('.shp-c').forEach(function (b) {
      b.addEventListener('click', function () {
        copy(g.payloads[Number(b.dataset.i)].text, b, 'Copy');
      });
    });
  }



  /* ---------------- notes / scratchpad ---------------- */
  /* The report is the deliverable, every framework on the methodology page says
     so, and the site helped with none of it. This keeps your findings and every
     command you copied, in your browser only, exportable as markdown. Nothing is
     sent anywhere; it degrades to in-memory if storage is blocked. */
  var NOTES_KEY = 'commander.notes';
  var LOG_KEY = 'commander.cmdlog';
  function getNotes() { try { return localStorage.getItem(NOTES_KEY) || ''; } catch (e) { return ''; } }
  function setNotes(v) { try { localStorage.setItem(NOTES_KEY, v); } catch (e) {} }
  function getLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (e) { return []; } }
  function setLog(a) { try { localStorage.setItem(LOG_KEY, JSON.stringify(a.slice(-500))); } catch (e) {} }

  /* Called from copy(): every command copied anywhere on the site lands here. */
  function logCommand(text) {
    if (!text || text.length > 2000) return;
    var log = getLog();
    if (log.length && log[log.length - 1].t === text) return;   // skip an immediate repeat
    log.push({ t: text, at: Date.now() });
    setLog(log);
  }

  function showNotes() {
    tool = null;
    hideAllViews();
    el.notes.hidden = false;
    setNav('notes');
    setBack('All tools', '#/');
    document.title = 'Notes — commander';
    renderNotes();
  }
  function renderNotes() {
    var log = getLog();
    el.notes.innerHTML =
      '<div class="tool-h"><h1>Engagement notes</h1>' +
        '<p class="sum">Your findings and every command you copied, kept in this browser only. ' +
        'Export as markdown for the report. Nothing is sent anywhere.</p></div>' +
      '<div class="notebar">' +
        '<button class="nbtn" id="note-export">Export markdown</button>' +
        '<button class="nbtn" id="note-copyall">Copy all</button>' +
        '<span class="nlogc">' + log.length + ' commands logged</span>' +
        '<button class="nbtn danger" id="note-clearlog">Clear command log</button>' +
      '</div>' +
      '<textarea id="note-area" class="notearea" placeholder="# Findings&#10;&#10;Write as you go. Markdown.">' +
        esc(getNotes()) + '</textarea>' +
      '<h2 class="chsec-h" style="margin-top:24px">Command log</h2>' +
      '<p class="readyhint">Every command you copied, newest last. These go into the export too.</p>' +
      '<div class="cmdlog">' + (log.length
        ? log.slice().reverse().map(function (e) {
            return '<div class="logrow"><code></code></div>';
          }).join('')
        : '<p class="manhint">Nothing yet. Copy a command from any tab and it appears here.</p>') +
      '</div>';

    var ta = $('note-area');
    ta.addEventListener('input', function () { setNotes(ta.value); });

    var codes = el.notes.querySelectorAll('.cmdlog code');
    log.slice().reverse().forEach(function (e, i) { if (codes[i]) codes[i].textContent = e.t; });

    $('note-export').addEventListener('click', function () { exportNotes(); });
    $('note-copyall').addEventListener('click', function (ev) {
      copy(buildMarkdown(), ev.currentTarget, 'Copy all', true);
    });
    $('note-clearlog').addEventListener('click', function () { setLog([]); renderNotes(); });
  }

  function buildMarkdown() {
    var out = getNotes().trim();
    var log = getLog();
    if (log.length) {
      out += '\n\n## Commands run\n\n';
      out += log.map(function (e) { return '```\n' + e.t + '\n```'; }).join('\n\n');
    }
    return out + '\n';
  }
  function exportNotes() {
    var blob = new Blob([buildMarkdown()], { type: 'text/markdown' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'commander-notes.md';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------------- cheatsheet ---------------- */
  var CHEAT = null;
  function showCheat(which) {
    tool = null;
    el.home.hidden = true; el.tool.hidden = true;
    if (el.meth) el.meth.hidden = true;
    if (el.shells) el.shells.hidden = true;
    if (el.payloads) el.payloads.hidden = true;
    el.cheat.hidden = false;
    setNav('cheat');
    setBack('All tools', '#/');
    document.title = 'Cheatsheet — commander';
    if (CHEAT) return renderCheat(which);
    el.cheat.innerHTML = '<p class="manhint">Loading…</p>';
    fetch(dataUrl('data/cheatsheet.json'))
      .then(function (r) { return r.json(); })
      .then(function (d) { CHEAT = d; renderCheat(which); })
      .catch(function () { el.cheat.innerHTML = '<div class="empty">Could not load the cheatsheet data.</div>'; });
  }
  function renderCheat(which) {
    var tabs = CHEAT.groups.map(function (g) { return { id: g.id, name: g.name }; });
    var active = which && tabs.some(function (t) { return t.id === which; }) ? which : tabs[0].id;
    el.cheat.innerHTML =
      '<div class="tool-h"><h1>Cheatsheet</h1>' +
        '<p class="sum">The stages a command builder does not cover: what to check once you have a ' +
        'shell, and how to move files. Privilege-escalation abuses are from GTFOBins.</p></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="tab" role="tab" data-m="' + esc(t.id) + '" aria-selected="' +
          (t.id === active) + '">' + esc(t.name) + '</button>';
      }).join('') + '</div><div id="chpane"></div>';
    el.cheat.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#/cheatsheet/' + b.dataset.m; });
    });
    renderCheatPane(active);
  }
  function renderCheatPane(active) {
    var pane = $('chpane'); if (!pane) return;
    var g = CHEAT.groups.find(function (x) { return x.id === active; });
    if (!g) return;
    pane.innerHTML = g.sections.map(function (sec) {
      return '<div class="chsec"><h2 class="chsec-h">' + esc(sec.name) + '</h2>' +
        '<p class="readyhint">' + esc(sec.intro) + '</p>' +
        (sec.warn ? '<div class="mwarn">' + esc(sec.warn) + '</div>' : '') +
        '<div class="shgrid">' + sec.items.map(function (it, i) {
          return '<div class="shp">' +
            '<div class="shp-h"><button class="shp-c" data-s="' + esc(sec.name) + '" data-i="' + i + '">Copy</button></div>' +
            '<pre class="shp-t"><code></code></pre>' +
            '<p class="shp-d">' + esc(it.note) + '</p>' +
            (it.warn ? '<div class="mwarn">' + esc(it.warn) + '</div>' : '') +
          '</div>';
        }).join('') + '</div></div>';
    }).join('');
    // fill command text safely and wire copy
    var secByName = {};
    g.sections.forEach(function (s) { secByName[s.name] = s; });
    var blocks = pane.querySelectorAll('.chsec');
    g.sections.forEach(function (sec, si) {
      var codes = blocks[si].querySelectorAll('.shp-t code');
      sec.items.forEach(function (it, i) { if (codes[i]) codes[i].textContent = it.text; });
    });
    pane.querySelectorAll('.shp-c').forEach(function (b) {
      b.addEventListener('click', function () {
        var sec = secByName[b.dataset.s];
        copy(sec.items[Number(b.dataset.i)].text, b, 'Copy');
      });
    });
  }

  /* ---------------- methodology ---------------- */
  /* Nine published standards, turned into something you can follow. The data
     is data: every command here is one the tools in this catalogue produce,
     and where a tool has a page the command links to it. */
  var METH = null;

  function showMethodology(which) {
    tool = null;
    hideAllViews();
    el.meth.hidden = false;
    setNav('meth');
    setBack(which ? 'All methodologies' : 'All tools', which ? '#/methodology' : '#/');
    document.title = 'Methodology — commander';

    if (METH) return renderMethodology(which);
    el.meth.innerHTML = '<p class="manhint">Loading…</p>';
    fetch(dataUrl('data/methodology.json'))
      .then(function (r) { return r.json(); })
      .then(function (d) { METH = d; renderMethodology(which); })
      .catch(function () { el.meth.innerHTML = '<div class="empty">Could not load the methodology data.</div>'; });
  }

  function renderMethodology(which) {
    var tabs = [{ id: 'frameworks', name: 'The frameworks' },
                { id: 'choosing', name: 'Which one do I use?' }].concat(
      METH.disciplines.map(function (d) { return { id: d.id, name: d.name }; }));
    var active = which && tabs.some(function (t) { return t.id === which; }) ? which : 'frameworks';

    el.meth.innerHTML =
      '<div class="tool-h"><h1>Methodology</h1>' +
        '<p class="sum">Which test to run, in what order, with the command for each stage. ' +
        'Phases follow the published standard named in each section.</p></div>' +
      '<div class="prov">updated <b>' + esc(METH.updated) + '</b> &middot; ' +
        Number(METH.frameworks.length) + ' frameworks &middot; ' +
        Number(METH.disciplines.length) + ' disciplines</div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="tab" role="tab" data-m="' + esc(t.id) + '" aria-selected="' +
          (t.id === active) + '">' + esc(t.name) + '</button>';
      }).join('') + '</div>' +
      '<div id="mpane"></div>';

    el.meth.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { location.hash = '#/methodology/' + b.dataset.m; });
    });

    if (active === 'frameworks') renderFrameworks();
    else if (active === 'choosing') renderChoosing();
    else renderDiscipline(METH.disciplines.find(function (d) { return d.id === active; }));
  }

  /* A framework carries a phase list, and some carry a second list that is NOT
     phases and must not be drawn as if it were — OSSTMM's five channels,
     ISSAF's nine steps, NIST's four execution techniques. Labelling them is the
     whole point: the live page used to print OSSTMM's channels under "phases",
     which is simply wrong. Any future list only needs adding here. */
  function sublist(label, items) {
    if (!items || !items.length) return '';
    return '<div class="fw-set"><span class="fw-lab">' + esc(label) + '</span>' +
      '<div class="fw-ph">' + items.map(function (p) {
        return '<span>' + esc(p) + '</span>';
      }).join('') + '</div></div>';
  }

  function renderFrameworks() {
    $('mpane').innerHTML =
      '<p class="readyhint">What each standard is for. They are not alternatives — most engagements ' +
      'use one for structure and another for the specific tests.</p>' +
      '<div class="fwgrid">' + METH.frameworks.map(function (f) {
        return '<div class="fw">' +
          '<div class="fw-h"><span class="fw-n">' + esc(f.name) + '</span>' +
            '<span class="fw-s">' + esc(f.scope) + '</span></div>' +
          '<div class="fw-full">' + esc(f.full) + '</div>' +
          '<p>' + esc(f.summary) + '</p>' +
          sublist('Phases', f.phases) + sublist('Channels', f.channels) +
          sublist('Nine steps', f.steps) + sublist('Execution techniques', f.techniques) +
        '</div>';
      }).join('') + '</div>';
  }

  /* The question a beginner actually arrives with. Driven entirely by
     METH.choosing, so adding a scenario is a data edit, never a code one. */
  function renderChoosing() {
    var C = METH.choosing;
    if (!C) { $('mpane').innerHTML = ''; return; }
    var fwName = function (id) {
      var f = METH.frameworks.find(function (x) { return x.id === id; });
      return f ? f.name : id;
    };
    $('mpane').innerHTML =
      '<p class="readyhint">' + esc(C.intro) + '</p>' +
      '<div class="critgrid">' + C.criteria.map(function (c, i) {
        return '<div class="crit"><span class="crit-n">' + (i + 1) + '</span>' +
          '<div><b>' + esc(c.name) + '</b><p>' + esc(c.detail) + '</p></div></div>';
      }).join('') + '</div>' +
      '<h2 class="scen-h">Worked examples</h2>' +
      '<div class="scengrid">' + C.scenarios.map(function (sc) {
        return '<div class="scen">' +
          '<p class="scen-q">' + esc(sc.q) + '</p>' +
          '<div class="scen-a">' + esc(sc.a) + '</div>' +
          '<p class="scen-w">' + esc(sc.why) + '</p>' +
          '<div class="scen-u">' + (sc.use || []).map(function (id) {
            return '<span>' + esc(fwName(id)) + '</span>';
          }).join('') + '</div>' +
        '</div>';
      }).join('') + '</div>';
  }

  function renderDiscipline(d) {
    if (!d) return;
    var govern = d.governs.map(function (id) {
      var f = METH.frameworks.find(function (x) { return x.id === id; });
      return f ? f.name : id;
    });

    $('mpane').innerHTML =
      '<p class="readyhint">' + esc(d.summary) + ' <b>Governed by ' + esc(govern.join(', ')) + '.</b></p>' +
      d.phases.map(function (ph, i) {
        return '<div class="mph">' +
          '<div class="mph-h"><span class="mph-n">' + (i + 1) + '</span>' +
            '<span class="mph-t">' + esc(ph.name) + '</span>' +
            '<span class="mph-r">' + esc(ph.ref) + '</span></div>' +
          '<p class="mph-g">' + esc(ph.goal) + '</p>' +
          (ph.warn ? '<div class="mwarn">' + esc(ph.warn) + '</div>' : '') +
          ph.steps.map(function (st) {
            return '<div class="mstep">' +
              '<div class="mstep-w">' + esc(st.what) + '</div>' +
              '<div class="mstep-y">' + esc(st.why) + '</div>' +
              (st.warn ? '<div class="mwarn">' + esc(st.warn) + '</div>' : '') +
              st.cmds.map(function (c, ci) {
                var id = d.id + '-' + i + '-' + Math.random().toString(36).slice(2, 7);
                /* Three kinds of entry: a command for a tool we built (links to its
                   page), a command for an external tool (shown, no link, no false
                   "not built" label), and a manual note (an instruction, no Copy). */
                if (c.note) {
                  return '<div class="mcmd mnote"><span class="mnote-i">&rsaquo;</span>' +
                    '<span class="mnote-t">' + esc(c.text) + '</span></div>';
                }
                return '<div class="mcmd">' +
                  '<code>' + esc(c.text) + '</code>' +
                  '<div class="mcmd-a">' +
                    (c.tool ? '<a class="mcmd-t" href="#/' + esc(c.tool) + '">' + esc(c.tool) + ' &rarr;</a>'
                            : '<span class="mcmd-t ext">external</span>') +
                    '<button class="mcmd-c" data-cmd="' + esc(c.text) + '">Copy</button>' +
                  '</div></div>';
              }).join('') +
            '</div>';
          }).join('') +
        '</div>';
      }).join('');

    $('mpane').querySelectorAll('.mcmd-c').forEach(function (b) {
      b.addEventListener('click', function () { copy(b.dataset.cmd, b, 'Copy'); });
    });
  }

  /* ---------------- ready-made tab ---------------- */
  /* Recipes are shown as complete commands against an example target, so they
     read as something you could run. The moment the panel on the right has a
     value, every one of them switches to it. A card is closed until you click
     it: the point is to scan fifteen commands quickly, not to wade through
     fifteen breakdowns. */
  var openRecipe = null;

  function renderReady() {
    var cats = [];
    tool.recipes.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });

    $('pane').innerHTML =
      '<div class="cols">' +
        '<div>' +
          '<p class="readyhint" id="readyhint"></p>' +
          '<div id="reclist"></div>' +
        '</div>' +
        '<aside class="panel" id="slots" aria-label="Your values"><h2>Your values</h2></aside>' +
      '</div>';

    paintRecipes();
    renderRecipeSlots();
  }

  function paintRecipes() {
    var usingExample = (tool.inputs || []).some(function (i) {
      return !(slots[i.id] || '').trim();
    });
    $('readyhint').innerHTML = usingExample
      ? 'Commands below use example values. Fill anything in on the right and they all update.'
      : 'Using your values. Click a command to see what each part does.';

    var cats = [];
    tool.recipes.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });

    $('reclist').innerHTML = cats.map(function (c) {
      return '<div class="rcat"><div class="rcat-h">' + esc(c) + '</div>' +
        tool.recipes.filter(function (r) { return r.category === c; }).map(recipeCard).join('') +
      '</div>';
    }).join('');

    $('reclist').querySelectorAll('.rec-head').forEach(function (b) {
      b.addEventListener('click', function () {
        openRecipe = openRecipe === b.dataset.id ? null : b.dataset.id;
        paintRecipes();
      });
    });
    $('reclist').querySelectorAll('.rec-copy').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var r = tool.recipes.find(function (x) { return x.id === b.dataset.id; });
        copy(buildRecipe(tool, r, slots).text, b, 'Copy');
      });
    });
  }

  function recipeCard(r) {
    var built = buildRecipe(tool, r, slots);
    var open = openRecipe === r.id;
    var mid = r.mode || tool.modes[0].id;

    var body = '';
    if (open) {
      body = '<div class="rec-body">' +
        '<p class="rec-when"><b>When:</b> ' + esc(r.when) + (r.cost ? ' <span class="rec-cost">' + esc(r.cost) + '</span>' : '') + '</p>' +
        '<div class="explain-h">What each part does</div>' +
        '<div class="pieces">' + built.pieces.map(function (p) {
          return '<div class="piece static">' +
            '<div class="tok">' + esc(p.tok) + '</div><div class="arrow">&darr;</div>' +
            '<div class="lbl">' + esc(p.label || '') + '</div>' +
            (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
          '</div>';
        }).join('') + '</div>' +
        swapsFor(r, mid) +
      '</div>';
    }

    return '<div class="rec' + (open ? ' open' : '') + '">' +
      '<button class="rec-head" data-id="' + esc(r.id) + '" aria-expanded="' + open + '">' +
        '<div class="rec-top"><span class="rec-name">' + esc(r.name) + '</span>' +
          '<span class="rec-chev">' + (open ? '&minus;' : '+') + '</span></div>' +
        '<div class="rec-sum">' + esc(r.summary) + '</div>' +
        '<code class="rec-cmd">' + esc(built.text) + '</code>' +
      '</button>' +
      '<button class="rec-copy" data-id="' + esc(r.id) + '">Copy</button>' +
      body +
    '</div>';
  }

  /* "or swap it for" — the alternatives declared on each flag the recipe uses. */
  function swapsFor(r, mid) {
    var rows = [];
    Object.keys(r.flags || {}).forEach(function (id) {
      var f = tool.flags.find(function (x) { return x.id === id; });
      if (!f) return;
      var alts = alternativesFor(tool, f, mid);
      if (!alts.length) return;
      rows.push('<li><code>' + esc(f.short || f.long) + '</code> ' + esc(resolveFlag(f, mid).desc) +
        '<ul>' + alts.map(function (a) {
          return '<li>swap for <code>' + esc(a.token) + '</code> ' + esc(a.when) + '</li>';
        }).join('') + '</ul></li>');
    });
    if (!rows.length) return '';
    return '<div class="swaps"><div class="explain-h">Or change it</div><ul>' + rows.join('') + '</ul></div>';
  }

  /* The same input panel as the builder, so one target serves both tabs. */
  function renderRecipeSlots() {
    var html = (tool.inputs || []).map(function (i) {
      return '<div class="slot"><label for="rslot-' + esc(i.id) + '">' + esc(i.label) + '</label>' +
        '<input id="rslot-' + esc(i.id) + '" value="' + esc(slots[i.id] || '') + '" placeholder="' + esc(i.placeholder || '') + '">' +
        '<div class="used">' + esc(i.example ? 'example: ' + i.example : '') + '</div></div>';
    }).join('');
    $('slots').innerHTML = '<h2>Your values</h2>' + (html ||
      '<p class="none">This tool takes its values on the flags themselves.</p>');
    (tool.inputs || []).forEach(function (i) {
      var e = $('rslot-' + i.id);
      if (e) e.addEventListener('input', function () { slots[i.id] = this.value; saveSlots(); paintRecipes(); });
    });
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
    $('copy').addEventListener('click', function () {
      var b = build(tool, mode, picked, slots, adhoc);
      /* Never hand over a command that is known to be incomplete. */
      if (b.issues.some(function (i) { return i.err; })) return;
      copy(b.text, this, 'Copy');
    });

    renderPicker();
    renderSlots();
    renderCommand();
  }

  function renderPicker() {
    var groups = {};
    modeFlags().forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    $('picker').innerHTML = Object.keys(groups).map(function (g) {
      /* Group ids are slugs so they are safe as keys; the heading shows words.
         sqlmap has groups like "user-defined-function-injection". */
      return '<div class="fg"><div class="fg-h">' + esc(g.replace(/-/g, ' ')) + '</div><div class="flags">' +
        groups[g].map(function (f) {
          var b = blocked(tool, picked, f);
          var on = !!picked[f.id];
          var warn = f.warn ? '<span class="wn" title="' + esc(f.warn) + '">' + ({root:'&#9888;',slow:'&#9203;',noisy:'&#128226;',destructive:'&#9888;',deprecated:'&#9888;'}[f.warn] || '') + '</span>' : '';
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
      (f.note ? '<div class="note">' + esc(f.note) + '</div>' : '') +
      (f.warn ? '<div class="wn">' + esc({root:'Needs root.',slow:'Slow.',noisy:'Noisy — this will show in logs.',destructive:'Destructive — can change or delete data.',deprecated:'Deprecated — the tool still accepts it but prefers another spelling.'}[f.warn] || f.warn) + '</div>' : '') +
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
    /* A trailing input is always shown. It belongs to no flag — nmap takes its
       target as a bare argument — so waiting for a flag to bind it would hide
       the one box the tool cannot run without. */
    return (tool.inputs || []).filter(function (i) { return need[i.id] || i.trailing; });
  }

  /* A picked enum flag with no value would emit a bare "-mode" and break the
     command. Seed it with the tool's own default when that default is one of
     the legal values, otherwise the first one. */
  function seedEnums() {
    modeFlags().forEach(function (f) {
      if (f.takes !== 'enum' || !picked[f.id] || adhoc[f.id]) return;
      adhoc[f.id] = (f.default && f.enum.indexOf(f.default) !== -1) ? f.default : f.enum[0];
    });
  }

  function renderSlots() {
    seedEnums();
    var act = activeSlots();
    var loose = unboundPicked();

    if (!act.length && !loose.length) {
      $('slots').innerHTML = '<p class="none">Pick a flag that takes a value and its box appears here.</p>';
      return;
    }

    var html = act.map(function (i) {
      var users = modeFlags().filter(function (f) { return picked[f.id] && f.binds === i.id; })
        .map(function (f) { return f.short || f.long; }).join(', ');
      /* No flag carries a trailing value, so say where it goes instead. */
      var note = users ? 'used by ' + users
        : i.trailing ? 'goes at the end of the command'
        : '';
      return '<div class="slot"><label for="slot-' + esc(i.id) + '">' + esc(i.label) + '</label>' +
        '<input id="slot-' + esc(i.id) + '" value="' + esc(slots[i.id] || '') + '" placeholder="' + esc(i.placeholder || '') + '">' +
        '<div class="used">' + esc(note) + '</div></div>';
    }).join('');

    html += loose.map(function (f) {
      var tok = f.short || f.long;
      var field;
      if (f.takes === 'enum') {
        /* A closed set gets a picker. Typing into a free-text box is how you
           produce "Unknown output file format" — the tool states the legal
           values, so offer exactly those. */
        field = '<select id="adhoc-' + esc(f.id) + '">' + f.enum.map(function (v) {
          return '<option value="' + esc(v) + '"' + (adhoc[f.id] === v ? ' selected' : '') +
                 '>' + esc(v) + (v === f.default ? ' (default)' : '') + '</option>';
        }).join('') + '</select>';
      } else if (f.repeatable) {
        /* One value per line. The tool accepts the flag more than once, so the
           box has to allow more than one answer. */
        field = '<textarea id="adhoc-' + esc(f.id) + '" rows="2" placeholder="' +
                esc(f.takes) + ' — one per line">' + esc(adhoc[f.id] || '') + '</textarea>';
      } else {
        field = '<input id="adhoc-' + esc(f.id) + '" value="' + esc(adhoc[f.id] || '') +
                '" placeholder="' + esc(f.takes) + '">';
      }
      return '<div class="slot"><label for="adhoc-' + esc(f.id) + '">' + esc(tok) +
        ' <span style="color:var(--text-faint)">&lt;' + esc(f.takes) + '&gt;</span></label>' +
        field +
        '<div class="used">' + esc(f.repeatable ? 'repeatable — one per line' : f.desc.slice(0, 54)) + '</div></div>';
    }).join('');

    $('slots').innerHTML = html;

    act.forEach(function (i) {
      $('slot-' + i.id).addEventListener('input', function () {
        slots[i.id] = this.value; saveSlots(); renderCommand();
      });
    });
    loose.forEach(function (f) {
      var el = $('adhoc-' + f.id);
      el.addEventListener(f.takes === 'enum' ? 'change' : 'input', function () {
        adhoc[f.id] = this.value; renderCommand();
      });
    });
  }

  function renderCommand() {
    var b = build(tool, mode, picked, slots, adhoc);
    $('cmd').textContent = b.text;

    var broken = b.issues.some(function (i) { return i.err; });
    var cp = $('copy');
    cp.disabled = broken;
    cp.title = broken ? 'Fill in the highlighted values first' : '';
    $('issues').innerHTML = b.issues.map(function (i) {
      return '<div class="issue' + (i.err ? ' err' : '') + '">' + esc(i.text) + '</div>';
    }).join('');

    /* A piece only becomes a button when there is a longer explanation behind
       it. A control that looks interactive and does nothing is worse than a
       plain label, and `help` is empty until the human writing pass fills it. */
    $('pieces').innerHTML = b.pieces.map(function (p, idx) {
      var more = p.help && p.help !== p.label;
      var tag = more ? 'button' : 'div';
      return '<' + tag + ' class="piece' + (more ? '' : ' static') + (p.missing ? ' missing' : '') + '"' + (more ? ' data-i="' + idx + '"' : '') + '>' +
        '<div class="tok">' + esc(p.tok) + '</div>' +
        '<div class="arrow">&#8595;</div>' +
        '<div class="lbl">' + esc(p.label) + '</div>' +
        (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
        (p.warn ? '<div class="wn">' + esc({root:'needs root',slow:'slow',noisy:'noisy',destructive:'destructive',deprecated:'deprecated'}[p.warn] || p.warn) + '</div>' : '') +
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

  function copy(text, btn, restore, noLog) {
    if (!noLog) logCommand(text);
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
    el.home = $('home'); el.tool = $('toolview'); el.meth = $('methview'); el.shells = $('shellview'); el.payloads = $('payloadview'); el.cheat = $('cheatview'); el.notes = $('notesview'); el.cats = $('cats'); el.res = $('results'); el.q = $('q');

    el.q.addEventListener('input', function () {
      var v = this.value.trim();
      if (location.hash && location.hash !== '#/' && v) location.hash = '#/';
      if (!tool) { v ? renderSearch(v) : renderGrid(); }
    });

    fetch(dataUrl('data/manifest.json'))
      .then(function (r) { return r.json(); })
      .then(function (m) { manifest = m; loadCtx(); route(); })
      .catch(function () { el.cats.innerHTML = '<div class="empty">Could not load the tool list.</div>'; });

    window.addEventListener('hashchange', function () { hideTip(); route(); });
  });

  /* Register the service worker so the site works offline after the first
     visit. Wrapped and silent: a failure here must never affect the page. */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

})();

/* fig-puzzle.js — Figure 2 (mount "puzzle"): try an exam puzzle yourself.
   At rest: the example pairs, then the test input and your answer grid side by side at one cell size,
   a 10-swatch palette, and two buttons (Check, Another puzzle). One interaction: paint + Check, two
   tries like the player. After the last try (or a success): your answer diffed against the correct
   one, one line on how the AI players did on this puzzle (heldout.json), and a link into
   Explore → Every exam answer. Extra tools (fill, resize, copy input, clear, show answer,
   difficulty) sit behind "More tools".
   Data: tasks.json at init; heldout.json prefetched when the figure nears the viewport, or on Check.
   Emits: select-task {task, set:'heldout', source:'puzzle'} only from the Explore link.
   Hash: #puzzle?task=ID (read once at init, written on "Another puzzle"). Styles: assets/fig-puzzle.css. */
(function(){
  'use strict';

  var NAMES = ['black', 'blue', 'red', 'green', 'yellow', 'grey', 'magenta', 'orange', 'sky blue', 'maroon'];
  var MAX_DIM = 20;           // pool: exam puzzles whose every grid fits in 20 x 20 (painting stays practical)
  var EASY = 0.7, HARD = 0.3;  // difficulty bands on heldout_mean_solve
  var ARMS = [                 // arms reported in the "how the AI did" line, in reading order
    { key: 'B0', label: 'no coach' }, { key: 'I0', label: 'original coach' },
    { key: 'Ig', label: 'self-improved coach' }, { key: 'xhigh', label: 'think longer' }
  ];

  function band(s){ return s >= EASY ? 'easy' : s >= HARD ? 'medium' : 'hard'; }
  function copyGrid(g){ return g.map(function(r){ return r.slice(); }); }
  function blank(h, w){ var g = []; for(var r = 0; r < h; r++){ g.push([]); for(var c = 0; c < w; c++) g[r].push(0); } return g; }
  function dims(g){ return g.length + '×' + g[0].length; }
  function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }

  /* EX.more fallback (core provides it per the plan) */
  function more(container, label, build, o){
    if(EX.more) return EX.more(container, label, build, o);
    var d = EX.h('details', { 'class': 'more' }, container);
    EX.h('summary', null, d, label);
    var body = EX.h('div', { 'class': 'more-body' }, d), built = false;
    d.addEventListener('toggle', function(){ if(d.open && !built){ built = true; build(body); } });
    return { el: d, body: body, open: function(){ d.open = true; }, close: function(){ d.open = false; } };
  }

  /* the puzzle Figure 2 opens with: deterministic from tasks.json (shared so Figure 5 can skip it) */
  function buildPool(TK){
    return TK.heldout.map(function(id){
      var t = TK.tasks[id], m = 0;
      t.train.concat(t.test).forEach(function(p){
        [p.input, p.output].forEach(function(g){ if(g) m = Math.max(m, g.length, g[0].length); });
      });
      return { id: id, t: t, maxDim: m, solve: t.heldout_mean_solve, band: band(t.heldout_mean_solve) };
    }).filter(function(x){ return x.maxDim <= MAX_DIM && x.t.test.length && x.t.test.every(function(p){ return p.output; }); });
  }
  function pickDefault(list){
    return list.slice().sort(function(a, b){
      return ((a.t.test.length > 1) - (b.t.test.length > 1)) || (a.maxDim - b.maxDim) || (Math.abs(a.solve - 0.5) - Math.abs(b.solve - 0.5)) || (a.id < b.id ? -1 : 1);
    })[0];
  }
  EX.puzzleDefaultId = function(TK){
    var pool = buildPool(TK);
    var d = pickDefault(pool.filter(function(x){ return x.band === 'medium'; })) || pickDefault(pool);
    return d ? d.id : null;
  };

  EX.mount('puzzle', function(node, ctx){
    return EX.load('tasks').then(function(TK){
      node.innerHTML = '';

      /* ---------- pool ---------- */
      var pool = buildPool(TK);
      var byId = {}; pool.forEach(function(x){ byId[x.id] = x; });
      var counts = { all: pool.length, easy: 0, medium: 0, hard: 0 };
      pool.forEach(function(x){ counts[x.band]++; });

      var hashTask = (EX.hash.get().section === 'puzzle') ? EX.hash.param('task') : null;
      var cur = (hashTask && byId[hashTask]) || byId[EX.puzzleDefaultId(TK)];
      var filter = 'all';

      /* ---------- state ---------- */
      var S = { out: null, color: 1, tool: 'paint', tries: [], done: false, cr: 0, cc: 0 };
      var narrow = false, cell = 20;

      /* ---------- skeleton ---------- */
      var root = EX.h('div', { 'class': 'fx-puzzle' }, node);
      EX.h('div', { 'class': 'pz-lab' }, root, 'Examples');
      var trainRow = EX.h('div', { 'class': 'pz-train' }, root);
      var work = EX.h('div', { 'class': 'pz-work' }, root);
      var colIn = EX.h('div', { 'class': 'pz-col' }, work);
      var inLab = EX.h('div', { 'class': 'pz-lab' }, colIn, 'Test input');
      var inHost = EX.h('div', { 'class': 'pz-grid' }, colIn);
      var colOut = EX.h('div', { 'class': 'pz-col' }, work);
      EX.h('div', { 'class': 'pz-lab' }, colOut, 'Your answer');
      var edHost = EX.h('div', { 'class': 'pz-grid' }, colOut);

      var pal = EX.h('div', { 'class': 'pz-pal', role: 'radiogroup', 'aria-label': 'Paint colour' }, root);
      var chips = NAMES.map(function(nm, i){
        var b = EX.h('button', { type: 'button', 'class': 'pz-chip', role: 'radio', 'aria-checked': String(i === S.color),
          tabindex: i === S.color ? '0' : '-1', 'aria-label': nm, title: nm, style: { background: EX.ARC[i] } }, pal);
        b.addEventListener('click', function(){ setColor(i, false); });
        b.addEventListener('keydown', function(e){
          var k = e.key, n = null;
          if(k === 'ArrowRight' || k === 'ArrowDown') n = (i + 1) % 10;
          else if(k === 'ArrowLeft' || k === 'ArrowUp') n = (i + 9) % 10;
          else if(k === 'Home') n = 0; else if(k === 'End') n = 9;
          if(n != null){ e.preventDefault(); setColor(n, true); }
        });
        return b;
      });

      var actions = EX.h('div', { 'class': 'pz-actions' }, root);
      var checkBtn = EX.h('button', { type: 'button', 'class': 'btn primary' }, actions, 'Check');
      var nextBtn = EX.h('button', { type: 'button', 'class': 'btn quiet' }, actions, 'Another puzzle');
      var feedback = EX.h('p', { 'class': 'pz-feedback', role: 'status', 'aria-live': 'polite' }, root);
      checkBtn.addEventListener('click', function(){
        if(S.done){ resetTry(); if(edSvg) edSvg.focus(); } else check();
      });
      nextBtn.addEventListener('click', function(){ shuffle(); });

      var reveal = EX.h('div', { 'class': 'pz-reveal', hidden: true }, root);

      /* ---------- more tools (collapsed) ---------- */
      var tools = {};
      more(root, 'More tools', function(body){
        var row1 = EX.h('div', { 'class': 'pz-toolrow' }, body);
        tools.seg = EX.seg(row1, [{ value: 'paint', label: 'Paint' }, { value: 'fill', label: 'Fill area' }], S.tool,
          function(v){ S.tool = v; }, { ariaLabel: 'Tool' });
        var sizeBox = EX.h('span', { 'class': 'pz-size' }, row1);
        EX.h('span', null, sizeBox, 'Size');
        tools.r = EX.h('input', { type: 'number', min: 1, max: 30, step: 1, inputmode: 'numeric', 'aria-label': 'Rows' }, sizeBox);
        EX.h('span', { 'aria-hidden': 'true' }, sizeBox, '×');
        tools.c = EX.h('input', { type: 'number', min: 1, max: 30, step: 1, inputmode: 'numeric', 'aria-label': 'Columns' }, sizeBox);
        [tools.r, tools.c].forEach(function(inp){ inp.addEventListener('change', function(){ resize(+tools.r.value, +tools.c.value); }); });
        var row2 = EX.h('div', { 'class': 'pz-toolrow' }, body);
        tools.copy = EX.h('button', { type: 'button', 'class': 'btn' }, row2, 'Copy test input');
        tools.clear = EX.h('button', { type: 'button', 'class': 'btn' }, row2, 'Clear');
        tools.show = EX.h('button', { type: 'button', 'class': 'btn' }, row2, 'Show the answer');
        tools.copy.addEventListener('click', function(){ if(S.done) return; S.out = copyGrid(testPair().input); drawWork(); });
        tools.clear.addEventListener('click', function(){ if(S.done) return; S.out = blank(S.out.length, S.out[0].length); drawWork(); });
        tools.show.addEventListener('click', function(){ if(!S.done) finish(false, true); });
        EX.h('p', { 'class': 'pz-note' }, body, 'Keyboard: arrows move, Space paints, 0–9 pick a colour, F fills.');
        syncTools();
      });
      function syncTools(){
        if(!tools.r) return;
        tools.r.value = S.out.length; tools.c.value = S.out[0].length;
        [tools.r, tools.c, tools.copy, tools.clear, tools.show].forEach(function(b){ b.disabled = S.done; });
      }

      /* ---------- heldout (lazy) ---------- */
      var HO = null, hoP = null;
      function loadHeldout(){
        if(!hoP) hoP = EX.load('heldout').then(function(d){ HO = d; return d; });
        return hoP;
      }
      if('IntersectionObserver' in window){
        var io = new IntersectionObserver(function(ents){
          if(ents.some(function(e){ return e.isIntersecting; })){ io.disconnect(); loadHeldout().catch(function(){}); }
        }, { rootMargin: '300px 0px' });
        io.observe(work);
      }

      /* ---------- helpers ---------- */
      function inFilter(x){ return filter === 'all' || x.band === filter; }
      function testPair(){ return cur.t.test[0]; }
      function setColor(i, focus){
        S.color = i;
        chips.forEach(function(b, j){ b.setAttribute('aria-checked', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
        if(focus) chips[i].focus();
      }
      function shuffle(){
        // skip Figure 5's puzzles so "Another puzzle" never spoils them
        var list = pool.filter(function(x){ return inFilter(x) && x !== cur && !(EX.watchList && EX.watchList.indexOf(x.id) >= 0); });
        if(!list.length) return;
        cur = list[Math.floor(Math.random() * list.length)];
        EX.hash.set('puzzle', { task: cur.id });
        drawTrain(); resetTry();
      }

      /* ---------- drawing ---------- */
      function drawTrain(){
        trainRow.innerHTML = '';
        var w = ctx.width() || 800, n = cur.t.train.length;
        var perRow = Math.min(n, w >= 700 ? 3 : w >= 470 ? 2 : 1);
        var ms = clamp(Math.floor(((w - (perRow - 1) * 28) / perRow - 34) / 2), 60, perRow === 1 ? 110 : 150);
        cur.t.train.forEach(function(p, i){
          EX.arcPair(trainRow, p.input, p.output, { maxSize: ms, maxCell: 16, title: 'Example ' + (i + 1) });
        });
      }
      function cellSize(){
        var w = ctx.width() || 800, p = testPair();
        var m = Math.max(p.input.length, p.input[0].length, S.out.length, S.out[0].length);
        var colW = narrow ? Math.min(w, 300) : Math.min(300, Math.floor((w - 40) / 2));
        return clamp(Math.floor((colW - 1) / m), 6, 28);
      }
      function drawWork(){
        cell = cellSize();
        var p = testPair();
        inLab.textContent = cur.t.test.length > 1 ? 'Test input (1 of ' + cur.t.test.length + ')' : 'Test input';
        inHost.innerHTML = '';
        EX.arcGrid(inHost, p.input, { cell: cell, title: 'Test input, ' + dims(p.input) });
        drawEditor();
        syncTools();
      }
      function resetTry(){
        var p = testPair();
        S.tries = []; S.done = false; S.cr = 0; S.cc = 0;
        S.out = blank(p.input.length, p.input[0].length);
        drawWork();
        reveal.hidden = true; reveal.innerHTML = '';
        feedback.textContent = '';
        updActions();
      }

      /* ---------- editor ---------- */
      var edSvg = null, edCells = null, edCur = null, painting = false, lastRC = null;
      function drawEditor(){
        var g = S.out, h = g.length, w = g[0].length;
        var W = w * cell + 1, H = h * cell + 1;
        edHost.innerHTML = '';
        edSvg = EX.s('svg', { 'class': 'pz-editor' + (S.done ? ' locked' : ''), width: W, height: H, viewBox: '0 0 ' + W + ' ' + H,
          tabindex: 0, role: 'application', 'aria-roledescription': 'paint grid',
          'aria-label': 'Your answer, ' + h + ' by ' + w + '. Arrow keys move, Space paints, digits 0 to 9 pick a colour, F fills an area.' }, edHost);
        EX.s('rect', { 'class': 'bg', x: 0, y: 0, width: W, height: H }, edSvg);
        edCells = [];
        for(var r = 0; r < h; r++){
          edCells.push([]);
          for(var c = 0; c < w; c++){
            edCells[r].push(EX.s('rect', { x: c * cell + 1, y: r * cell + 1, width: cell - 1, height: cell - 1, fill: EX.ARC[g[r][c]] }, edSvg));
          }
        }
        S.cr = clamp(S.cr, 0, h - 1); S.cc = clamp(S.cc, 0, w - 1);
        edCur = EX.s('rect', { 'class': 'cur', width: cell - 1, height: cell - 1 }, edSvg);
        moveCursor(S.cr, S.cc);
        edSvg.addEventListener('pointerdown', onDown);
        edSvg.addEventListener('pointermove', onMove);
        edSvg.addEventListener('pointerup', onUp);
        edSvg.addEventListener('pointercancel', onUp);
        edSvg.addEventListener('lostpointercapture', onUp);
        edSvg.addEventListener('keydown', onKey);
      }
      function rcAt(e){
        var b = edSvg.getBoundingClientRect(), sx = (S.out[0].length * cell + 1) / b.width;
        var c = Math.floor(((e.clientX - b.left) * sx - 1) / cell), r = Math.floor(((e.clientY - b.top) * sx - 1) / cell);
        if(r < 0 || c < 0 || r >= S.out.length || c >= S.out[0].length) return null;
        return [r, c];
      }
      function paint(r, c, v){
        if(S.out[r][c] === v) return;
        S.out[r][c] = v; edCells[r][c].setAttribute('fill', EX.ARC[v]);
      }
      function flood(r, c, v){
        var g = S.out, from = g[r][c]; if(from === v) return;
        var st = [[r, c]];
        while(st.length){
          var p = st.pop(), y = p[0], x = p[1];
          if(y < 0 || x < 0 || y >= g.length || x >= g[0].length || g[y][x] !== from) continue;
          paint(y, x, v);
          st.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
        }
      }
      function apply(r, c, first){
        if(S.done) return;
        if(S.tool === 'fill'){ if(first) flood(r, c, S.color); }
        else paint(r, c, S.color);
        moveCursor(r, c);
      }
      function onDown(e){
        if(S.done || (e.button != null && e.button !== 0)) return;
        var rc = rcAt(e); if(!rc) return;
        e.preventDefault();
        painting = S.tool === 'paint';
        try { edSvg.setPointerCapture(e.pointerId); } catch(err){}
        lastRC = rc; apply(rc[0], rc[1], true);
      }
      function onMove(e){
        if(!painting) return;
        var rc = rcAt(e); if(!rc) return;
        if(lastRC && lastRC[0] === rc[0] && lastRC[1] === rc[1]) return;
        lastRC = rc; apply(rc[0], rc[1], false);
      }
      function onUp(){ painting = false; lastRC = null; }
      function moveCursor(r, c){
        S.cr = r; S.cc = c;
        edCur.setAttribute('x', c * cell + 1); edCur.setAttribute('y', r * cell + 1);
      }
      function onKey(e){
        var k = e.key, h = S.out.length, w = S.out[0].length, r = S.cr, c = S.cc;
        if(k === 'ArrowUp') r = Math.max(0, r - 1);
        else if(k === 'ArrowDown') r = Math.min(h - 1, r + 1);
        else if(k === 'ArrowLeft') c = Math.max(0, c - 1);
        else if(k === 'ArrowRight') c = Math.min(w - 1, c + 1);
        else if(k === 'Home') c = 0; else if(k === 'End') c = w - 1;
        else if(/^[0-9]$/.test(k)){ e.preventDefault(); setColor(+k, false); return; }
        else if(k === ' ' || k === 'Enter'){ e.preventDefault(); if(!S.done) paint(r, c, S.color); return; }
        else if(k === 'f' || k === 'F'){ e.preventDefault(); if(!S.done) flood(r, c, S.color); return; }
        else return;
        e.preventDefault();
        if(e.shiftKey && !S.done) paint(r, c, S.color);   // Shift+arrow paints a stroke
        moveCursor(r, c);
      }
      function resize(h, w){
        if(S.done) return;
        h = clamp(Math.round(h) || 1, 1, 30); w = clamp(Math.round(w) || 1, 1, 30);
        var g = blank(h, w);
        for(var r = 0; r < Math.min(h, S.out.length); r++) for(var c = 0; c < Math.min(w, S.out[0].length); c++) g[r][c] = S.out[r][c];
        S.out = g; drawWork();
      }

      /* ---------- checking ---------- */
      function updActions(){
        checkBtn.textContent = S.done ? 'Start over' : 'Check';
        checkBtn.classList.toggle('primary', !S.done);
        if(edSvg) edSvg.classList.toggle('locked', S.done);
        syncTools();
      }
      function diffCount(g, truth){
        if(g.length !== truth.length || g[0].length !== truth[0].length) return -1;
        var n = 0;
        for(var r = 0; r < g.length; r++) for(var c = 0; c < g[0].length; c++) if(g[r][c] !== truth[r][c]) n++;
        return n;
      }
      function missText(n){
        return n < 0 ? 'the size is wrong' : n + ' cell' + (n === 1 ? '' : 's') + ' off';
      }
      function check(){
        if(S.done) return;
        loadHeldout().catch(function(){});
        var truth = testPair().output, g = copyGrid(S.out);
        S.tries.push(g);
        if(EX.gridsEqual(g, truth)) return finish(true, false);
        var n = diffCount(g, truth);
        if(S.tries.length >= 2) return finish(false, false, n);
        feedback.innerHTML = '<b class="no">Not quite:</b> ' + EX.esc(missText(n)) + ' (try 1 of 2).';
        updActions();
      }
      function finish(ok, gaveUp, n){
        S.done = true; updActions();
        feedback.innerHTML = ok ? '<b class="ok">Correct!</b>' + (S.tries.length > 1 ? ' On your second try.' : '')
          : gaveUp ? 'Here is the answer.'
          : '<b class="no">Not quite:</b> ' + EX.esc(missText(n)) + '. That was your last try. Wrong cells are outlined in white below.';
        drawReveal(ok);
      }

      /* ---------- reveal ---------- */
      function drawReveal(ok){
        reveal.hidden = false; reveal.innerHTML = '';
        var truth = testPair().output;
        var row = EX.h('div', { 'class': 'pz-cmp' }, reveal);
        var m = Math.max(truth.length, truth[0].length, S.out.length, S.out[0].length);
        var w = ctx.width() || 800;
        var c = clamp(Math.floor((Math.min(narrow ? Math.floor((w - 16) / 2) : 280, 280) - 1) / m), 4, 22);
        if(S.tries.length){
          var last = S.tries[S.tries.length - 1];
          EX.arcGrid(row, last, { cell: c, diffAgainst: truth, label: 'Your answer', title: 'Your answer' });
        }
        EX.arcGrid(row, truth, { cell: c, label: 'Correct answer', title: 'Correct answer, ' + dims(truth) });
        var ai = EX.h('p', { 'class': 'pz-ai' }, reveal);
        if(HO) aiLine(ai);
        else {
          ai.textContent = 'Loading how the AI players did…';
          var at = cur.id;
          loadHeldout().then(function(){ if(cur.id === at && S.done) aiLine(ai); })
            .catch(function(){ ai.textContent = 'How the AI players did could not be loaded.'; });
        }
        var a = EX.h('a', { 'class': 'pz-link', href: '#replay?task=' + encodeURIComponent(cur.id) }, reveal, 'See every run’s answer →');
        a.addEventListener('click', function(e){
          e.preventDefault();
          var id = cur.id;
          EX.state.revealTask = id;
          if(EX.explore && EX.explore.open) EX.explore.open('replay', { scroll: true });
          else EX.hash.set('replay', { task: id }, { scroll: true });
          EX.select('task', { task: id, set: 'heldout', source: 'puzzle' });
        });
      }
      function aiLine(el){
        var bits = ARMS.map(function(arm){
          var rs = Object.keys(HO.runs).filter(function(r){ return EX.runGroup(r) === arm.key; });
          var recs = rs.map(function(r){ var R = HO.runs[r].results; return R && R[cur.id] ? R[cur.id][0] : null; }).filter(Boolean);
          var k = recs.filter(function(rec){ return rec.c && rec.c.some(function(v){ return !!v; }); }).length;
          if(!recs.length) return null;
          if(recs.length === 1) return arm.label + ': ' + (k ? 'solved' : 'missed');
          return arm.label + ' ' + k + ' of ' + recs.length + ' runs';
        }).filter(Boolean);
        el.innerHTML = '<b>How the AI did on this puzzle:</b> ' + bits.map(EX.esc).join(' · ');
      }

      /* ---------- layout ---------- */
      function layout(w){
        narrow = (w || 800) < 560;
        root.classList.toggle('narrow', narrow);
      }
      layout(ctx.width());
      drawTrain(); resetTry();
      ctx.onResize(function(w){
        layout(w);
        drawTrain(); drawWork();
        if(S.done) drawReveal(S.tries.length && EX.gridsEqual(S.tries[S.tries.length - 1], testPair().output));
      });
      if(ctx.onShow) ctx.onShow(function(){ layout(ctx.width()); drawTrain(); drawWork(); });
    });
  });
})();

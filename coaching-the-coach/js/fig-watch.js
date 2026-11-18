/* fig-watch.js — Figure 5, "Watch them answer" (mount `watch`).
   One exam puzzle at a time: the examples and the test input, then five columns at one shared cell
   size: the correct answer, and the two tries of one representative run per kind of player
   (no coach, original coach, self-improved coach, think longer). Wrong cells are outlined.
   ONE interaction: Back / Next puzzle (also ←/→ while the figure has focus).
   Behind "More": pick another run per kind, and a link into Explore → Every exam answer.
   Curated list (computed, deterministic): exam tasks whose first test input and its answer are
   ≤ 16×16 (relaxed to ≤ 20×20 when fewer than 12 qualify), where the four representative runs
   disagree on that input; puzzles only "think longer" solved come first; 12 puzzles; Figure 2's
   default puzzle is excluded.
   Data: tasks.json, heldout.json (4.4 MB, loaded when the figure nears the viewport).
   Emits: select-task {task, set:'heldout', source:'watch'} only from the "Open in Every exam answer" link.
   CSS: assets/fig-watch.css (injected as a <link> if index.html does not already load it). */
(function(){
  'use strict';

  function ensureCSS(){
    if(document.querySelector('link[href*="fig-watch.css"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/fig-watch.css';
    document.head.appendChild(l);
  }

  var ARMS = [
    { key: 'B0', label: 'No coach', rep: 'B0_rep0' },
    { key: 'I0', label: 'Original coach', rep: 'payoff_I0_1' },
    { key: 'Ig', label: 'Self-improved coach', rep: 'payoff_Ig_source_s1' },
    { key: 'xhigh', label: 'Think longer', rep: 'xhigh' }
  ];
  var N_PUZZLES = 12;

  function isGrid(g){ return Array.isArray(g) && g.length > 0 && Array.isArray(g[0]); }
  function dim(g){ return isGrid(g) ? Math.max(g.length, g[0].length) : 0; }

  function whenNear(el){
    return new Promise(function(resolve){
      if(!('IntersectionObserver' in window)) return resolve();
      var io = new IntersectionObserver(function(ents){
        if(ents.some(function(e){ return e.isIntersecting; })){ io.disconnect(); resolve(); }
      }, { rootMargin: '800px 0px 800px 0px' });
      io.observe(el);
    });
  }

  /* one exam record -> two tries {grid, ok, same, missing} */
  function tries(rec, hasPreds){
    var out = [];
    for(var i = 0; i < 2; i++){
      var a = { ok: !!(rec && rec.c && rec.c[i]), grid: null, same: false, missing: false };
      if(!rec || rec.n == null || rec.n <= i) a.missing = true;
      if(hasPreds && rec && rec.p){
        var p = rec.p[i];
        if(p === '=1'){ a.same = true; p = rec.p[0]; }
        if(isGrid(p)) a.grid = p; else a.missing = true;
      }
      out.push(a);
    }
    return out;
  }
  function countWrong(g, t){
    if(!isGrid(g) || !isGrid(t)) return -1;
    if(g.length !== t.length || g[0].length !== t[0].length) return -1;
    var n = 0;
    for(var r = 0; r < g.length; r++) for(var c = 0; c < g[0].length; c++) if(g[r][c] !== t[r][c]) n++;
    return n;
  }
  function solvedFirst(H, run, task){
    var r = H.runs[run] && H.runs[run].results && H.runs[run].results[task];
    var rec = r && r[0];
    if(!rec || !rec.c) return null;
    return !!(rec.c[0] || rec.c[1]);
  }

  EX.mount('watch', function(node, ctx){
    ensureCSS();
    var st = { list: [], i: 0, runs: {} };
    ARMS.forEach(function(a){ st.runs[a.key] = a.rep; });
    var T = null, H = null;

    node.innerHTML = '';
    var root = EX.h('div', { 'class': 'fx-watch' }, node);
    var head = EX.h('div', { 'class': 'fxw-head' }, root);
    var count = EX.h('div', { 'class': 'fxw-count', 'aria-live': 'polite' }, head, 'Loading puzzles…');
    var nav = EX.h('div', { 'class': 'fxw-nav' }, head);
    var back = EX.h('button', { type: 'button', 'class': 'btn quiet fxw-back', disabled: 'disabled' }, nav, '← Back');
    var next = EX.h('button', { type: 'button', 'class': 'btn primary big fxw-next', disabled: 'disabled' }, nav, 'Next puzzle →');
    var stage = EX.h('div', { 'class': 'fxw-stage', tabindex: '0', role: 'group',
      'aria-label': 'Exam puzzle and answers. Left and right arrow keys change the puzzle.' }, root);
    var exRow = EX.h('div', { 'class': 'fxw-examples' }, stage);
    var ansRow = EX.h('div', { 'class': 'fxw-answers' }, stage);
    var moreBox = EX.h('div', { 'class': 'fxw-more' }, root);
    var resolveReady, ready = new Promise(function(r){ resolveReady = r; });
    EX.more(moreBox, 'More', function(body){
      var wait = EX.h('div', { 'class': 'fxw-wait' }, body, 'Loading…');
      ready.then(function(){ wait.remove(); buildMore(body); });
    });

    function sizes(){
      var w = Math.max(300, root.clientWidth || ctx.width() || 336);
      var narrow = w < 600;
      if(narrow){
        // phone: one kind of player per row, its two tries side by side, so grids stay readable
        var half = Math.floor((w - 16) / 2);
        return { w: w, narrow: true, box: Math.max(80, Math.min(150, half)), ex: Math.max(40, Math.min(64, Math.floor((w - 84) / 4))) };
      }
      var colW = (w - 4 * 16) / 5;
      return { w: w, narrow: false, box: Math.max(64, Math.min(130, Math.floor(colW - 6))), ex: Math.max(48, Math.min(84, Math.floor((w - 200) / 7))) };
    }

    function box(parent, B){
      var b = EX.h('div', { 'class': 'fxw-box' }, parent);
      b.style.width = B + 'px'; b.style.height = B + 'px';
      return b;
    }
    function mark(parent, label, kind, text){
      var m = EX.h('div', { 'class': 'fxw-mark' }, parent);
      EX.h('span', { 'class': 'fxw-try' }, m, label);
      EX.h('span', { 'class': 'fxw-res ' + (kind || '') }, m, text || ' ');
      return m;
    }

    function render(){
      var z = sizes();
      root.classList.toggle('narrow', z.narrow);
      var task = st.list.length ? st.list[st.i] : null;
      var t = task ? T.tasks[task] : null;
      var test = t ? t.test[0] : null, truth = test ? test.output : null;

      /* examples + test input */
      exRow.innerHTML = '';
      var pairs = t ? t.train.slice(0, 3) : [null, null, null];
      pairs.forEach(function(p, k){
        var it = EX.h('div', { 'class': 'fxw-ex' }, exRow);
        EX.h('div', { 'class': 'fxw-lbl' }, it, 'Example ' + (k + 1));
        var gb = EX.h('div', { 'class': 'fxw-exgrid' }, it);
        gb.style.height = z.ex + 'px';
        if(p) EX.arcPair(gb, p.input, p.output, { maxSize: z.ex, maxCell: 14 });
        else { box(gb, z.ex); EX.h('span', { 'class': 'arc-arrow', 'aria-hidden': 'true' }, gb, '→'); box(gb, z.ex); }
      });
      var ti = EX.h('div', { 'class': 'fxw-ex fxw-test' }, exRow);
      EX.h('div', { 'class': 'fxw-lbl' }, ti, 'Test input');
      var tg = EX.h('div', { 'class': 'fxw-exgrid' }, ti); tg.style.height = z.ex + 'px';
      var tSize = z.narrow ? z.box : z.ex;
      tg.style.height = tSize + 'px';
      if(test) EX.arcGrid(tg, test.input, { maxSize: tSize, maxCell: 14, title: 'Test input' }); else box(tg, tSize);

      /* one shared cell size for the answer and all the tries */
      var shown = ARMS.map(function(a){
        var run = st.runs[a.key], R = H ? H.runs[run] : null;
        var rec = R && R.results[task] ? R.results[task][0] : null;
        return { arm: a, run: run, tries: tries(rec, R && R.has_preds) };
      });
      var maxD = dim(truth);
      shown.forEach(function(s){ s.tries.forEach(function(a){ maxD = Math.max(maxD, dim(a.grid)); }); });
      var cell = maxD ? Math.max(2, Math.min(18, Math.floor((z.box - 1) / maxD))) : 0;

      ansRow.innerHTML = '';
      var tc = EX.h('div', { 'class': 'fxw-col fxw-truth' }, ansRow);
      EX.h('div', { 'class': 'fxw-col-h' }, tc, 'Correct answer');
      EX.h('div', { 'class': 'fxw-col-sub' }, tc, 'what the exam expects');
      var tb = EX.h('div', { 'class': 'fxw-tries' }, tc);
      var tw = EX.h('div', { 'class': 'fxw-tryw' }, tb);
      var b0 = box(tw, z.box);
      if(truth) EX.arcGrid(b0, truth, { cell: cell, title: 'Correct answer' });

      var players = EX.h('div', { 'class': 'fxw-players' }, ansRow);
      shown.forEach(function(s){
        var col = EX.h('div', { 'class': 'fxw-col' }, players);
        EX.h('div', { 'class': 'fxw-col-h' }, col, s.arm.label);
        var sub = EX.h('div', { 'class': 'fxw-col-sub' }, col, ' ');
        if(H && task){
          var runs = Object.keys(H.runs).filter(function(r){ return H.runs[r].group === s.arm.key; });
          var n = 0, k = 0;
          runs.forEach(function(r){ var v = solvedFirst(H, r, task); if(v != null){ n++; if(v) k++; } });
          sub.textContent = n === 1 ? (k ? 'solved' : 'not solved') : 'solved by ' + k + ' of ' + n + ' runs';
          sub.title = 'Counts every exam run of this kind on this test input';
        }
        var trs = EX.h('div', { 'class': 'fxw-tries' }, col);
        s.tries.forEach(function(a, j){
          var w = EX.h('div', { 'class': 'fxw-tryw' }, trs);
          var b = box(w, z.box);
          var label = 'Try ' + (j + 1);
          if(!task){ mark(w, label); return; }
          if(a.grid){
            // outline wrong cells only when cells are big enough; on small grids the outlines hide the answer
            var svg = EX.arcGrid(b, a.grid, { cell: cell, diffAgainst: cell >= 10 ? truth : null, title: s.arm.label + ', try ' + (j + 1) });
            var wrong = countWrong(a.grid, truth);
            if(a.ok) mark(w, label, 'ok', '✓ correct');
            else if(a.same) mark(w, label, 'no', '× same as try 1');
            else if(wrong === -1) mark(w, label, 'no', '× wrong size');
            else mark(w, label, 'no', '× ' + wrong + ' cell' + (wrong === 1 ? '' : 's') + ' off');
          } else {
            EX.h('span', { 'class': 'fxw-none' }, b, 'no answer');
            mark(w, label, 'no', '× no answer');
          }
        });
      });

      if(task){
        count.textContent = 'Puzzle ' + (st.i + 1) + ' of ' + st.list.length;
        count.title = 'Exam task ' + task;
        back.disabled = st.i === 0;
        next.textContent = st.i === st.list.length - 1 ? 'Back to puzzle 1' : 'Next puzzle →';
      }
    }

    function go(d){
      if(!st.list.length) return;
      st.i = st.i + d;
      if(st.i < 0) st.i = 0;
      if(st.i >= st.list.length) st.i = 0;
      render();
    }
    back.addEventListener('click', function(){ go(-1); });
    next.addEventListener('click', function(){ go(1); });
    root.addEventListener('keydown', function(e){
      var tag = (e.target.tagName || '').toLowerCase();
      if(tag === 'select' || tag === 'input' || tag === 'textarea' || e.target.closest('details')) return;
      if(e.key === 'ArrowRight'){ e.preventDefault(); go(1); }
      else if(e.key === 'ArrowLeft'){ e.preventDefault(); go(-1); }
    });

    function buildMore(body){
      var row = EX.h('div', { 'class': 'fxw-more-row' }, body);
      ARMS.forEach(function(a){
        var runs = Object.keys(H.runs).filter(function(r){ return H.runs[r].group === a.key && H.runs[r].has_preds; });
        if(runs.length < 2) return;
        EX.selectBox(row, runs.map(function(r){ return { value: r, label: EX.runLabel(r, { plain: true }) }; }), st.runs[a.key],
          function(v){ st.runs[a.key] = v; render(); }, { label: a.label + ':' });
      });
      var link = EX.h('button', { type: 'button', 'class': 'btn quiet fxw-open' }, body, 'Open this puzzle in Exam answers →');
      link.addEventListener('click', function(){
        var task = st.list[st.i];
        EX.state.revealTask = task;
        EX.select('task', { task: task, set: 'heldout', source: 'watch' });
        if(EX.explore && EX.explore.open) EX.explore.open('replay', { scroll: true });
      });
    }

    function curate(){
      function pick(limit){
        var out = [];
        T.heldout.forEach(function(id, order){
          var t = T.tasks[id]; if(!t || !t.test || !t.test[0]) return;
          var te = t.test[0];
          if(!isGrid(te.input) || !isGrid(te.output) || Math.max(dim(te.input), dim(te.output)) > limit) return;
          var s = ARMS.map(function(a){ return solvedFirst(H, a.rep, id); });
          if(s.some(function(v){ return v == null; })) return;
          var k = s.filter(Boolean).length;
          if(k === 0 || k === ARMS.length) return;
          var onlyLonger = s[3] && k === 1;
          out.push({ id: id, key: (onlyLonger ? 0 : 1), small: Math.max(dim(te.input), dim(te.output)) <= 16 ? 0 : 1, order: order });
        });
        return out;
      }
      // never Figure 2's puzzle: the reader has just tried it
      var avoid = EX.puzzleDefaultId ? EX.puzzleDefaultId(T) : null;
      var c = pick(16).filter(function(x){ return x.id !== avoid; });
      if(c.length < N_PUZZLES) c = pick(20).filter(function(x){ return x.id !== avoid; });
      c.sort(function(a, b){ return a.key - b.key || a.small - b.small || a.order - b.order; });
      var ids = c.slice(0, N_PUZZLES).map(function(x){ return x.id; });
      return ids;
    }

    render();   // skeleton at the final size
    var lastW = root.clientWidth;
    ctx.onResize(function(){ if(root.clientWidth !== lastW){ lastW = root.clientWidth; render(); } });

    return whenNear(root).then(function(){ return EX.loadAll(['tasks', 'heldout']); }).then(function(res){
      T = res[0]; H = res[1];
      ARMS.forEach(function(a){
        if(!H.runs[a.rep] || !H.runs[a.rep].has_preds){
          var alt = Object.keys(H.runs).filter(function(r){ return H.runs[r].group === a.key && H.runs[r].has_preds; })[0];
          if(alt){ a.rep = alt; st.runs[a.key] = alt; }
        }
      });
      st.list = curate();
      EX.watchList = st.list.slice();
      if(!st.list.length){ count.textContent = 'No puzzle matched the selection rule.'; return; }
      next.removeAttribute('disabled');
      render();
      resolveReady();
    });
  });
})();

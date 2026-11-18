/* fig-replay.js — Explore › Every exam answer (mount "replay").
   Left: a searchable list of the 120 exam puzzles (one tab stop, arrow keys inside).
   Main: the puzzle's examples, then the test input, the truth and one run's two tries side by side.
   The run is chosen with a grouped select (plain names) plus Prev / Next.
   Behind "More options": filters and sorts, and every run's two tries as a matrix.
   Count definition used everywhere: a run "solved" a puzzle when it solved every test input of it.
   Data: tasks.json, heldout.json (4.5 MB; fetched only when the tab is shown).
   Emits: select-task {task, set:'heldout'} on a user pick. Listens: select-task (set heldout), select-run.
   Hash: #replay?task=..&run=.. */
(function(){
  'use strict';

  var ARM_ORDER = ['B0', 'I0', 'Ig', 'g20', 'g40', 'xhigh'];
  var DEFAULT_TASK = '3dc255db';
  var TICK = '✓', CROSS = '×';

  function armLabel(g){ return (EX.ARM_LABEL && EX.ARM_LABEL[g]) || g; }
  function plain(run){ return EX.runLabel(run, { plain: true }); }
  function rowName(run, g){
    var s = plain(run), a = armLabel(g);
    if(s.indexOf(a + ', ') === 0) return s.slice(a.length + 2);
    if(s.indexOf(a + ' ') === 0) return s.slice(a.length + 1);
    return s;
  }
  function shape(g){ return (g && g.length && g[0]) ? g.length + '×' + g[0].length : '—'; }
  function isGrid(g){ return Array.isArray(g) && g.length > 0 && Array.isArray(g[0]); }
  function diffInfo(g, truth){
    if(!isGrid(g)) return { kind: 'none' };
    if(g.length !== truth.length || g[0].length !== truth[0].length) return { kind: 'size', text: 'wrong size' };
    var n = 0;
    for(var r = 0; r < g.length; r++) for(var c = 0; c < g[0].length; c++) if(g[r][c] !== truth[r][c]) n++;
    return n ? { kind: 'cells', n: n, text: n + ' cell' + (n > 1 ? 's' : '') + ' off' } : { kind: 'equal' };
  }
  function attempts(rec, hasPreds){
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

  EX.mount('replay', function(node, ctx){
    ctx.setStatus('Loading the exam answers…');
    return EX.loadAll(['tasks', 'heldout']).then(function(res){
      var TK = res[0], H = res[1], F = EX.fmt;
      node.innerHTML = '';

      /* ---------- derived data ---------- */
      var runIds = Object.keys(H.runs).filter(function(r){ return ARM_ORDER.indexOf(H.runs[r].group) >= 0; });
      var order0 = runIds.slice();
      runIds.sort(function(a, b){
        return ARM_ORDER.indexOf(H.runs[a].group) - ARM_ORDER.indexOf(H.runs[b].group) || order0.indexOf(a) - order0.indexOf(b);
      });
      var nRuns = runIds.length;
      var taskInfo = H.task_order.map(function(id, idx){
        var scores = runIds.map(function(r){ var v = H.runs[r].per_task[id]; return v == null ? 0 : v; });
        var full = scores.filter(function(s){ return s >= 1; }).length;
        var mean = scores.reduce(function(a, b){ return a + b; }, 0) / scores.length;
        return { id: id, idx: idx, mean: mean, full: full, cat: full === 0 ? 'none' : (full === nRuns ? 'every' : 'some') };
      });
      var byId = {}; taskInfo.forEach(function(t){ byId[t.id] = t; });
      var catCount = { all: taskInfo.length, none: 0, some: 0, every: 0 };
      taskInfo.forEach(function(t){ catCount[t.cat]++; });

      /* ---------- state ---------- */
      var hp = EX.hash.get();
      var fromHash = hp.section === 'replay' ? hp.params : {};
      var seedTask = fromHash.task || (EX.state && EX.state.task);
      var st = {
        task: (seedTask && byId[seedTask]) ? seedTask : (byId[DEFAULT_TASK] ? DEFAULT_TASK : taskInfo[0].id),
        input: 0, filter: 'all', sort: 'order', q: '', pos: 0
      };
      var narrow = ctx.width() < 760;

      /* ---------- skeleton ---------- */
      var root = EX.h('div', { 'class': 'fx-replay' + (narrow ? ' narrow' : '') }, node);
      var layout = EX.h('div', { 'class': 'rp-layout' }, root);
      var side = EX.h('div', { 'class': 'rp-side' }, layout);
      var main = EX.h('div', { 'class': 'rp-main' }, layout);

      var search = EX.h('input', { type: 'search', 'class': 'rp-search', placeholder: 'Search puzzle id', 'aria-label': 'Search exam puzzles by id', autocomplete: 'off', spellcheck: 'false' }, side);
      var listCount = EX.h('div', { 'class': 'rp-count', 'aria-live': 'polite' }, side);
      var list = EX.h('ul', { 'class': 'rp-list', 'aria-label': 'Exam puzzles' }, side);
      search.addEventListener('input', function(){ st.q = search.value.trim().toLowerCase(); renderList(); });
      var rov = EX.roving(list, '.rp-item', { orientation: 'vertical', onActivate: function(el){ setTask(el.getAttribute('data-task'), true); } });

      function renderList(){
        var items = taskInfo.filter(function(t){
          if(st.q && t.id.indexOf(st.q) < 0) return false;
          return st.filter === 'all' || t.cat === st.filter;
        });
        if(st.sort === 'desc') items.sort(function(a, b){ return b.full - a.full || b.mean - a.mean || a.idx - b.idx; });
        if(st.sort === 'asc') items.sort(function(a, b){ return a.full - b.full || a.mean - b.mean || a.idx - b.idx; });
        list.innerHTML = '';
        listCount.textContent = (items.length === taskInfo.length ? taskInfo.length + ' puzzles' : items.length + ' of ' + taskInfo.length + ' puzzles') + '. The bar and number: how many of the ' + nRuns + ' runs solved it.';
        if(!items.length){ EX.h('li', { 'class': 'empty' }, list, 'No puzzle matches.'); return; }
        items.forEach(function(t){
          var li = EX.h('li', null, list);
          var b = EX.h('button', { type: 'button', 'class': 'rp-item', 'data-task': t.id, 'aria-pressed': String(t.id === st.task), tabindex: '-1',
            'aria-label': 'Puzzle ' + t.id + ', solved by ' + t.full + ' of ' + nRuns + ' runs' }, li);
          EX.h('span', { 'class': 'rp-id' }, b, t.id);
          var bar = EX.h('span', { 'class': 'rp-bar', 'aria-hidden': 'true' }, b);
          EX.h('span', { 'class': 'rp-fill', style: { width: (t.full / nRuns * 100).toFixed(1) + '%' } }, bar);
          EX.h('span', { 'class': 'rp-n' }, b, String(t.full));
          b.addEventListener('click', function(){ setTask(t.id, true); });
        });
        rov.refresh();
      }
      function scrollListTo(id){
        var b = list.querySelector('.rp-item[data-task="' + id + '"]'); if(!b) return;
        var li = b.parentNode, top = li.offsetTop - list.offsetTop, h = list.clientHeight, rh = li.offsetHeight || 40;
        if(top < list.scrollTop || top + rh > list.scrollTop + h) list.scrollTop = Math.max(0, Math.round((top - 3 * rh) / rh) * rh);
      }

      var head = EX.h('div', { 'class': 'rp-head' }, main);
      var trainBox = EX.h('div', { 'class': 'rp-train' }, main);
      var inputRow = EX.h('div', { 'class': 'rp-inputs' }, main);
      var picker = EX.h('div', { 'class': 'rp-picker' }, main);
      var stage = EX.h('div', { 'class': 'rp-stage' }, main);

      /* run picker: grouped select + prev / next */
      var groups = ARM_ORDER.map(function(g){
        var rs = runIds.filter(function(r){ return H.runs[r].group === g; });
        return rs.length ? { group: armLabel(g), options: rs.map(function(r){ return { value: r, label: plain(r) }; }) } : null;
      }).filter(Boolean);
      var bPrev = EX.h('button', { type: 'button', 'class': 'btn', 'aria-label': 'Previous run' }, picker, '‹ Prev');
      var runSel = EX.selectBox(picker, groups, runIds[0], function(v){ go(runIds.indexOf(v)); }, { label: 'Run' });
      runSel.setAttribute('aria-label', 'Run whose answers are shown');
      var bNext = EX.h('button', { type: 'button', 'class': 'btn', 'aria-label': 'Next run' }, picker, 'Next ›');
      bPrev.addEventListener('click', function(){ go(st.pos - 1); });
      bNext.addEventListener('click', function(){ go(st.pos + 1); });
      function go(i){ st.pos = Math.max(0, Math.min(nRuns - 1, i)); renderStage(); markRows(); }

      /* More options: filters, sort, matrix */
      var matrix = null, moreBuilt = false;
      EX.more(main, 'More options', function(body){
        moreBuilt = true;
        var ctl = EX.h('div', { 'class': 'controls rp-ctl' }, body);
        EX.seg(ctl, [
          { value: 'all', label: 'All ' + catCount.all },
          { value: 'none', label: 'None ' + catCount.none, title: 'Solved by no run' },
          { value: 'some', label: 'Some ' + catCount.some, title: 'Solved by some runs' },
          { value: 'every', label: 'Every ' + catCount.every, title: 'Solved by every run' }
        ], st.filter, function(v){ st.filter = v; renderList(); }, { label: 'Runs that solved it' });
        EX.selectBox(ctl, [
          { value: 'order', label: 'Exam order' },
          { value: 'desc', label: 'Most solved first' },
          { value: 'asc', label: 'Least solved first' }
        ], st.sort, function(v){ st.sort = v; renderList(); }, { label: 'Sort' });
        EX.h('p', { 'class': 'rp-note' }, body, '“Solved” means the run solved every test input of the puzzle.');
        EX.h('h5', { 'class': 'rp-h5' }, body, 'All ' + nRuns + ' runs, try 1 and try 2');
        matrix = EX.h('div', { 'class': 'rp-matrix' }, body);
        renderMatrix();
      });

      /* ---------- helpers for the current task ---------- */
      function T(){ return TK.tasks[st.task]; }
      function truth(){ return T().test[st.input].output; }
      function rec(run){ return (H.runs[run].results[st.task] || [])[st.input] || null; }
      function solvedInput(run){ var r = rec(run); return !!(r && (r.c[0] || r.c[1])); }
      function sizes(){
        var w = Math.max(280, main.clientWidth || ctx.width());
        return { train: narrow ? 56 : 72, stage: narrow ? Math.min(150, Math.floor((w - 32 - 14) / 2) - 2) : Math.min(180, Math.floor((w - 100) / 4)), thumb: narrow ? 52 : 60 };
      }

      function renderHead(){
        var t = byId[st.task], TT = T();
        head.innerHTML = '';
        var l1 = EX.h('div', { 'class': 'rp-title' }, head);
        l1.appendChild(document.createTextNode('Puzzle '));
        EX.h('code', null, l1, st.task);
        EX.h('div', { 'class': 'rp-meta' }, head, 'Solved by ' + t.full + ' of ' + nRuns + ' runs · ' + TT.train.length + ' example' + (TT.train.length > 1 ? 's' : '') +
          (TT.test.length > 1 ? ' · ' + TT.test.length + ' test inputs' : ''));
      }
      function renderTrain(){
        trainBox.innerHTML = '';
        var sc = EX.h('div', { 'class': 'rp-train-row' }, trainBox);
        var sz = sizes();
        T().train.forEach(function(p, i){
          EX.arcPair(sc, p.input, p.output, { maxSize: sz.train, maxCell: 10, labels: ['Example ' + (i + 1), null], title: 'Example ' + (i + 1) });
        });
        EX.scrollHint(sc);
      }
      function renderInputs(){
        inputRow.innerHTML = '';
        var n = T().test.length;
        inputRow.hidden = n < 2;
        if(n < 2) return;
        var opts = []; for(var i = 0; i < n; i++) opts.push({ value: String(i), label: 'Test input ' + (i + 1) });
        EX.seg(inputRow, opts, String(st.input), function(v){ st.input = +v; renderStage(); renderMatrix(); }, { ariaLabel: 'Test input' });
      }
      function tryCaption(a, i, tr, hasPreds){
        var lab = 'Try ' + (i + 1) + '<br>';
        if(a.ok) return lab + '<span class="ok">' + TICK + ' right</span>';
        if(!hasPreds) return lab + '<span class="no">' + CROSS + ' wrong</span>';
        if(!a.grid) return lab + '<span class="no">' + CROSS + ' no answer</span>';
        var d = diffInfo(a.grid, tr);
        return lab + '<span class="no">' + CROSS + ' ' + (d.text || 'wrong') + '</span>';
      }
      function renderStage(){
        var run = runIds[st.pos], R = H.runs[run], tr = truth(), inp = T().test[st.input].input;
        var at = attempts(rec(run), R.has_preds);
        runSel.value = run;
        bPrev.disabled = st.pos === 0; bNext.disabled = st.pos === nRuns - 1;
        stage.innerHTML = '';
        var sz = sizes();
        var grids = [inp, tr].concat(at.map(function(a){ return a.grid; })).filter(isGrid);
        var m = Math.max.apply(null, grids.map(function(g){ return Math.max(g.length, g[0].length); }));
        var cell = Math.max(2, Math.min(18, Math.floor((sz.stage - 1) / m)));
        var fixed = EX.h('div', { 'class': 'rp-fixed' }, stage);
        EX.arcGrid(EX.h('div', { 'class': 'rp-cell' }, fixed), inp, { cell: cell, label: 'Test input', title: 'Test input' });
        EX.arcGrid(EX.h('div', { 'class': 'rp-cell rp-truth' }, fixed), tr, { cell: cell, label: '<b>Correct answer</b>', title: 'Correct answer' });
        var tries = EX.h('div', { 'class': 'rp-tries' }, stage);
        at.forEach(function(a, i){
          var c = EX.h('div', { 'class': 'rp-cell' }, tries);
          if(!R.has_preds){
            EX.arcGrid(c, null, { label: tryCaption(a, i, tr, false), emptySize: Math.min(sz.stage, cell * m + 1), emptyText: 'grid not kept' });
          } else {
            EX.arcGrid(c, a.grid, { cell: cell, label: tryCaption(a, i, tr, true), diffAgainst: showDiff(a, tr) ? tr : null,
              emptyText: 'no answer', emptySize: Math.min(sz.stage, cell * m + 1), title: plain(run) + ', try ' + (i + 1) });
          }
        });
      }
      /* outline wrong cells while that stays readable; a size mismatch is one dashed frame */
      function showDiff(a, tr){
        if(a.ok || !a.grid) return false;
        var d = diffInfo(a.grid, tr);
        if(d.kind !== 'cells') return d.kind === 'size';
        return d.n <= Math.max(6, 0.4 * tr.length * tr[0].length);
      }

      function markRows(){
        if(!matrix) return;
        matrix.querySelectorAll('.rp-row[data-run]').forEach(function(rw){ rw.classList.toggle('rp-sel', rw.getAttribute('data-run') === runIds[st.pos]); });
      }
      function renderMatrix(){
        if(!matrix) return;
        matrix.innerHTML = '';
        var tr = truth(), sz = sizes();
        ARM_ORDER.forEach(function(g){
          var runs = runIds.filter(function(r){ return H.runs[r].group === g; });
          if(!runs.length) return;
          var box = EX.h('div', { 'class': 'rp-grp' }, matrix);
          var gh = EX.h('div', { 'class': 'rp-grp-head' }, box);
          EX.h('span', { 'class': 'rp-grp-name' }, gh, armLabel(g));
          EX.h('span', { 'class': 'rp-grp-n' }, gh, runs.filter(solvedInput).length + ' of ' + runs.length + ' right');
          runs.forEach(function(run){
            var R = H.runs[run], at = attempts(rec(run), R.has_preds);
            var row = EX.h('div', { 'class': 'rp-row', 'data-run': run }, box);
            var lb = EX.h('button', { type: 'button', 'class': 'rp-rowlab', 'aria-label': 'Show ' + plain(run) + ' above' }, row, rowName(run, g));
            lb.addEventListener('click', function(){ go(runIds.indexOf(run)); stage.scrollIntoView({ behavior: EX.reduceMotion ? 'auto' : 'smooth', block: 'nearest' }); });
            at.forEach(function(a, i){
              var b = EX.h('div', { 'class': 'rp-th' }, row);
              if(!R.has_preds){
                EX.h('div', { 'class': 'rp-ph', 'aria-hidden': 'true', style: { width: Math.round(sz.thumb * 0.7) + 'px', height: Math.round(sz.thumb * 0.7) + 'px' } }, b);
              } else {
                EX.arcGrid(b, a.grid, { maxSize: sz.thumb, maxCell: 8, gap: a.grid && Math.max(a.grid.length, a.grid[0].length) > 16 ? 0 : 1,
                  diffAgainst: showDiff(a, tr) ? tr : null, emptyText: '—', emptySize: Math.round(sz.thumb * 0.7), title: plain(run) + ', try ' + (i + 1) });
              }
              EX.h('span', { 'class': 'rp-mk ' + (a.ok ? 'ok' : 'no'), 'aria-label': a.ok ? 'right' : 'wrong' }, b, a.ok ? TICK : CROSS);
            });
          });
        });
        var noPred = runIds.filter(function(r){ return !H.runs[r].has_preds; }).length;
        if(noPred) EX.h('p', { 'class': 'rp-note' }, matrix, 'Dashed squares: the ' + noPred + ' runs whose answer grids were not kept (right/wrong only).');
        markRows();
      }

      function defaultPos(){
        var tr = truth();
        for(var i = 0; i < nRuns; i++){
          var run = runIds[i]; if(!H.runs[run].has_preds || solvedInput(run)) continue;
          if(attempts(rec(run), true).some(function(x){ return diffInfo(x.grid, tr).kind === 'cells'; })) return i;
        }
        return 0;
      }
      function setTask(id, user){
        if(!byId[id]) return;
        st.task = id; st.input = 0; st.pos = defaultPos();
        list.querySelectorAll('.rp-item').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-task') === id)); });
        rov.refresh();
        renderAll();
        scrollListTo(id);
        if(user){
          EX.hash.set('replay', { task: id });
          EX.select('task', { task: id, set: 'heldout', source: 'replay' });
        }
      }
      function renderAll(){ renderHead(); renderTrain(); renderInputs(); renderStage(); renderMatrix(); }
      /* arriving from Figure 2 or 5: on a phone the list sits above the detail, so bring the detail into view */
      function reveal(){
        if(!EX.state || EX.state.revealTask !== st.task) return;
        EX.state.revealTask = null;
        if(!narrow) return;
        var moved = false;
        var mark = function(){ moved = true; };
        ['wheel', 'touchstart', 'keydown'].forEach(function(ev){ window.addEventListener(ev, mark, { once: true, passive: true }); });
        function go(){
          if(moved) return;
          window.scrollTo(0, Math.max(0, head.getBoundingClientRect().top + window.pageYOffset - 16));
        }
        // after the tab's own scroll to the section, and again after late layout above (unless the reader moved)
        setTimeout(go, 500);
        setTimeout(go, 1100);
        setTimeout(go, 1800);
      }

      /* ---------- init ---------- */
      renderList();
      st.pos = defaultPos();
      if(fromHash.run && runIds.indexOf(fromHash.run) >= 0) st.pos = runIds.indexOf(fromHash.run);
      renderAll();
      scrollListTo(st.task);
      reveal();

      /* ---------- linking (quiet; never switches tabs) ---------- */
      EX.on('select-task', function(p){
        if(p && p.task === st.task) reveal();
        if(!p || p.source === 'replay' || (p.set && p.set !== 'heldout') || !byId[p.task] || p.task === st.task) return;
        setTask(p.task, false);
        reveal();
      });
      EX.on('select-run', function(p){
        if(!p || p.source === 'replay' || runIds.indexOf(p.run) < 0) return;
        go(runIds.indexOf(p.run));
      });
      function relayout(w){
        var n = w < 760;
        if(n !== narrow){ narrow = n; root.classList.toggle('narrow', n); }
        renderTrain(); renderStage(); renderMatrix();
      }
      ctx.onResize(relayout);
      ctx.onShow(function(w){ if(w) relayout(w); scrollListTo(st.task); });
      void moreBuilt;
    });
  });
})();

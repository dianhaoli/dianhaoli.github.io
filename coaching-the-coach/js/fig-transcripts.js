/* fig-transcripts.js — Explore › Transcripts (mount "transcripts").
   Tabs: Player | Coaching sessions.
   Player: list on the left (one tab stop, arrow keys), the turns in the middle, the puzzle and final answers on the right.
     Behind "More options": run / kind filters, the evolution-series view, and step-by-step replay (Prev / Next).
   Coaching sessions: a run picker and that run's sessions by generation (outcome chip + practice score change), then
     one session as a vertical story: what the coach was shown (collapsed), its messages, each command (output behind
     a toggle; text written after the call in the same message rides with it), harness reminders, gateway replies and
     unreadable messages as small markers, the edit (files, +/- lines, diff behind a toggle) and the outcome
     (score before -> after, puzzles gained / lost as chips, noted as noise when the player was unchanged).
     "Step through" reveals one step at a time (sticky Back / Next bar, arrow keys, Show all) and scrolls to it.
   Data: transcripts.json, tasks.json, trees.json, coach/index.json when the tab is first shown; coach/<run>.json lazily.
   Emits: select-task (player pick, puzzle chip), select-node (session pick / "Show in tree").
   Listens: open-transcript {run, node} (also reads EX.pendingTranscript at start); never switches tabs itself. */
(function(){
  'use strict';
  var F = EX.fmt;
  var NAME = 'transcripts';
  var MODEL_ROLES = /^(Output|Refinement output|Verification output)$/;

  function genNum(g){ return g === 'initial' || g == null ? 0 : +g; }
  function genText(g){ return 'Generation ' + genNum(g); }
  function plain(run){ return EX.runLabel(run, { plain: true }); }
  function decodeRepr(t){
    if(typeof t !== 'string' || t.length < 1) return t || '';
    var q = t.charAt(0);
    if(q !== "'" && q !== '"') return t;
    var s = t.slice(1);
    if(s.length && s.charAt(s.length - 1) === q) s = s.slice(0, -1);
    return s.replace(/\\(n|t|'|"|\\)/g, function(m, c){ return c === 'n' ? '\n' : c === 't' ? '\t' : c; });
  }
  var ELIDE_RE = /(\[\.\.\.[^\]]*\]|\[\d+ turns? elided\]|…\s*\[clipped[^\]]*\])/g;
  function fillText(pre, text){
    pre.textContent = '';
    var last = 0, m;
    ELIDE_RE.lastIndex = 0;
    while((m = ELIDE_RE.exec(text))){
      if(m.index > last) pre.appendChild(document.createTextNode(text.slice(last, m.index)));
      EX.h('span', { 'class': 'elide' }, pre, m[0]);
      last = m.index + m[0].length;
    }
    if(last < text.length) pre.appendChild(document.createTextNode(text.slice(last)));
  }
  function parseAnswer(text){
    var m = /<answer>\s*([\s\S]*?)<\/answer>/.exec(text || '');
    if(!m) return null;
    try {
      var g = JSON.parse(m[1]);
      if(Array.isArray(g) && g.length && Array.isArray(g[0]) && g.every(function(r){ return Array.isArray(r) && r.every(function(v){ return v >= 0 && v <= 9; }); })) return g;
    } catch(e){}
    return null;
  }
  function dims(g){ return g && g.length ? g.length + '×' + g[0].length : '—'; }
  function diffText(g, truth){
    if(!g) return 'no grid';
    if(!truth) return dims(g);
    if(g.length !== truth.length || g[0].length !== truth[0].length) return 'wrong size';
    var w = 0;
    for(var r = 0; r < g.length; r++) for(var c = 0; c < g[r].length; c++) if(g[r][c] !== truth[r][c]) w++;
    return w === 0 ? 'right' : w + ' cell' + (w > 1 ? 's' : '') + ' off';
  }
  function kindOf(it){
    if(it.kind === 'pred_only') return 'solved';
    var w = it.why || '';
    if(/^evolution series/.test(w)) return 'series';
    if(/second model call/.test(w)) return 'twocall';
    if(/crashed/.test(w)) return 'crash';
    return 'sample';
  }
  var GROUP_RANK = { source: 0, I0: 1, Ig: 2, g20: 3, g40: 4 };
  function runRank(run){ var g = EX.runGroup(run); return (GROUP_RANK[g] != null ? GROUP_RANK[g] : 9) * 100 + (parseInt((/(\d+)(?!.*\d)/.exec(run) || [0, 0])[1], 10) || 0) + (/g40$/.test(run) ? 50 : 0); }

  /* ---- coaching sessions: module-level helpers ---- */
  var DEFAULT_SESSION = { run: 'source_s1', node: '2' };   // "use the second call to verify": a clear improving edit
  var OUTCOME_TEXT = { improved: 'improved', same: 'same', worse: 'worse', broke: 'broke', 'no edit': 'no edit', 'not scored': 'not scored' };
  var ROLE_TEXT = { player: 'player', coach: 'coach' };
  var STEP_NAME = { think: 'the coach writes', command: 'a command', edit: 'the edit', outcome: 'the outcome' };
  var COACH_GROUPS = ['source', 'I0', 'Ig', 'g20', 'g40', 'test'];
  var COACH_GROUP_LABEL = { source: 'Self-improvement runs', I0: 'Original coach', Ig: 'Generation-12 coach', g20: 'Generation-20 coach', g40: 'Generation-40 coach', test: 'Short test runs' };
  function coachGroup(run){ return EX.runGroup(run) || 'test'; }
  function coachRunLabel(run){
    var m;
    if(run === 'smoke') return 'Smoke test';
    if((m = /^trial_Ig_source_s(\d)$/.exec(run))) return 'Trial of the generation-12 coach from run ' + m[1];
    return EX.runLabel ? EX.runLabel(run, { plain: true }) : run;
  }
  function indexCoach(CI){
    if(!CI || !CI.sessions) return null;
    var byKey = {}, byRun = {};
    CI.sessions.forEach(function(s){
      s.node = String(s.node);
      s.in_trees = !!((CI.runs || []).filter(function(r){ return r.run === s.run; })[0] || {}).in_trees;
      byKey[s.run + ':' + s.node] = s;
      (byRun[s.run] = byRun[s.run] || []).push(s);
    });
    Object.keys(byRun).forEach(function(r){
      byRun[r].sort(function(a, b){ return a.generation - b.generation || (a.aborted ? -1 : 0) - (b.aborted ? -1 : 0) || (a.node < b.node ? -1 : 1); });
    });
    return { runs: CI.runs || [], sessions: CI.sessions, byKey: byKey, byRun: byRun };
  }
  function scoreChange(s, words){
    var a = s.practice_before, b = s.practice_after, k = s.outcome_kind;
    if(k === 'no edit') return words ? 'no change made' : '—';
    if(b == null) return words ? 'not scored' : '—';
    if(a == null) return F.pct(b, 0);
    return F.pct(a, 0) + (words ? ' to ' : ' → ') + F.pct(b, 0);
  }
  function outcomeChip(parent, s){
    var k = s.outcome_kind || 'not scored';
    return EX.h('span', { 'class': 'fxc-oc oc-' + k.replace(/\s+/g, '-'), 'aria-hidden': parent.tagName === 'BUTTON' ? 'true' : null }, parent, OUTCOME_TEXT[k] || k);
  }

  EX.mount(NAME, function(node, ctx){
    node.innerHTML = '';
    var root = EX.h('div', { 'class': 'fx-transcripts' }, node);
    EX.h('div', { 'class': 'fxt-loading', role: 'status' }, root, 'Loading transcripts…');
    var st = { tab: 'player', view: 'single', runF: 'all', kindF: 'all', cur: { player: null, coach: null }, series: 0, step: false, cursor: 0, mode: null,
      cstep: false, ccur: 0 };
    var D = null, pendingOpen = null, ui = {};

    EX.on('open-transcript', function(p){
      if(!p || p.source === NAME) return;
      pendingOpen = p;
      if(D) applyOpen();
    });

    var coachIndex = EX.load('coach/index').catch(function(e){ console.warn('[transcripts] coach index unavailable', e); return null; });
    return Promise.all([EX.load('transcripts'), EX.load('tasks'), EX.load('trees'), coachIndex]).then(function(res){ build(res[0], res[1], res[2], res[3]); });

    function build(TX, TK, TR, CI){
      var tasks = TK.tasks, trees = TR.trees;
      var player = TX.player.map(function(p, i){ return Object.assign({ uid: 'p' + i, k: kindOf(p) }, p); });
      var solved = TX.solved_replays.map(function(p, i){ return Object.assign({ uid: 's' + i, k: 'solved' }, p); });
      var coach = TX.coach.map(function(c, i){ return Object.assign({ uid: 'c' + i, k: 'coach' }, c); });
      var series = TX.evolution_series.map(function(s){
        var items = player.concat(solved).filter(function(p){ return p.run === s.run && p.task === s.task && p.test_input === s.test_input; })
          .sort(function(a, b){ return genNum(a.generation) - genNum(b.generation); });
        return { run: s.run, task: s.task, test_input: s.test_input, items: items };
      });
      player.concat(solved).forEach(function(p){ p.series = -1; series.forEach(function(s, i){ if(s.items.indexOf(p) >= 0) p.series = i; }); });
      var allPlayer = player.concat(solved).sort(function(a, b){
        return runRank(a.run) - runRank(b.run) || (a.task < b.task ? -1 : a.task > b.task ? 1 : 0) || genNum(a.generation) - genNum(b.generation);
      });
      D = { tasks: tasks, trees: trees, player: player, solved: solved, coach: coach, series: series, allPlayer: allPlayer, CI: indexCoach(CI), runFiles: {} };

      st.cur.player = allPlayer.filter(function(p){ return p.k !== 'solved' && p.segments && p.segments.length; })[0] || allPlayer[0];
      st.cur.coach = findSession(DEFAULT_SESSION.run, DEFAULT_SESSION.node) || (D.CI && D.CI.sessions[0]) || null;

      var h = EX.hash.get();
      if(h.section === NAME){
        var pr = h.params;
        if(pr.tab === 'coach'){ st.tab = 'coach'; var c = findSession(pr.run, pr.node); if(c) st.cur.coach = c; }
        else if(pr.run){
          var p = allPlayer.filter(function(x){ return x.run === pr.run && String(x.node) === pr.node && x.task === pr.task; })[0];
          if(p) st.cur.player = p;
        }
      }
      if(!pendingOpen && EX.pendingTranscript) pendingOpen = EX.pendingTranscript;
      EX.pendingTranscript = null;

      root.innerHTML = '';
      var tl = EX.h('div', { 'class': 'tabs', role: 'tablist', 'aria-label': 'Transcript type' }, root);
      ui.tabs = {};
      [['player', 'Player', player.length + solved.length], ['coach', 'Coaching sessions', D.CI ? D.CI.sessions.length : coach.length]].forEach(function(t){
        var b = EX.h('button', { type: 'button', role: 'tab', id: EX.uid('fxt-tab'), 'aria-selected': String(st.tab === t[0]), tabindex: st.tab === t[0] ? '0' : '-1' }, tl, t[1] + ' (' + t[2] + ')');
        b.addEventListener('click', function(){ setTab(t[0], true); });
        ui.tabs[t[0]] = b;
      });
      tl.addEventListener('keydown', function(e){
        if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); e.stopPropagation();
        var nx = st.tab === 'player' ? 'coach' : 'player';
        setTab(nx, true); ui.tabs[nx].focus();
      });
      ui.panel = EX.h('div', { role: 'tabpanel' }, root);
      ui.live = EX.h('div', { 'class': 'sr-only', 'aria-live': 'polite' }, root);
      root.addEventListener('keydown', onKey);
      st.mode = modeFor(ctx.width());
      applyMode();
      render();
      ctx.onResize(function(w){ var m = modeFor(w); if(m !== st.mode){ st.mode = m; applyMode(); render(); } });
      ctx.onShow(function(w){ var m = modeFor(w); if(w && m !== st.mode){ st.mode = m; applyMode(); render(); } });
      if(pendingOpen) applyOpen();
    }

    function modeFor(w){ return w >= 1000 ? 'wide' : w >= 700 ? 'mid' : 'narrow'; }
    function applyMode(){ root.classList.toggle('mid', st.mode === 'mid'); root.classList.toggle('narrow', st.mode === 'narrow'); }
    function sideWidth(){ var w = ctx.width(); return st.mode === 'wide' ? 320 : st.mode === 'mid' ? w - 220 - 24 : w; }
    function findSession(run, nodeId){ return D.CI ? D.CI.byKey[run + ':' + nodeId] || null : null; }

    function setTab(t, user){
      if(st.tab === t && user) return;
      st.tab = t; st.step = false; st.cstep = false;
      Object.keys(ui.tabs).forEach(function(k){
        ui.tabs[k].setAttribute('aria-selected', String(k === t));
        ui.tabs[k].setAttribute('tabindex', k === t ? '0' : '-1');
      });
      render();
      if(user) writeHash();
    }
    function writeHash(){
      if(st.tab === 'coach'){ var c = st.cur.coach; if(c) EX.hash.set(NAME, { tab: 'coach', run: c.run, node: c.node }); else EX.hash.set(NAME, { tab: 'coach' }); }
      else { var p = st.cur.player; EX.hash.set(NAME, { tab: 'player', run: p.run, node: p.node, task: p.task }); }
    }
    function applyOpen(){
      var p = pendingOpen; pendingOpen = null;
      if(!p) return;
      var c = findSession(p.run, p.node);
      if(c){
        st.cur.coach = c; st.cstep = false; st.ccur = 0;
        if(st.tab !== 'coach') setTab('coach', false); else render();
        if(p.source && p.source !== 'hash') EX.hash.set(NAME, { tab: 'coach', run: c.run, node: c.node }, { replace: false });
        focusSessionTitle();
        return;
      }
      var pl = D.player.filter(function(x){ return x.run === p.run && String(x.node) === String(p.node); })[0];
      if(pl){ st.view = 'single'; st.cur.player = pl; if(st.tab !== 'player') setTab('player', false); else render(); }
    }

    function focusSessionTitle(){
      setTimeout(function(){
        var h = ui.cmain && ui.cmain.querySelector('.fxc-head h4');
        if(!h) return;
        h.setAttribute('tabindex', '-1');
        h.scrollIntoView({ block: 'start', behavior: 'auto' });
        try { h.focus({ preventScroll: true }); } catch(e){ h.focus(); }
      }, 450);
    }
    /* ←/→ step turns in step-by-step mode */
    function onKey(e){
      var stepping = st.tab === 'coach' ? st.cstep : st.step;
      if(!stepping || e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target, tag = (t.tagName || '').toLowerCase();
      if(tag === 'select' || tag === 'input' || tag === 'textarea' || (t.closest && (t.closest('[role="tablist"]') || t.closest('.fxt-list') || t.closest('.fxc-list')))) return;
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if(!d) return;
      e.preventDefault();
      if(st.tab === 'coach') cStepBy(d); else stepBy(d);
    }

    function render(){
      ui.panel.innerHTML = '';
      ui.panel.setAttribute('aria-labelledby', ui.tabs[st.tab].id);
      ui.turns = null;
      if(st.tab === 'coach') renderSessions(); else renderPlayer();
    }

    /* "More options": filters, series view, step-by-step */
    function buildMoreRow(P){
      var m = EX.more(P, 'More options', function(body){
        var ctl = EX.h('div', { 'class': 'controls fxt-ctl' }, body);
        if(st.tab === 'player'){
          var runs = []; D.allPlayer.forEach(function(p){ if(runs.indexOf(p.run) < 0) runs.push(p.run); });
          var byGroup = {};
          runs.forEach(function(r){ var g = EX.runGroup(r); (byGroup[g] = byGroup[g] || []).push(r); });
          var opts = [{ value: 'all', label: 'All runs' }];
          ['source', 'I0', 'Ig', 'g20', 'g40'].forEach(function(g){
            if(byGroup[g]) opts.push({ group: (EX.ARM_LABEL && EX.ARM_LABEL[g]) || g, options: byGroup[g].map(function(r){ return { value: r, label: plain(r) }; }) });
          });
          EX.selectBox(ctl, opts, st.runF, function(v){ st.runF = v; st.view = 'single'; render(); }, { label: 'Run' });
          EX.selectBox(ctl, [
            { value: 'all', label: 'All kinds' },
            { value: 'twocall', label: 'Two model calls (refine or verify)' },
            { value: 'crash', label: 'Player crashed' },
            { value: 'series', label: 'Same puzzle across generations' },
            { value: 'sample', label: 'Sampled failures' },
            { value: 'solved', label: 'Solved (answer only)' }
          ], st.kindF, function(v){ st.kindF = v; st.view = 'single'; render(); }, { label: 'Kind' });
          var sb = EX.h('button', { type: 'button', 'class': 'btn', 'aria-pressed': String(st.view === 'series') }, ctl,
            st.view === 'series' ? 'Back to one transcript' : 'Evolution series view');
          sb.addEventListener('click', function(){ st.view = st.view === 'series' ? 'single' : 'series'; st.step = false; render(); ui.more.open(); });
        }
        if(st.view !== 'series'){
          var rb = EX.h('button', { type: 'button', 'class': 'btn', 'aria-pressed': String(st.step) }, ctl, st.step ? 'Show all turns' : 'Replay step by step');
          rb.addEventListener('click', function(){ st.step = !st.step; st.cursor = 0; render(); ui.more.open(); });
        }
      });
      ui.more = m;
      if(st.step || st.view === 'series' || st.runF !== 'all' || st.kindF !== 'all') m.open();
    }

    /* ======================= PLAYER ======================= */
    function filteredPlayer(){
      return D.allPlayer.filter(function(p){
        if(st.runF !== 'all' && p.run !== st.runF) return false;
        var k = st.kindF;
        if(k === 'all') return true;
        if(k === 'series') return p.series >= 0;
        return p.k === k;
      });
    }
    function renderPlayer(){
      var P = ui.panel;
      buildMoreRow(P);
      if(st.view === 'series'){ renderSeries(P); return; }
      var B = EX.h('div', { 'class': 'fxt-body' }, P);
      var items = filteredPlayer();
      if(items.length && items.indexOf(st.cur.player) < 0) st.cur.player = items.filter(function(p){ return p.k !== 'solved'; })[0] || items[0];
      var lc = EX.h('div', { 'class': 'fxt-listcol' }, B);
      EX.h('p', { 'class': 'fxt-listnote' }, lc, 'Saved player transcripts are all failed attempts; solved ones show the answer only.');
      ui.list = EX.h('ul', { 'class': 'fxt-list', 'aria-label': 'Player transcripts' }, lc);
      if(!items.length) EX.h('li', { 'class': 'empty' }, ui.list, 'No transcripts match these filters.');
      items.forEach(function(p){
        var li = EX.h('li', null, ui.list);
        var b = EX.h('button', { type: 'button', 'class': 'fxt-item', tabindex: '-1', 'aria-current': String(p === st.cur.player) }, li);
        EX.h('span', { 'class': 'l1' }, b, plain(p.run));
        EX.h('span', { 'class': 'l2' }, b, genText(p.generation) + ', puzzle ' + p.task + (p.k === 'solved' ? ' (answer only)' : ''));
        b.addEventListener('click', function(){ pickPlayer(p, b); });
      });
      listRoving();
      ui.txcol = EX.h('div', { 'class': 'fxt-txcol' }, B);
      ui.side = EX.h('div', { 'class': 'fxt-sidecol side-panel' }, B);
      renderPlayerItem();
      keepCurInView();
    }
    function pickPlayer(p, b){
      st.cur.player = p; st.cursor = 0;
      markCur(b);
      renderPlayerItem();
      EX.select('task', { task: p.task, set: p.task_set, source: NAME });
      writeHash();
    }
    function markCur(b){
      Array.prototype.forEach.call(ui.list.querySelectorAll('.fxt-item'), function(x){ x.setAttribute('aria-current', String(x === b)); });
      if(ui.rov) ui.rov.refresh();
    }
    function listRoving(){
      ui.rov = EX.roving(ui.list, '.fxt-item', { orientation: 'vertical', onActivate: function(el){ el.click(); } });
    }
    function keepCurInView(){
      var cur = ui.list.querySelector('[aria-current="true"]');
      if(cur){ var li = cur.parentNode; ui.list.scrollTop = Math.max(0, li.offsetTop - ui.list.offsetTop - 60); }
    }
    function renderPlayerItem(){
      var p = st.cur.player, T = ui.txcol, S = ui.side;
      T.innerHTML = ''; S.innerHTML = '';
      if(!p){ EX.h('p', { 'class': 'empty' }, T, 'Pick an item from the list.'); return; }
      var task = D.tasks[p.task], test = task && task.test[p.test_input], truth = test && test.output;
      var hd = EX.h('div', { 'class': 'fxt-head' }, T);
      EX.h('h4', null, hd, plain(p.run) + ', ' + genText(p.generation).toLowerCase());
      EX.h('p', { 'class': 'fxt-why' }, T, p.k === 'solved' ? 'Solved, so no transcript was saved: only the answer survives (right).' : whyText(p));
      if(p.segments && p.segments.length) buildTurns(T, p.segments, false, truth);
      renderPuzzleSide(S, p, task, test, truth);
    }
    function whyText(p){
      return { series: 'This practice puzzle failed at several generations of this run.',
        twocall: 'This edited player makes a second model call to ' + (p.segments.some(function(s){ return /^Verification/.test(s.role); }) ? 'verify' : 'refine') + ' its first answer.',
        crash: 'The player crashed before it could answer.',
        sample: 'A failed practice answer sampled from this run.' }[p.k] || '';
    }
    function renderPuzzleSide(S, p, task, test, truth){
      var w = sideWidth();
      var ansMax = Math.max(64, Math.min(st.mode === 'wide' ? 92 : 120, Math.floor((w - 32) / 3)));
      EX.h('div', { 'class': 'side-sec' }, S, 'Final answers vs the correct answer');
      var row = EX.h('div', { 'class': 'fxt-answers' }, S);
      var answers = p.answers || [];
      var nAtt = Math.max(answers.length, p.k === 'solved' ? 2 : (p.n_answers || 0));
      if(nAtt === 0) EX.arcGrid(row, null, { label: 'Answer', emptyText: p.k === 'crash' ? 'crashed' : 'no answer', emptySize: ansMax });
      for(var i = 0; i < nAtt; i++){
        var g = answers[i] || null, ok = p.attempt_correct ? !!p.attempt_correct[i] : false;
        EX.arcGrid(row, g, { label: 'Try ' + (i + 1) + ' <span class="' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓' : '× ' + EX.esc(diffText(g, truth))) + '</span>',
          maxSize: ansMax, diffAgainst: truth, title: 'Try ' + (i + 1) + (ok ? ' (right)' : ' (wrong)'), emptyText: 'not recorded', emptySize: ansMax });
      }
      EX.arcGrid(row, truth, { label: '<b>Correct</b>', maxSize: ansMax, title: 'Correct answer', emptyText: 'no truth' });
      if(!task) return;
      EX.h('div', { 'class': 'side-sec' }, S, 'The puzzle');
      var tr = EX.h('div', { 'class': 'fxt-train' }, S);
      var pairMax = Math.max(60, Math.min(st.mode === 'narrow' ? 88 : 120, Math.floor((w - 30) / 2)));
      task.train.forEach(function(pr, i){ EX.arcPair(tr, pr.input, pr.output, { maxSize: pairMax, labels: ['Example ' + (i + 1), null] }); });
      EX.arcGrid(S, test.input, { maxSize: Math.min(2 * pairMax, 150), label: 'Test input', title: 'Test input' });
    }

    /* evolution series (More options) */
    function renderSeries(P){
      var ctl = EX.h('div', { 'class': 'controls' }, P);
      var opts = D.series.map(function(s, i){ return { value: String(i), label: plain(s.run) + ' · ' + s.task }; });
      EX.selectBox(ctl, opts, String(st.series), function(v){ st.series = +v; render(); }, { label: 'Series' });
      var s = D.series[st.series];
      var task = D.tasks[s.task], test = task.test[s.test_input], truth = test.output;
      EX.h('p', { 'class': 'fxt-why' }, P, 'Puzzle ' + s.task + ' across ' + s.items.length + ' saved generations of ' + plain(s.run) + ', left to right.');
      var sc = EX.h('div', null, P);
      var strip = EX.h('div', { 'class': 'fxt-strip' }, sc);
      var gmax = st.mode === 'narrow' ? 88 : 104, colW = (gmax + 24) + 'px';
      var ref = EX.h('div', { 'class': 'fxt-gcol ref', style: { width: colW } }, strip);
      EX.h('div', { 'class': 'gh' }, ref, 'Puzzle');
      EX.arcGrid(ref, test.input, { maxSize: gmax, label: 'Test input', title: 'Test input' });
      EX.arcGrid(ref, truth, { maxSize: gmax, label: '<b>Correct</b>', title: 'Correct answer' });
      s.items.forEach(function(it){
        var col = EX.h('div', { 'class': 'fxt-gcol', style: { width: colW } }, strip);
        var gh = EX.h('div', { 'class': 'gh' }, col);
        EX.h('span', null, gh, genText(it.generation));
        EX.h('span', { 'class': it.correct ? 'ok' : 'no' }, gh, it.correct ? '✓' : '×');
        for(var i = 0; i < 2; i++){
          var g = (it.answers || [])[i] || null;
          EX.arcGrid(col, g, { maxSize: gmax, diffAgainst: truth, label: 'Try ' + (i + 1), title: genText(it.generation) + ' try ' + (i + 1), emptyText: 'not recorded', emptySize: gmax });
        }
        if(it.segments){
          var b = EX.h('button', { type: 'button', 'class': 'btn small' }, col, 'Read');
          b.addEventListener('click', function(){ st.cur.player = it; st.view = 'single'; st.runF = 'all'; st.kindF = 'all'; render(); writeHash(); });
        }
      });
      EX.scrollHint(sc);
    }

    /* ======================= COACHING SESSIONS ======================= */
    function sessionsOf(run){ return (D.CI && D.CI.byRun[run]) || []; }
    function renderSessions(){
      var P = ui.panel;
      if(!D.CI || !D.CI.sessions.length){
        EX.h('p', { 'class': 'empty' }, P, 'The coaching sessions could not be loaded.');
        return;
      }
      if(!st.cur.coach) st.cur.coach = D.CI.sessions[0];
      var c = st.cur.coach;
      var B = EX.h('div', { 'class': 'fxc' }, P);
      var pick = EX.h('div', { 'class': 'fxc-pick' }, B);
      var ctl = EX.h('div', { 'class': 'fxc-runsel' }, pick);
      var groups = {}, order = [];
      D.CI.runs.forEach(function(r){
        var g = coachGroup(r.run);
        if(!groups[g]){ groups[g] = []; order.push(g); }
        groups[g].push({ value: r.run, label: coachRunLabel(r.run) + ' (' + r.n_sessions + ')' });
      });
      order.sort(function(a, b){ return COACH_GROUPS.indexOf(a) - COACH_GROUPS.indexOf(b); });
      var opts = order.map(function(g){ return { group: COACH_GROUP_LABEL[g] || g, options: groups[g] }; });
      var sel = EX.selectBox(ctl, opts, c.run, function(v){ pickRun(v); }, { label: 'Run' });
      sel.setAttribute('aria-label', 'Run');
      var list = sessionsOf(c.run);
      var nEdit = list.filter(function(s){ return s.made_edit; }).length;
      var nAb = list.filter(function(s){ return s.aborted; }).length;
      EX.h('p', { 'class': 'fxc-runnote' }, pick, list.length + ' session' + (list.length === 1 ? '' : 's') +
        (nAb ? ' (' + (list.length - nAb) + ' generations plus ' + nAb + ' restarted attempt' + (nAb === 1 ? '' : 's') + ')' : ', one per generation') +
        '; ' + nEdit + ' changed the code.');
      ui.clist = EX.h('ul', { 'class': 'fxc-list', 'aria-label': 'Sessions in ' + coachRunLabel(c.run) }, pick);
      list.forEach(function(s){
        var li = EX.h('li', null, ui.clist);
        var b = EX.h('button', { type: 'button', 'class': 'fxc-item', tabindex: '-1', 'aria-current': String(s === c), 'data-node': s.node }, li);
        EX.h('span', { 'class': 'g' }, b, 'Gen ' + s.generation);
        if(s.aborted) EX.h('span', { 'class': 'rs', 'aria-hidden': 'true' }, b, 'restarted');
        outcomeChip(b, s);
        EX.h('span', { 'class': 'sc' }, b, scoreChange(s));
        b.setAttribute('aria-label', 'Generation ' + s.generation + (s.aborted ? ' (restarted round)' : '') + ': ' + OUTCOME_TEXT[s.outcome_kind] + ', ' + scoreChange(s, true));
        b.addEventListener('click', function(){ pickSession(s, true); });
      });
      if(list.length > 10) EX.h('p', { 'class': 'fxc-listhint' }, pick, 'Scroll the list to see all ' + list.length + '.');
      if(nAb) EX.h('p', { 'class': 'fxc-runnote' }, pick, '“restarted”: an attempt the harness stopped while scoring it; the generation was then run again.');
      ui.crov = EX.roving(ui.clist, '.fxc-item', { orientation: 'vertical', onActivate: function(el){ el.click(); } });
      ui.cmain = EX.h('div', { 'class': 'fxc-main' }, B);
      renderSession();
      var cur = ui.clist.querySelector('[aria-current="true"]');
      if(cur){ var li2 = cur.parentNode; ui.clist.scrollTop = Math.max(0, li2.offsetTop - ui.clist.offsetTop - 80); }
    }
    function pickRun(run){
      var list = sessionsOf(run);
      var s = list.filter(function(x){ return x.outcome_kind === 'improved'; })[0] || list[0];
      if(!s) return;
      st.cur.coach = s; st.cstep = false; st.ccur = 0;
      render(); writeHash();
      if(ui.clist){ var b = ui.clist.querySelector('[aria-current="true"]'); void b; }
    }
    function pickSession(s, user){
      st.cur.coach = s; st.cstep = false; st.ccur = 0;
      Array.prototype.forEach.call(ui.clist.querySelectorAll('.fxc-item'), function(x){ x.setAttribute('aria-current', String(x.getAttribute('data-node') === s.node)); });
      if(ui.crov) ui.crov.refresh();
      renderSession();
      if(user){
        writeHash();
        if(s.in_trees && !s.aborted) EX.select('node', { run: s.run, node: String(s.node), source: NAME });
      }
    }

    function renderSession(){
      var s = st.cur.coach, M = ui.cmain;
      M.innerHTML = '';
      var hd = EX.h('div', { 'class': 'fxc-head' }, M);
      EX.h('h4', null, hd, coachRunLabel(s.run) + ' · generation ' + s.generation);
      var meta = [];
      meta.push(s.parent === 'initial' ? 'Started from the original code (generation 0)' : s.parent ? 'Started from the code of generation ' + String(s.parent).split('.')[0]
        : s.aborted ? 'Starting generation not recorded' : null);
      meta.push(s.n_commands + ' command' + (s.n_commands === 1 ? '' : 's'));
      if(s.coach_tokens) meta.push(F.tokens(s.coach_tokens) + ' tokens');
      EX.h('p', { 'class': 'fxc-meta' }, hd, meta.filter(Boolean).join(' · '));
      if(s.aborted) EX.h('p', { 'class': 'fxc-meta' }, hd, 'The coach finished this session, but the harness was stopped while the result was being scored and ran generation ' + s.generation + ' again, so this attempt has no score.');
      var body = EX.h('div', { 'class': 'fxc-body', 'aria-busy': 'true' }, M);
      EX.h('p', { 'class': 'fxc-loading', role: 'status' }, body, 'Loading this run’s sessions…');
      var token = ui.sessToken = {};
      loadRun(s.run).then(function(R){
        if(ui.sessToken !== token) return;
        var rec = R && R.sessions && R.sessions[s.node];
        body.innerHTML = ''; body.removeAttribute('aria-busy');
        if(!rec){ EX.h('p', { 'class': 'empty' }, body, 'This session’s steps are missing.'); return; }
        buildStory(body, s, rec);
      }, function(err){
        if(ui.sessToken !== token) return;
        body.innerHTML = ''; body.removeAttribute('aria-busy');
        EX.h('p', { 'class': 'empty' }, body, 'This run’s sessions could not be loaded (' + String(err && err.message || err) + ').');
      });
    }
    function loadRun(run){ return EX.load('coach/' + run); }

    /* Turn the step list into story items. Steps (think / command+output / edit / outcome) are what
       "Step through" walks; nudges and DONE are small markers that ride along with the step before them. */
    function storyItems(rec){
      var items = [], steps = rec.steps || [], brief = null;
      for(var i = 0; i < steps.length; i++){
        var x = steps[i];
        if(x.kind === 'brief'){ brief = x; continue; }
        if(x.kind === 'command'){
          var after = [];
          while(steps[i + 1] && steps[i + 1].kind === 'think' && steps[i + 1].after_call) after.push(steps[++i]);
          var out = steps[i + 1] && steps[i + 1].kind === 'output' ? steps[++i] : null;
          items.push({ kind: 'command', step: true, cmd: x, out: out, after: after });
        } else if(x.kind === 'output') items.push({ kind: 'command', step: true, cmd: null, out: x, after: [] });
        else if(x.kind === 'think' && !x.empty) items.push({ kind: 'think', step: true, s: x });
        else if(x.kind === 'nudge' || x.kind === 'done' || x.kind === 'think'){
          var last = items[items.length - 1];
          if(last && last.kind === 'marks') last.list.push(x);
          else items.push({ kind: 'marks', step: false, list: [x] });
        }
        /* 'edit' is drawn from the index record (files) + rec.diff */
      }
      items.push({ kind: 'edit', step: true });
      items.push({ kind: 'outcome', step: true });
      return { brief: brief, items: items };
    }

    function buildStory(body, s, rec){
      var S = storyItems(rec);
      var bar = EX.h('div', { 'class': 'fxc-bar' }, body);
      var modeSeg = EX.seg(bar, [{ value: 'all', label: 'Read all' }, { value: 'step', label: 'Step through' }], st.cstep ? 'step' : 'all', function(v){
        st.cstep = v === 'step'; st.ccur = 0; applyStep(true);
        if(st.cstep && ui.cnext) ui.cnext.focus();
      }, { ariaLabel: 'How to read the session' });
      var nav = EX.h('div', { 'class': 'fxc-nav', role: 'group', 'aria-label': 'Step through the session' }, bar);
      ui.cprev = EX.h('button', { type: 'button', 'class': 'btn small', 'aria-label': 'Previous step' }, nav, '‹ Back');
      ui.cnext = EX.h('button', { type: 'button', 'class': 'btn small', 'aria-label': 'Next step' }, nav, 'Next step ›');
      var allB = EX.h('button', { type: 'button', 'class': 'btn small quiet' }, nav, 'Show all');
      ui.cpos = EX.h('span', { 'class': 'fxc-pos', 'aria-hidden': 'true' }, nav);
      ui.cprev.addEventListener('click', function(){ cStepBy(-1); });
      ui.cnext.addEventListener('click', function(){ cStepBy(1); });
      allB.addEventListener('click', function(){ st.cstep = false; modeSeg.set('all'); applyStep(false); });
      ui.cmodeSeg = modeSeg;

      EX.h('p', { 'class': 'fxc-note' }, body, 'These are the coach’s visible messages and the commands it ran; the model’s hidden reasoning was not recorded. ' +
        'The harness runs one command per message; when a message has none, it sends a short reminder (small grey lines).');

      var tl = EX.h('ol', { 'class': 'fxc-tl', 'aria-label': 'The session, step by step' }, body);
      if(S.brief) briefItem(tl, S.brief);
      ui.citems = [];
      var stepNo = 0;
      S.items.forEach(function(it){
        var li;
        if(it.kind === 'think') li = thinkItem(tl, it.s);
        else if(it.kind === 'command') li = commandItem(tl, it);
        else if(it.kind === 'marks') li = marksItem(tl, it.list);
        else if(it.kind === 'edit') li = editItem(tl, s, rec);
        else if(it.kind === 'outcome') li = outcomeItem(tl, s);
        if(it.step) stepNo++;
        ui.citems.push({ el: li, step: it.step, n: stepNo, kind: it.kind });
      });
      ui.cnSteps = stepNo;
      applyStep(false);
    }
    function applyStep(scroll){
      var on = st.cstep, n = ui.cnSteps || 0;
      st.ccur = Math.max(0, Math.min(n - 1, st.ccur));
      ui.cprev.parentNode.hidden = !on;
      ui.cprev.parentNode.parentNode.classList.toggle('is-stepping', on);
      var target = st.ccur + 1, curEl = null;
      (ui.citems || []).forEach(function(it){
        var vis = !on || it.n <= target;
        it.el.hidden = !vis;
        var isCur = on && it.step && it.n === target;
        it.el.classList.toggle('is-cur', isCur);
        if(isCur) curEl = it.el;
      });
      ui.cprev.disabled = st.ccur <= 0; ui.cnext.disabled = st.ccur >= n - 1;
      ui.cpos.textContent = 'Step ' + (st.ccur + 1) + ' of ' + n;
      if(scroll && curEl) revealStep(curEl);
    }
    /* bring the newest step into view below the (sticky) step bar */
    function revealStep(el){
      var bar = ui.cprev && ui.cprev.closest('.fxc-bar');
      var barH = bar ? bar.getBoundingClientRect().height : 0;
      var r = el.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
      var top = barH + 16;
      if(r.top >= top && r.bottom <= vh - 8) return;
      var y = window.pageYOffset + r.top - top;
      if(r.height < vh - top - 8 && r.top > top) y = window.pageYOffset + r.bottom - vh + 24;   // short step below: just scroll it up into view
      window.scrollTo({ top: Math.max(0, y), behavior: EX.reduceMotion ? 'auto' : 'smooth' });
    }
    function cStepBy(d){
      if(!st.cstep || !ui.citems) return;
      var before = st.ccur;
      st.ccur = Math.max(0, Math.min((ui.cnSteps || 1) - 1, st.ccur + d));
      if(st.ccur === before) return;
      applyStep(true);
      var cur = ui.citems.filter(function(it){ return it.step && it.n === st.ccur + 1; })[0];
      if(ui.live) ui.live.textContent = 'Step ' + (st.ccur + 1) + ' of ' + ui.cnSteps + ': ' + (STEP_NAME[cur && cur.kind] || '');
    }

    function marker(li, cls){ EX.h('span', { 'class': 'fxc-dot ' + cls, 'aria-hidden': 'true' }, li); }
    function briefItem(tl, b){
      var li = EX.h('li', { 'class': 'fxc-step k-brief' }, tl);
      marker(li, 'd-brief');
      var det = EX.h('details', { 'class': 'more fxc-brief' }, li);
      EX.h('summary', null, det, 'What the coach was shown');
      var inner = EX.h('div', null, det);
      var what = b.n_traces ? 'The instructions, earlier scores and ' + b.n_traces + ' failed practice puzzle' + (b.n_traces === 1 ? '' : 's') + ' (what the player saw and answered).'
        : b.has_scores ? 'The instructions, with a summary of earlier scores.' : 'The instructions only; the coach had to look up earlier results itself.';
      EX.h('p', { 'class': 'fxc-sub' }, inner, what + ' ' + briefTrimText(b));
      EX.h('pre', { 'class': 'code wrap fxc-pre tall', tabindex: '0', 'aria-label': 'What the coach was shown' }, inner, b.text);
      return li;
    }
    function briefTrimText(b){
      var t = b.trim;
      if(!b.truncated || !t) return 'Shown in full.';
      var cut = [];
      if(t.grid_rows_cut || t.grids_shortened) cut.push('long puzzle grids (answers included) are cut short');
      if(t.traces_trimmed) cut.push('each failed puzzle keeps only its start and end');
      if(t.capped) cut.push('the middle of the text is left out');
      return 'Shortened for display from ' + F.int(b.full_chars) + ' characters: ' + cut.join('; ') + '.';
    }
    function thinkItem(tl, x){
      var li = EX.h('li', { 'class': 'fxc-step k-think' }, tl);
      marker(li, 'd-think');
      sayBox(li, x);
      return li;
    }
    function sayBox(li, x){
      EX.h('span', { 'class': 'sr-only' }, li, 'Coach: ');
      if(x.after_call) EX.h('p', { 'class': 'fxc-sub fxc-aftercap' }, li, 'Written after the command, in the same message (before it ran):');
      var box = EX.h('div', { 'class': 'fxc-say' + (x.empty ? ' is-empty' : '') }, li);
      var text = x.text || '';
      prose(box, text);
      if(x.unparsed_call) EX.h('p', { 'class': 'fxc-sub fxc-warn' }, li, 'This message contains a tool call the harness could not read (or one past the first), so it did not run.');
      if(text.length > 1400){
        box.classList.add('is-clamped');
        var mb = EX.h('button', { type: 'button', 'class': 'fxc-link', 'aria-expanded': 'false' }, li, 'Show the whole message');
        mb.addEventListener('click', function(){
          var open = box.classList.toggle('is-clamped') === false;
          mb.setAttribute('aria-expanded', String(open)); mb.textContent = open ? 'Show less' : 'Show the whole message';
        });
      }
      if(x.collapsed_repeats) EX.h('p', { 'class': 'fxc-sub' }, li, 'A long run of repeated text in this message was collapsed.');
    }
    /* light prose: paragraphs, `code`, keep line breaks */
    function prose(box, text){
      text.split(/\n{2,}/).forEach(function(par){
        if(!par.trim()) return;
        var p = EX.h('p', null, box);
        var parts = par.split(/(`[^`\n]{1,200}`)/);
        parts.forEach(function(t){
          if(/^`[^`]+`$/.test(t)) EX.h('code', null, p, t.slice(1, -1));
          else if(t) p.appendChild(document.createTextNode(t));
        });
      });
    }
    function commandItem(tl, it){
      var li = EX.h('li', { 'class': 'fxc-step k-cmd' }, tl);
      marker(li, 'd-cmd');
      var x = it.cmd, out = it.out;
      var line = EX.h('div', { 'class': 'fxc-cmdline' }, li);
      var tool = x ? (x.tool || 'bash') : (out && out.tool) || 'tool';
      EX.h('span', { 'class': 'fxc-tool' }, line, toolVerb(tool, x));
      var one = x ? (x.cmd || x.text || '').split('\n')[0] : '(command not recorded)';
      EX.h('code', { 'class': 'fxc-cmd' }, line, one);
      var gist = x && tool === 'bash' ? cmdGist(x.text || x.cmd || '') : '';
      if(gist) EX.h('div', { 'class': 'fxc-gist' }, li, gist);
      (it.after || []).forEach(function(a){ var d = EX.h('div', { 'class': 'fxc-after' }, li); sayBox(d, a); });
      var hasMore = !!(out || (x && x.text && x.text !== x.cmd) || (x && x.ignored_calls));
      if(hasMore){
        var pid = EX.uid('fxc-out');
        var tg = EX.h('button', { type: 'button', 'class': 'fxc-link fxc-tog', 'aria-expanded': 'false', 'aria-controls': pid }, li,
          out ? 'show output' : 'show details');
        var panel = EX.h('div', { 'class': 'fxc-out', id: pid, hidden: true }, li);
        var built = false;
        tg.addEventListener('click', function(){
          if(!built){ built = true; fillCommand(panel, x, out); }
          var open = panel.hidden;
          panel.hidden = !open;
          tg.setAttribute('aria-expanded', String(open));
          tg.textContent = open ? (out ? 'hide output' : 'hide details') : (out ? 'show output' : 'show details');
        });
      }
      return li;
    }
    /* editor calls: view / create / str_replace / insert / undo_edit */
    function toolVerb(tool, x){
      if(tool === 'bash') return 'ran';
      if(tool !== 'editor') return tool;
      var op = (/^editor (\S+)/.exec((x && x.cmd) || '') || [])[1];
      return { view: 'viewed', create: 'created', str_replace: 'edited', insert: 'edited', undo_edit: 'undid an edit in' }[op] || 'editor';
    }
    /* a plain hint of what a shell command touched: the files and folders it names */
    function cmdGist(c){
      var seen = {}, names = [];
      var re = /(?:^|[\s'"=(<>])((?:\/?[\w.\-*{}]+\/)*[\w\-*{}]+\.(?:py|md|json|jsonl|txt|log|diff|sh|ya?ml|toml|cfg))\b/g, m;
      while((m = re.exec(c)) && names.length < 8){
        var n = m[1].replace(/^\/hyperagents\//, '').replace(/^\/tmp\/generate_[^/]+\//, '');
        if(!seen[n] && !/[*{}]/.test(n)){ seen[n] = true; names.push(n); }
      }
      if(!names.length) return '';
      var more = names.length > 5 ? ' …' : '';
      return 'Files named: ' + names.slice(0, 5).join(', ') + more;
    }
    function fillCommand(panel, x, out){
      if(x && x.text && x.text !== x.cmd){
        EX.h('div', { 'class': 'fxc-cap' }, panel, x.tool === 'editor' ? 'The edit' : 'Full command');
        EX.h('pre', { 'class': 'code wrap fxc-pre', tabindex: '0' }, panel, x.text);
        if(x.truncated) EX.h('p', { 'class': 'fxc-sub' }, panel, 'Shortened: ' + F.int(x.full_chars) + ' characters in full.');
      }
      if(x && x.ignored_calls) EX.h('p', { 'class': 'fxc-sub' }, panel, 'The same message asked for ' + x.ignored_calls + ' more command' + (x.ignored_calls > 1 ? 's' : '') + '; the harness runs only the first.');
      if(out){
        EX.h('div', { 'class': 'fxc-cap' }, panel, 'What came back');
        EX.h('pre', { 'class': 'code wrap fxc-pre', tabindex: '0' }, panel, out.text || '(no output)');
        if(out.truncated) EX.h('p', { 'class': 'fxc-sub' }, panel, 'Shortened to the start and end: ' + F.int(out.full_chars) + ' characters in full.');
      }
    }
    function marksItem(tl, list){
      var li = EX.h('li', { 'class': 'fxc-step k-mark' }, tl);
      marker(li, 'd-mark');
      var nudges = list.filter(function(x){ return x.kind === 'nudge' && !x.gateway; });
      var std = nudges.filter(function(x){ return /^\(standard nudge\)/.test(x.text); }).length;
      var other = nudges.filter(function(x){ return !/^\(standard nudge\)/.test(x.text); });
      var gw = list.filter(function(x){ return x.gateway; }).length;
      var empty = list.filter(function(x){ return x.kind === 'think'; });
      var bits = [];
      if(empty.length){
        var raw = empty.map(function(x){ return x.raw; }).filter(Boolean);
        bits.push([(empty.length === 1 ? 'A coach message with no readable text' : empty.length + ' coach messages with no readable text') +
          (raw.length ? ' (' + raw.slice(0, 3).map(function(r){ return '“' + r.slice(0, 24) + '”'; }).join(', ') + ')' : '') + '.', 'is-noise']);
      }
      if(std) bits.push([std === 1 ? 'Reminder: no command in that message.' : std + ' reminders: no command in those messages.', 'is-nudge']);
      if(gw) bits.push([(gw === 1 ? 'The model gateway replied' : 'The model gateway replied ' + gw + ' times') + ' in place of the coach: its token budget for this round (600k) was spent.', 'is-gw']);
      other.forEach(function(x){ bits.push(['Harness: ' + x.text.replace(/^\[harness\]\s*/, '').replace(/^\(standard nudge\)\s*/, ''), '']); });
      if(list.some(function(x){ return x.kind === 'done'; })) bits.push(['The coach said DONE.', '']);
      bits.forEach(function(t){ EX.h('div', { 'class': 'fxc-mark ' + t[1] }, li, t[0]); });
      return li;
    }
    function editItem(tl, s, rec){
      var li = EX.h('li', { 'class': 'fxc-step k-edit' }, tl);
      marker(li, 'd-edit');
      EX.h('div', { 'class': 'fxc-label' }, li, 'Edit');
      var files = (s.files_edited || []).filter(function(f){ return !(/__pycache__|\.pyc$/.test(f.path) && !f.added && !f.removed); });
      if(!s.made_edit || !files.length){
        EX.h('p', { 'class': 'fxc-plain' }, li, s.made_edit ? 'Only compiled cache files changed.' : 'The coach changed no code in this round.');
        return li;
      }
      var roles = {}; files.forEach(function(f){ roles[f.role] = true; });
      EX.h('p', { 'class': 'fxc-plain' }, li, roles.coach && roles.player ? 'The coach changed both the player’s code and its own (coach) code.' :
        roles.coach ? 'The coach changed only its own (coach) code; the player stayed the same.' : roles.player ? 'The coach changed the player’s code.' : 'The coach changed only other files; the player stayed the same.');
      var ul = EX.h('ul', { 'class': 'fxc-files' }, li);
      files.forEach(function(f){
        var r = EX.h('li', null, ul);
        EX.h('code', { 'class': 'p' }, r, f.path);
        if(ROLE_TEXT[f.role]) EX.h('span', { 'class': 'role' }, r, ROLE_TEXT[f.role]);
        EX.h('span', { 'class': 'add' }, r, '+' + f.added);
        EX.h('span', { 'class': 'del' }, r, F.MINUS + f.removed);
      });
      if(rec.diff){
        var det = EX.h('details', { 'class': 'more fxc-diff' }, li);
        EX.h('summary', null, det, 'Show code change');
        var built = false;
        det.addEventListener('toggle', function(){
          if(!det.open || built) return; built = true;
          var pre = EX.h('pre', { 'class': 'code diff wrap fxc-pre tall', tabindex: '0', 'aria-label': 'Code change' }, det);
          rec.diff.split('\n').forEach(function(l){
            var cls = /^(diff |index |\+\+\+|---|new file|deleted file|similarity|rename|Binary)/.test(l) ? 'meta' : /^@@/.test(l) ? 'hunk' : /^\+/.test(l) ? 'add' : /^-/.test(l) ? 'del' : '';
            EX.h('span', { 'class': 'ln' + (cls ? ' ' + cls : '') }, pre, l || ' ');
          });
          if(rec.diff_note) EX.h('p', { 'class': 'fxc-sub' }, det, rec.diff_note);
        });
      }
      return li;
    }
    function outcomeItem(tl, s){
      var li = EX.h('li', { 'class': 'fxc-step k-outcome' }, tl);
      marker(li, 'd-out');
      var lab = EX.h('div', { 'class': 'fxc-label' }, li, 'Outcome ');
      outcomeChip(lab, s);
      EX.h('p', { 'class': 'fxc-plain' }, li, outcomeSentence(s));
      var g = s.gained || [], l = s.lost || [];
      if(!g.length && !l.length){ treeBtn(); return li; }
      function treeBtn(){
        if(s.in_trees && !s.aborted && D.trees[s.run]){
          var acts = EX.h('div', { 'class': 'fxc-acts' }, li);
          var bt = EX.h('button', { type: 'button', 'class': 'btn small' }, acts, 'Show in tree');
          bt.addEventListener('click', function(){
            EX.hash.set('tree', { run: s.run, node: String(s.node) }, { replace: false });
            if(EX.explore && EX.explore.open) EX.explore.open('tree', { scroll: true });
            EX.select('node', { run: s.run, node: String(s.node), source: NAME });
          });
        }
      }
      var prev = null;
      function chips(title, ids, cls){
        if(!ids.length) return;
        var row = EX.h('div', { 'class': 'fxc-chiprow' }, li);
        EX.h('span', { 'class': 'fxc-chiplab' }, row, title + ' (' + ids.length + ')');
        var wrap = EX.h('span', { 'class': 'fxc-chips', role: 'group', 'aria-label': title }, row);
        ids.forEach(function(id){
          var b = EX.h('button', { type: 'button', 'class': 'fxc-chip ' + cls, 'aria-pressed': 'false', 'aria-label': 'Puzzle ' + id }, wrap, id);
          b.addEventListener('click', function(){ showPuzzle(id, b); });
        });
      }
      chips('Puzzles gained', g, 'up');
      chips('Puzzles lost', l, 'down');
      var pv = EX.h('div', { 'class': 'fxc-puz', 'aria-live': 'polite' }, li);
      EX.h('p', { 'class': 'fxc-sub' }, li, 'A puzzle counts as gained when its practice score went up, for example from one of its two tests to both.' +
        (s.player_changed === false ? ' With the player unchanged, these differences come from scoring it again.' : ''));
      treeBtn();
      function showPuzzle(id, b){
        var same = b.getAttribute('aria-pressed') === 'true';
        Array.prototype.forEach.call(li.querySelectorAll('.fxc-chip'), function(x){ x.setAttribute('aria-pressed', 'false'); });
        pv.innerHTML = ''; prev = null;
        if(same) return;
        prev = b; b.setAttribute('aria-pressed', 'true');
        var t = D.tasks[id];
        if(!t){ EX.h('p', { 'class': 'fxc-sub' }, pv, 'Puzzle ' + id + ' (no picture saved for this one).'); return; }
        var n = Math.min(2, (t.train || []).length);
        EX.h('p', { 'class': 'fxc-sub' }, pv, 'Puzzle ' + id + ': ' + (n > 1 ? 'the first two of its ' + t.train.length + ' examples' : 'its first example') + ' (input → output).');
        var w = Math.max(56, Math.min(100, Math.floor((ui.cmain.clientWidth - 60) / (n > 1 && ui.cmain.clientWidth > 560 ? 4 : 2))));
        var row = EX.h('div', { 'class': 'fxc-puzrow' }, pv);
        for(var i = 0; i < n; i++) EX.arcPair(row, t.train[i].input, t.train[i].output, { maxSize: w, labels: ['Example ' + (i + 1), null] });
        var px = D.allPlayer.filter(function(q){ return q.task === id && q.run === s.run && q.k !== 'solved' && q.segments && q.segments.length; });
        var acts = EX.h('div', { 'class': 'fxc-acts' }, pv);
        if(px.length){
          var pick = px.filter(function(q){ return String(q.node) === String(s.node); })[0] ||
            px.filter(function(q){ return String(q.node) === String(s.parent); })[0] || px[0];
          var rb = EX.h('button', { type: 'button', 'class': 'btn small' }, acts, 'Read the player’s failed attempt (' + genText(pick.generation).toLowerCase() + ')');
          rb.addEventListener('click', function(){
            st.cur.player = pick;
            st.view = 'single'; st.runF = 'all'; st.kindF = 'all';
            setTab('player', true);
          });
        } else EX.h('span', { 'class': 'fxc-sub' }, acts, 'No player transcript was saved for this puzzle in this run.');
        EX.select('task', { task: id, set: t.set, source: NAME });
      }
      return li;
    }
    function outcomeSentence(s){
      var a = s.practice_before, b = s.practice_after, k = s.outcome_kind;
      if(k === 'no edit') return s.aborted ? 'No code changed in this attempt, and it was not scored.' : 'No code changed, so the player stayed as it was.';
      if(k === 'not scored') return s.aborted ? 'The harness was stopped while scoring this attempt, so the edit has no score.' : 'This edit was not scored.';
      if(k === 'broke') return b === 0 ? 'The edited player broke: it scored 0% on practice puzzles' + (a != null ? ' (it had ' + F.pct(a, 0) + ').' : '.') : 'The edited player broke and could not be scored.';
      if(a == null || b == null) return 'Practice score: ' + F.pct(b, 0) + '.';
      var d = Math.round((b - a) * 100), t;
      if(k === 'same' || d === 0) t = 'The practice score stayed at ' + F.pct(b, 0) + '.';
      else t = 'The practice score ' + (d > 0 ? 'rose' : 'fell') + ' from ' + F.pct(a, 0) + ' to ' + F.pct(b, 0) + ' (' + (d > 0 ? '+' : F.MINUS) + Math.abs(d) + ' points).';
      if(s.player_changed === false) t += ' The player itself was not changed, so ' + (d === 0 ? 'this' : 'the change') + ' only reflects scoring the same player again (run-to-run noise).';
      if(s.valid === false && s.in_trees) t += ' The harness marked this version invalid, so later rounds could not start from it.';
      return t;
    }

    /* ======================= TURNS ======================= */
    function buildTurns(T, segs, isCoach, truth){
      if(st.step){
        var bar = EX.h('div', { 'class': 'fxt-bar', role: 'group', 'aria-label': 'Step through turns' }, T);
        ui.prev = EX.h('button', { type: 'button', 'class': 'btn' }, bar, '‹ Prev');
        ui.next = EX.h('button', { type: 'button', 'class': 'btn' }, bar, 'Next ›');
        ui.pos = EX.h('span', { 'class': 'fxt-pos' }, bar);
        ui.prev.addEventListener('click', function(){ stepBy(-1); });
        ui.next.addEventListener('click', function(){ stepBy(1); });
      }
      var box = EX.h('div', { 'class': 'fxt-tx', tabindex: '0', role: 'region', 'aria-label': (isCoach ? 'Coach' : 'Player') + ' transcript' }, T);
      ui.box = box; ui.turns = [];
      segs.forEach(function(sg){
        var role = sg.role || 'Turn';
        var text = isCoach ? decodeRepr(sg.text) : (sg.text || '');
        var t = { role: role, model: MODEL_ROLES.test(role) };
        if(role === 'Elided'){ t.el = EX.h('div', { 'class': 'turn t-elided' }, box, text.replace(/^\[|\]$/g, '') || 'turns elided'); ui.turns.push(t); return; }
        t.el = EX.h('div', { 'class': 'turn' + (t.model ? ' r-model' : '') + (role === 'Error' ? ' r-error' : '') }, box);
        EX.h('div', { 'class': 'turn-role' }, t.el, roleLabel(role, isCoach));
        var pre = EX.h('pre', { 'class': 'code wrap' }, t.el);
        if(text.trim()) fillText(pre, text); else EX.h('span', { 'class': 'elide' }, pre, '(empty response)');
        if(text.length > 400 || text.split('\n').length > 8){
          var xb = EX.h('button', { type: 'button', 'class': 'xbtn', 'aria-expanded': 'false' }, t.el, 'Expand');
          xb.addEventListener('click', function(){
            var open = t.el.classList.toggle('is-open');
            xb.setAttribute('aria-expanded', String(open)); xb.textContent = open ? 'Collapse' : 'Expand';
          });
        }
        if(!isCoach && t.model){
          var g = parseAnswer(text);
          if(g){
            var inl = EX.h('div', { 'class': 'inl' }, t.el);
            var ok = truth && EX.gridsEqual(g, truth);
            EX.arcGrid(inl, g, { maxSize: 84, diffAgainst: truth, title: 'Answer in this turn',
              label: 'answer in this turn <span class="' + (ok ? 'ok' : 'no') + '">' + (ok ? '✓' : '× ' + EX.esc(diffText(g, truth))) + '</span>' });
          }
        }
        ui.turns.push(t);
      });
      if(st.step){ st.cursor = Math.min(st.cursor, ui.turns.length - 1); applyCursor(); }
    }
    function roleLabel(role, isCoach){
      if(!isCoach){
        return { 'Input': 'Prompt (call 1)', 'Output': 'Model answer (call 1)', 'Refinement input': 'Refine prompt (call 2)', 'Refinement output': 'Model answer (call 2)',
          'Verification input': 'Verify prompt (call 2)', 'Verification output': 'Model answer (call 2)', 'Error': 'Error' }[role] || role;
      }
      return { 'Input': 'Task given to the coach', 'Output': 'Coach', 'Tool output': 'Tool output', 'Nudge': 'Harness nudge' }[role] || role;
    }
    function applyCursor(scroll){
      var n = ui.turns.length, c = st.cursor;
      ui.turns.forEach(function(t, i){ t.el.hidden = i > c; t.el.classList.toggle('is-cur', i === c); });
      ui.pos.textContent = 'Turn ' + (c + 1) + ' of ' + n;
      ui.prev.disabled = c <= 0; ui.next.disabled = c >= n - 1;
      var el = ui.turns[c] && ui.turns[c].el, box = ui.box;
      void box;
      if(scroll && el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: EX.reduceMotion ? 'auto' : 'smooth' });
    }
    function stepBy(d){
      if(!ui.turns || !ui.turns.length || !st.step) return;
      st.cursor = Math.max(0, Math.min(ui.turns.length - 1, st.cursor + d));
      applyCursor(true);
      var t = ui.turns[st.cursor];
      if(ui.live) ui.live.textContent = 'Turn ' + (st.cursor + 1) + ' of ' + ui.turns.length + ': ' + roleLabel(t.role, st.tab === 'coach');
    }
  });
})();

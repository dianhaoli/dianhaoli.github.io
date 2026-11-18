/* fig-tree.js — Explore › Evolution trees (mount "tree").
   One self-improvement run at a time (chips Run 1..Run 6) as a PERFORMANCE CHART: x = generation,
   y = practice score. Each saved version is a dot; faint lines join a version to its parent; a dark step
   line is the run's best score so far; an ink ring = the coach changed its own code; a blue diamond =
   a coach that was later frozen and tested. Versions that failed checks sit on a strip under the axis.
   Picking a dot picks ITS COACH (the coach code it carries): every version that coach made turns blue
   and a blue step line shows their best score so far.
   Below, full width: what happened when that coach was frozen and given a fresh player for 8 rounds
   (its test runs in blue, the original coach's six tests in grey, direct labels with exam scores).
   Test runs are not shown on their own: links to them open the coach's source run and version.
   Data: trees.json; coach/index.json (lazy: which versions have a coach transcript).
   Emits: select-run, select-node (user picks), open-transcript (button; also sets EX.pendingTranscript).
   Listens: select-run, select-node (never switches tabs). Hash: #tree?run=…&node=… */
(function(){
  'use strict';

  var F = EX.fmt;
  var SRC_GEN = 12;   // gen of the first (I_g) pick; re-read from data

  function gen(n){ return n.generation === 'initial' ? 0 : +n.generation; }
  function pct0(x){ return F.pct(x, 0); }
  function ptsShort(d){ var v = d * 100, dec = Math.abs(v - Math.round(v)) < 1e-6 ? 0 : 1; return F.signed(v, dec); }
  function deltaText(d){ var s = ptsShort(d); return s === '0' || s === '+0' ? 'same as parent' : s + ' vs parent'; }
  function listJoin(a){ return a.length < 2 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function range(a, f){
    if(!a.length) return '—';
    var lo = Math.min.apply(null, a), hi = Math.max.apply(null, a);
    return f(lo) === f(hi) ? f(lo) : f(lo).replace('%', '') + '–' + f(hi);
  }
  function stepD(pts, X, Y){
    var d = '', prev = null;
    pts.forEach(function(p, i){ if(!i) d = 'M' + X(p.g) + ',' + Y(p.v); else { d += 'H' + X(p.g); if(p.v !== prev) d += 'V' + Y(p.v); } prev = p.v; });
    return d;
  }
  function textW(s){ return s.length * 7 + 4; }   // 13px sans, rough

  EX.mount('tree', function(node, ctx){
    return EX.load('trees').then(function(TR){
      var T = TR.trees;
      var runs = TR.runs.filter(function(r){ return T[r]; });
      var sourceRuns = runs.filter(function(r){ return T[r].kind === 'source'; });
      var testRuns = runs.filter(function(r){ return T[r].kind !== 'source'; });
      var I0runs = testRuns.filter(function(r){ return T[r].kind === 'payoff_I0'; });
      SRC_GEN = (T[sourceRuns[0]] && T[sourceRuns[0]].max_generation_committed) || SRC_GEN;
      runs.forEach(function(r){ T[r].nodes.forEach(function(n){ n.__run = r; }); });

      /* ---------- per-run indexes ---------- */
      function scored(n){ return n.valid && n.practice_score != null; }
      var IDX = {};
      runs.forEach(function(r){
        var t = T[r], by = {}, kids = {}, owner = {}, made = {};
        t.nodes.forEach(function(n){ by[n.id] = n; });
        var order = t.nodes.slice().sort(function(a, b){ return gen(a) - gen(b) || (+a.id || 0) - (+b.id || 0); });
        order.forEach(function(n){ if(n.parent && by[n.parent]) (kids[n.parent] = kids[n.parent] || []).push(n.id); });
        // whose coach code each version carries: itself if it changed the coach (or is the start), else its parent's
        order.forEach(function(n){ owner[n.id] = (n.id === 'initial' || n.touched_coach || !by[n.parent]) ? n.id : owner[n.parent]; });
        // the versions each coach made (a parent's coach makes the child)
        order.forEach(function(n){ if(n.parent && by[n.parent]){ var o = owner[n.parent]; (made[o] = made[o] || []).push(n.id); } });
        var best = [], b = null;
        for(var g = 0; g <= t.max_generation; g++){
          order.forEach(function(n){ if(gen(n) === g && scored(n) && (b == null || n.practice_score > b)) b = n.practice_score; });
          best.push(b);
        }
        IDX[r] = { by: by, order: order, kids: kids, best: best, owner: owner, made: made };
      });
      function runNo(r){ var m = /s(\d)/.exec(r) || /_(\d)$/.exec(r); return m ? m[1] : r; }
      function bestOf(r){ var b = IDX[r].best; return b[b.length - 1]; }
      function examOf(r){ return T[r].final && T[r].final.heldout; }

      /* the coach a version carries, the versions it made, their best score so far by generation */
      function coachInfo(run, id){
        var idx = IDX[run], o = idx.owner[id], on = idx.by[o], ids = idx.made[o] || [];
        var start = scored(on) ? on.practice_score : null, b = start, pts = [], last = gen(on);
        ids.forEach(function(k){ last = Math.max(last, gen(idx.by[k])); });
        for(var g = gen(on); g <= last; g++){
          ids.forEach(function(k){ var n = idx.by[k]; if(gen(n) === g && scored(n) && (b == null || n.practice_score > b)) b = n.practice_score; });
          if(b != null) pts.push({ g: g, v: b });
        }
        var top = pts.length ? pts[pts.length - 1].v : null, topG = null;
        pts.forEach(function(p){ if(topG == null && p.v === top) topG = p.g; });
        var gens = ids.map(function(k){ return gen(idx.by[k]); });
        var anyOk = ids.some(function(k){ return scored(idx.by[k]); });
        return { o: o, on: on, ids: ids, pts: pts, start: start, top: top, topG: topG, anyOk: anyOk, climbed: anyOk && top != null && (start == null || top > start),
          g0: gens.length ? Math.min.apply(null, gens) : null, g1: gens.length ? Math.max.apply(null, gens) : null };
      }

      /* ---------- tested coaches: source run:node -> [test runs] ---------- */
      var TESTS = {};
      testRuns.forEach(function(r){
        var o = T[r].coach_origin || {};
        if(o.source_run) (TESTS[o.source_run + ':' + o.source_node] = TESTS[o.source_run + ':' + o.source_node] || []).push(r);
      });
      function testsOf(run, id){ return id === 'initial' ? I0runs.slice() : (TESTS[run + ':' + id] || []); }
      function isTested(run, id){ return id !== 'initial' && !!TESTS[run + ':' + id]; }
      function pickGen(r){ var g = EX.runGroup(r); return g === 'Ig' ? SRC_GEN : +String(g).replace('g', ''); }
      function isFallback(r){ var rule = (T[r].coach_origin || {}).rule || ''; return /most descendants/.test(rule) && !/max mean/.test(rule); }
      function testedCoaches(run){ return IDX[run].order.filter(function(n){ return isTested(run, n.id); }); }

      /* ---------- chip notes (data-derived) ---------- */
      function chipNote(r){
        var t = T[r], nCoach = t.nodes.filter(function(n){ return n.touched_coach; }).length;
        var tc = testedCoaches(r), hasFirst = tc.some(function(n){ return testsOf(r, n.id).some(function(x){ return pickGen(x) === SRC_GEN; }); });
        var s = t.max_generation + ' generations · the coach changed its own code in ' + nCoach + ' of them · ';
        if(!tc.length) s += 'none of its coaches was tested';
        else if(!hasFirst) s += 'no coach qualified for testing at gen ' + SRC_GEN + '; ' + (tc.length === 1 ? 'one coach' : tc.length + ' coaches') + ' picked later ' + (tc.length === 1 ? 'was' : 'were') + ' tested';
        else s += tc.length === 1 ? 'its coach was tested' : tc.length + ' of its coaches were tested';
        return s;
      }

      /* ---------- words ---------- */
      function nodeName(n){ return n.id === 'initial' ? 'Starting version' : 'Version ' + n.id; }
      function changedText(n){
        if(n.id === 'initial') return 'nothing (the starting code)';
        var s = n.touched_coach && n.touched_player ? 'player and coach code' : n.touched_coach ? 'coach code' : n.touched_player ? 'player code' : null;
        if(!n.valid) return s ? s + ' (but it failed checks)' : 'nothing saved (the edit failed checks)';
        return s || 'no code change';
      }
      function scoreText(n){
        if(scored(n)) return null;
        return n.practice_score != null ? 'rejected: failed checks (had scored ' + pct0(n.practice_score) + ')' : 'failed checks, not scored';
      }
      function parentDelta(n){
        var p = IDX[n.__run].by[n.parent];
        return (n.id !== 'initial' && p && scored(p) && scored(n)) ? n.practice_score - p.practice_score : null;
      }

      /* ---------- transcripts (lazy) ---------- */
      var TX = null, txReady = false;
      EX.load('coach/index').then(function(X){
        TX = {}; (X.sessions || []).forEach(function(c){ TX[c.run + ':' + c.node] = c; });
        txReady = true; renderSide();
      }, function(){});

      /* ---------- state + resolving links to test runs ---------- */
      function defaultNode(run){ var tc = testedCoaches(run)[0]; return tc ? tc.id : 'initial'; }
      // any run/node -> a self-improvement run + version (+ which test to emphasise)
      function resolve(run, nodeId){
        if(!T[run]) return null;
        if(T[run].kind === 'source') return { run: run, node: nodeId && IDX[run].by[nodeId] ? String(nodeId) : defaultNode(run), test: null };
        var o = T[run].coach_origin || {};
        if(o.source_run && T[o.source_run]) return { run: o.source_run, node: String(o.source_node), test: run };
        return { run: sourceRuns[0], node: 'initial', test: run };   // original coach: its tests sit on the starting version
      }
      var st = { run: sourceRuns[0], node: null, test: null, diffOpen: false };
      (function(){
        var h = EX.hash.get(), r = null;
        if(h.section === 'tree' && h.params.run) r = resolve(h.params.run, h.params.node);
        else if(EX.state && EX.state.run && EX.state.node && T[EX.state.run] && IDX[EX.state.run].by[EX.state.node]) r = resolve(EX.state.run, EX.state.node);
        if(r){ st.run = r.run; st.node = r.node; st.test = r.test; } else st.node = defaultNode(st.run);
      })();

      /* ---------- skeleton ---------- */
      node.innerHTML = '';
      var root = EX.h('div', { 'class': 'fx-tree' }, node);
      EX.h('p', { 'class': 'fxt-intro' }, root, 'Six independent tries of the same self-improvement loop. Each started from the same coach and player, and each evolved differently. All six ran 12 generations; runs 1 to 4 were then extended to 40, as planned in the follow-up design (fixed before any follow-up result).');
      var chipRow = EX.h('div', { 'class': 'fxt-chips', role: 'group', 'aria-label': 'Self-improvement run' }, root);
      var chipNoteEl = EX.h('p', { 'class': 'fxt-chipnote', 'aria-live': 'polite' }, root);
      var chips = {};
      sourceRuns.forEach(function(r, i){
        var b = EX.h('button', { type: 'button', 'class': 'fxt-chip', 'aria-pressed': 'false', tabindex: -1, title: 'Run ' + runNo(r) + ': ' + chipNote(r), 'data-run': r }, chipRow);
        EX.h('span', { 'class': 'c-name' }, b, 'Run ' + runNo(r));
        EX.h('span', { 'class': 'c-sub' }, b, T[r].max_generation + ' gens');
        b.addEventListener('click', function(){ openRun(r, null, true); });
        b.addEventListener('mouseenter', function(){ showChipNote(r); });
        b.addEventListener('mouseleave', function(){ showChipNote(st.run); });
        b.addEventListener('focus', function(){ showChipNote(r); });
        b.addEventListener('blur', function(){ showChipNote(st.run); });
        b.addEventListener('keydown', function(e){
          var j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: sourceRuns.length - 1 }[e.key];
          if(j == null) return;
          e.preventDefault();
          j = (j + sourceRuns.length) % sourceRuns.length;
          openRun(sourceRuns[j], null, true); chips[sourceRuns[j]].focus();
        });
        chips[r] = b;
      });
      function showChipNote(r){ chipNoteEl.textContent = 'Run ' + runNo(r) + ': ' + chipNote(r) + '.'; }

      var main = EX.h('div', { 'class': 'fxt-main' }, root);
      var left = EX.h('div', { 'class': 'fxt-left' }, main);
      var chartBox = EX.h('div', { 'class': 'fxt-chart' }, left);
      var legend = EX.h('p', { 'class': 'fxt-legend' }, left);
      (function(){
        var svg = EX.s('svg', { width: 18, height: 16, viewBox: '-9 -8 18 16', 'aria-hidden': 'true' }, legend);
        EX.s('circle', { 'class': 'k-dot', r: 3.5 }, svg); EX.s('circle', { 'class': 'k-ring', r: 6.5 }, svg);
        EX.h('span', null, legend, 'ring = the coach changed its own code. Pick any dot to follow its coach.');
      })();
      var side = EX.h('aside', { 'class': 'side-panel fxt-side', 'aria-label': 'Picked version', 'aria-live': 'polite' }, main);
      var diffBox = EX.h('div', { 'class': 'fxt-diffbox', hidden: '' }, root);
      var diffId = EX.uid('fxt-diff'); diffBox.id = diffId;
      var testSec = EX.h('section', { 'class': 'fxt-test', 'aria-label': 'Tested coach' }, root);

      var svgMain = null, nodeEls = {}, edgeEls = {}, famPath = null, famLab = null, bestLab = null, CH = null;

      /* ---------- main chart ---------- */
      function drawChart(){
        var run = st.run, t = T[run], idx = IDX[run];
        chartBox.innerHTML = ''; nodeEls = {}; edgeEls = {};
        var W = Math.max(280, Math.floor(chartBox.clientWidth || 600)), narrow = W < 520;
        var maxG = Math.max.apply(null, sourceRuns.map(function(r){ return T[r].max_generation; }));   // same x for every run
        var lo = 0.5;
        var m = { l: 44, r: narrow ? 8 : 16 };
        var plotTop = 34, plotH = narrow ? 230 : 320, plotB = plotTop + plotH;
        var stripY = plotB + 20, tickY = stripY + 30, H = tickY + 22;
        var X = function(g){ return m.l + g / maxG * (W - m.l - m.r); };
        var Y = function(v){ return plotB - (v - lo) / (1 - lo) * plotH; };
        CH = { X: X, Y: Y, W: W, m: m, plotTop: plotTop };
        var svg = svgMain = EX.s('svg', { 'class': 'fxt-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'group',
          'aria-label': 'Practice score by generation in run ' + runNo(run) + ', ' + t.nodes.length + ' versions. Tab here, then arrow keys move between versions, up goes to the parent, Enter picks, Escape clears.' }, chartBox);
        var ax = EX.s('g', { 'class': 'axis', 'aria-hidden': 'true' }, svg);
        [0.5, 0.75, 1].forEach(function(v){
          EX.s('line', { 'class': 'gridline', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, ax);
          EX.s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, ax, Math.round(v * 100) + '%');
        });
        EX.s('text', { 'class': 'axt', x: 0, y: plotTop - 22 }, ax, 'Practice score');
        var stepT = narrow ? 10 : 5;
        for(var g = 0; g <= maxG; g += stepT) EX.s('text', { x: X(g), y: tickY, 'text-anchor': 'middle' }, ax, String(g));
        EX.s('text', { 'class': 'axt', x: W - m.r, y: H - 2, 'text-anchor': 'end' }, ax, 'Generation');
        if(t.max_generation < maxG){
          EX.s('rect', { 'class': 'nodata', x: X(t.max_generation) + 10, y: plotTop, width: X(maxG) - X(t.max_generation) - 10, height: plotH }, ax);
          EX.s('text', { 'class': 'axt', x: (X(t.max_generation) + X(maxG)) / 2 + 5, y: Y(0.625), 'text-anchor': 'middle' }, ax, 'run ' + runNo(run) + ' was not extended past gen ' + t.max_generation);
        }
        // failed-checks strip
        EX.s('line', { 'class': 'strip', x1: m.l, x2: X(t.max_generation), y1: stripY, y2: stripY }, ax);
        EX.s('text', { 'class': 'axt', x: m.l - 8, y: stripY + 4, 'text-anchor': 'end' }, ax, 'failed');
        EX.s('text', { 'class': 'axt', x: m.l - 8, y: stripY + 18, 'text-anchor': 'end' }, ax, 'checks');

        var P = {};
        idx.order.forEach(function(n){ var ok = scored(n); P[n.id] = { x: X(gen(n)), y: ok ? Y(n.practice_score) : stripY, ok: ok }; });
        var eg = EX.s('g', { 'aria-hidden': 'true' }, svg);
        idx.order.forEach(function(n){
          if(!n.parent || !P[n.parent] || !P[n.id].ok || !P[n.parent].ok) return;
          var p = P[n.parent], c = P[n.id];
          edgeEls[n.id] = EX.s('line', { 'class': 'e', x1: p.x, y1: p.y, x2: c.x, y2: c.y }, eg);
        });
        // best so far in the whole run
        var pts = idx.best.map(function(b, gi){ return { g: gi, v: b }; }).filter(function(p){ return p.v != null; });
        EX.s('path', { 'class': 'best', d: stepD(pts, X, Y), 'aria-hidden': 'true' }, svg);
        var last = pts[pts.length - 1];
        bestLab = EX.s('text', { 'class': 'best-t halo', x: X(last.g), y: Y(last.v) - 7, 'text-anchor': 'end', 'aria-hidden': 'true' }, svg, 'best in this run ' + pct0(last.v));
        famPath = EX.s('path', { 'class': 'fam', d: '', 'aria-hidden': 'true' }, svg);
        famLab = EX.s('text', { 'class': 'fam-t halo', 'aria-hidden': 'true' }, svg);
        // dots
        var ng = EX.s('g', null, svg);
        idx.order.forEach(function(n){
          var p = P[n.id], tested = isTested(run, n.id);
          var gg = EX.s('g', { 'class': 'nd' + (p.ok ? '' : ' ns'), transform: 'translate(' + p.x + ',' + p.y + ')', tabindex: -1,
            role: 'button', 'aria-label': ariaFor(n), 'data-id': n.id }, ng);
          EX.s('circle', { 'class': 'hit', r: narrow ? 8 : 10 }, gg);
          if(n.touched_coach) EX.s('circle', { 'class': 'ring', r: p.ok ? (tested ? 9 : 7.5) : 6 }, gg);
          if(!p.ok) EX.s('circle', { 'class': 'dot hollow', r: 3 }, gg);
          else if(tested) EX.s('path', { 'class': 'dot dia', d: 'M0,-6L6,0L0,6L-6,0Z' }, gg);
          else EX.s('circle', { 'class': 'dot', r: 4 }, gg);
          EX.s('circle', { 'class': 'selring', r: p.ok ? (n.touched_coach ? 12.5 : 10) : 9 }, gg);
          gg.addEventListener('mouseenter', function(e){ hover(n.id, e); });
          gg.addEventListener('mousemove', function(e){ EX.tooltip.move(e); });
          gg.addEventListener('mouseleave', function(){ hover(null); });
          gg.addEventListener('click', function(){ hover(null); selectNode(n.id, true); });
          gg.addEventListener('focus', function(){ hover(n.id, gg); });
          gg.addEventListener('blur', function(){ hover(null); });
          nodeEls[n.id] = gg;
        });
        // "tested coach": a direct label beside each diamond (drawn over the dots, under nothing)
        var lg = EX.s('g', { 'aria-hidden': 'true' }, svg);
        testedCoaches(run).forEach(function(n){
          var p = P[n.id], tw = textW('tested coach'), rightSide = p.x + 12 + tw <= W;
          EX.s('text', { 'class': 'pk-t halo', x: rightSide ? p.x + 12 : p.x - 12, y: p.y + 18, 'text-anchor': rightSide ? 'start' : 'end' }, lg, 'tested coach');
        });
        svg.addEventListener('keydown', onKey);
        markSel();
      }
      function ariaFor(n){
        var s = nodeName(n) + ', generation ' + gen(n) + ', ' + (scored(n) ? 'practice score ' + pct0(n.practice_score) : scoreText(n));
        if(n.touched_coach) s += ', the coach changed its own code';
        if(isTested(n.__run, n.id)) s += ', tested coach';
        return s;
      }
      function tipHTML(n){
        var s = '<b>' + EX.esc(nodeName(n)) + (n.id === 'initial' ? '' : ', generation ' + gen(n)) + '</b><br>';
        if(scored(n)){ var dd = parentDelta(n); s += 'Practice score ' + pct0(n.practice_score) + (dd != null ? ' (' + deltaText(dd) + ')' : ''); }
        else s += EX.esc(scoreText(n));
        s += '<br>Changed: ' + EX.esc(changedText(n));
        if(isTested(n.__run, n.id)) s += '<br>This coach was later frozen and tested';
        return s;
      }
      function hover(id, evt){
        Object.keys(nodeEls).forEach(function(k){ nodeEls[k].classList.toggle('hov', k === id); });
        if(!id){ EX.tooltip.hide(); return; }
        if(evt) EX.tooltip.show(tipHTML(IDX[st.run].by[id]), evt);
      }
      function markSel(){
        if(!svgMain) return;
        var on = {}, d = '';
        famLab.textContent = '';
        bestLab.setAttribute('class', 'best-t halo');
        bestLab.textContent = bestLab.__t || (bestLab.__t = bestLab.textContent);
        if(st.node){
          var ci = coachInfo(st.run, st.node);
          on[ci.o] = true; ci.ids.forEach(function(k){ on[k] = true; });
          if(ci.climbed) d = stepD(ci.pts, CH.X, CH.Y);   // a line only when the coach's versions beat its start
          if(d){
            var lp = ci.pts[ci.pts.length - 1], runBest = bestOf(st.run);
            if(lp.v === runBest){
              // the coach reached the run's best: one label says both
              bestLab.textContent = 'best in this run ' + pct0(runBest) + ', with this coach';
              bestLab.setAttribute('class', 'best-t fam-t halo');
            } else {
              var txt = 'best with this coach ' + pct0(lp.v), tw = textW(txt);
              var xe = CH.X(lp.g), x0 = xe - tw, y = CH.Y(lp.v) - 7;
              if(x0 < CH.X(ci.pts[0].g) + 16) x0 = Math.min(xe + 8, CH.W - tw), y = CH.Y(lp.v) + 4;   // short line: label after its end
              var bx = +bestLab.getAttribute('x'), by = +bestLab.getAttribute('y'), bw = textW(bestLab.textContent);
              if(Math.abs(by - y) < 15 && x0 < bx && x0 + tw > bx - bw) y = CH.Y(lp.v) + 17;
              famLab.setAttribute('x', x0); famLab.setAttribute('y', y);
              famLab.textContent = txt;
            }
          }
        }
        svgMain.classList.toggle('has-sel', !!st.node);
        var stop = st.node && nodeEls[st.node] ? st.node : 'initial';
        Object.keys(nodeEls).forEach(function(k){
          nodeEls[k].classList.toggle('sel', k === st.node);
          nodeEls[k].classList.toggle('on', !!on[k]);
          nodeEls[k].setAttribute('tabindex', k === stop ? 0 : -1);
          nodeEls[k].setAttribute('aria-pressed', String(k === st.node));
        });
        var by2 = IDX[st.run].by;
        Object.keys(edgeEls).forEach(function(k){ edgeEls[k].classList.toggle('on', !!on[k] && !!on[by2[k].parent]); });
        famPath.setAttribute('d', d);
      }
      function onKey(e){
        var idx = IDX[st.run];
        var curId = (document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-id')) || st.node || 'initial';
        var cur = idx.by[curId]; if(!cur) return;
        var i = idx.order.indexOf(cur), next = null;
        if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); selectNode(cur.id, true); return; }
        if(e.key === 'Escape'){ selectNode(null, true); return; }
        if(e.key === 'ArrowLeft') next = i > 0 ? idx.order[i - 1].id : null;
        else if(e.key === 'ArrowRight') next = i < idx.order.length - 1 ? idx.order[i + 1].id : null;
        else if(e.key === 'ArrowUp') next = cur.parent && idx.by[cur.parent] ? cur.parent : null;
        else if(e.key === 'ArrowDown'){ var k = idx.kids[cur.id]; next = k && k.length ? k[0] : null; }
        else if(e.key === 'Home') next = idx.order[0].id;
        else if(e.key === 'End') next = idx.order[idx.order.length - 1].id;
        else return;
        e.preventDefault();
        if(next && nodeEls[next]){ selectNode(next, true); nodeEls[next].focus(); }
      }

      /* ---------- side panel: max 4 facts + two buttons ---------- */
      function renderSide(){
        var run = st.run, t = T[run], by = IDX[run].by, n = st.node ? by[st.node] : null;
        side.innerHTML = '';
        if(!n){
          EX.h('h4', null, side, 'Run ' + runNo(run));
          var kv0 = EX.h('table', { 'class': 'kv' }, side), tb0 = EX.h('tbody', null, kv0);
          [['Saved versions', String(t.nodes.length)], ['Best practice score', pct0(bestOf(run))]].forEach(function(r){
            var tr = EX.h('tr', null, tb0); EX.h('th', { scope: 'row' }, tr, r[0]); EX.h('td', null, tr, r[1]);
          });
          EX.h('p', { 'class': 'fxt-hint' }, side, 'Pick a dot to see how its coach did.');
          return;
        }
        var hd = EX.h('h4', null, side, nodeName(n));
        if(isTested(run, n.id)) EX.h('span', { 'class': 'tag acc' }, hd, 'tested coach');
        var kv = EX.h('table', { 'class': 'kv' }, side), tb = EX.h('tbody', null, kv);
        function row(k, v){ var tr = EX.h('tr', null, tb); EX.h('th', { scope: 'row' }, tr, k); EX.h('td', null, tr, v); }
        var p = by[n.parent], dd = parentDelta(n);
        row('Made at', n.id === 'initial' ? 'generation 0 (start)' : 'generation ' + gen(n) + ', from ' + (p ? nodeName(p).toLowerCase() : '—'));
        row('Practice score', scored(n) ? pct0(n.practice_score) + (dd != null ? ' (' + deltaText(dd) + ')' : '') : scoreText(n));
        row('What changed', changedText(n));
        // fact 4: its coach, in one sentence
        var ci = coachInfo(run, n.id);
        var who = ci.o === 'initial' ? (n.id === 'initial' ? 'Its coach is the original coach.' : 'Its coach is the original, unchanged coach.')
          : ci.o === n.id ? 'Its coach is new: the coach changed itself here.'
          : 'Its coach came from version ' + ci.o + ' (generation ' + gen(ci.on) + ').';
        var did;
        if(!ci.ids.length) did = ' Nothing was built on it.';
        else {
          var span = ci.g0 === ci.g1 ? 'at generation ' + ci.g0 : 'between generations ' + ci.g0 + ' and ' + ci.g1;
          var nv = ci.ids.length === 1 ? '1 version (blue)' : ci.ids.length + ' versions (blue)';
          did = ' It made ' + nv + ' ' + span + '; ' + (!ci.anyOk ? (ci.ids.length > 1 ? 'none passed the checks.' : 'it failed the checks.')
            : ci.start == null ? 'their best score reached ' + pct0(ci.top) + '.'
            : ci.top > ci.start ? 'their best score climbed from ' + pct0(ci.start) + ' to ' + pct0(ci.top) + ' (by gen ' + ci.topG + ').'
            : 'none beat its own ' + pct0(ci.start) + '.');
        }
        EX.h('p', { 'class': 'fxt-coachsum' }, side, who + did);
        var acts = EX.h('div', { 'class': 'fxt-acts' }, side);
        if(n.diff){
          var db = EX.h('button', { type: 'button', 'class': 'btn small', 'aria-expanded': String(st.diffOpen), 'aria-controls': diffId }, acts, st.diffOpen ? 'Hide code change' : 'Show code change');
          db.addEventListener('click', function(){
            st.diffOpen = !st.diffOpen; renderSide(); renderDiff();
            if(st.diffOpen) diffBox.scrollIntoView({ behavior: EX.reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
            var again = side.querySelector('[aria-controls="' + diffId + '"]'); if(again) again.focus();
          });
        }
        if(txReady && TX[run + ':' + n.id]){
          var btn = EX.h('button', { type: 'button', 'class': 'btn small' }, acts, 'Read coach transcript');
          btn.addEventListener('click', function(){
            var req = { run: run, node: n.id, source: 'tree' };
            EX.pendingTranscript = req;
            EX.select('node', req);
            if(EX.explore && EX.explore.open) EX.explore.open('transcripts', { scroll: true });
            EX.emit('open-transcript', req);
          });
        }
        if(!acts.firstChild) acts.remove();
      }

      /* ---------- full width: the picked coach, frozen, with a fresh player ---------- */
      function bestSeries(r){ return IDX[r].best.map(function(v, i){ return { g: i, v: v }; }).filter(function(p){ return p.v != null; }); }
      function renderTest(){
        testSec.innerHTML = '';
        var run = st.run, n = st.node ? IDX[run].by[st.node] : null;
        EX.h('div', { 'class': 'fig-sub-title fxt-test-h' }, testSec, 'What happened when we froze this coach and gave a fresh player 8 rounds');
        if(!n){ EX.h('p', { 'class': 'fxt-take muted' }, testSec, 'Pick a dot above to see its coach here.'); return; }
        var ci = coachInfo(run, n.id), orig = ci.o === 'initial';
        var mine = testsOf(run, ci.o);
        if(!mine.length){
          EX.h('p', { 'class': 'fxt-take muted' }, testSec, (ci.o === n.id ? 'This coach' : 'This version’s coach (from version ' + ci.o + ')') +
            ' was never frozen and tested. Only the coaches picked by the rule were tested: the blue diamonds.');
          return;
        }
        mine.sort(function(a, b){ return pickGen(a) - pickGen(b) || (+runNo(a) - +runNo(b)); });
        var cmp = orig ? [] : I0runs;
        var exams = mine.map(examOf), cmpEx = I0runs.map(examOf);
        var take;
        if(orig) take = 'The original coach was tested ' + mine.length + ' times. Its final players scored ' + range(exams, F.pct) +
          ' on the exam (120 new puzzles). Every self-improved coach is compared with this.';
        else {
          var gs = mine.map(pickGen), fb = mine.filter(isFallback).map(pickGen);
          var nf = gs.filter(function(g){ return fb.indexOf(g) < 0; });
          take = 'Made at generation ' + gen(ci.on) + ' and picked ' + [
              nf.length ? 'by the rule at gen ' + listJoin(nf) : '',
              fb.length ? 'by the fallback rule at gen ' + listJoin(fb) + ' (no coach qualified, so it took the one with the most versions built on it)' : ''
            ].filter(Boolean).join(', and ') +
            '. On the exam (120 new puzzles) its final player' + (mine.length > 1 ? 's' : '') + ' scored ' + listJoin(exams.map(function(x){ return F.pct(x); })) +
            '; the original coach’s scored ' + range(cmpEx, F.pct) + '.';
        }
        EX.h('p', { 'class': 'fxt-take' }, testSec, take);

        // chart: best practice so far by round
        var W = Math.max(280, Math.floor(testSec.clientWidth || 600)), H = W < 520 ? 200 : 230;
        var labs = mine.map(function(r){
          return { r: r, cls: 'mine' + (r === st.test ? ' cur' : ''), text: (orig ? 'test ' + runNo(r) : 'picked at gen ' + pickGen(r)) + ' · exam ' + F.pct(examOf(r)) };
        });
        if(cmp.length) labs.push({ r: null, cls: 'cmp', text: 'original coach, ' + cmp.length + ' tests' });
        var labW = Math.max.apply(null, labs.map(function(l){ return textW(l.text); }));
        var listMode = W - labW < 300;
        var m = { l: 44, r: listMode ? 8 : labW + 18, t: 26, b: 34 };
        var maxR = 1; mine.concat(cmp).forEach(function(r){ maxR = Math.max(maxR, T[r].max_generation); });
        var vals = []; mine.concat(cmp).forEach(function(r){ bestSeries(r).forEach(function(p){ vals.push(p.v); }); });
        var lo = Math.floor(Math.min.apply(null, vals) * 10 - 1e-9) / 10, hi = Math.min(1, Math.ceil(Math.max.apply(null, vals) * 10 + 1e-9) / 10);
        var X = function(g){ return m.l + g / maxR * (W - m.l - m.r); };
        var Y = function(v){ return m.t + (hi - v) / (hi - lo) * (H - m.t - m.b); };
        var svg = EX.s('svg', { 'class': 'fxt-tsvg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': take }, testSec);
        var ax = EX.s('g', { 'class': 'axis', 'aria-hidden': 'true' }, svg);
        for(var k = Math.round(lo * 10); k <= Math.round(hi * 10); k++){ var v = k / 10;
          EX.s('line', { 'class': 'gridline', x1: m.l, x2: X(maxR), y1: Y(v), y2: Y(v) }, ax);
          EX.s('text', { x: m.l - 8, y: Y(v) + 4, 'text-anchor': 'end' }, ax, Math.round(v * 100) + '%');
        }
        EX.s('text', { 'class': 'axt', x: 0, y: m.t - 12 }, ax, 'Best practice score so far');
        for(var g = 0; g <= maxR; g += 2) EX.s('text', { x: X(g), y: H - m.b + 18, 'text-anchor': 'middle' }, ax, String(g));
        EX.s('text', { 'class': 'axt', x: X(maxR), y: H - 1, 'text-anchor': 'end' }, ax, 'Round of the test (0 = fresh player)');
        var lines = {};
        function line(r, cls){
          var s = bestSeries(r), d = stepD(s, X, Y); if(s.length) d += 'H' + X(maxR);
          lines[r] = EX.s('path', { 'class': 'tl ' + cls, d: d }, svg);
        }
        cmp.forEach(function(r){ line(r, 'cmp'); });
        mine.forEach(function(r){ line(r, 'mine' + (r === st.test ? ' cur' : '')); });
        function hi(l, on){
          svg.classList.toggle('hi', on);
          (l.r ? [l.r] : cmp).forEach(function(r){ lines[r].classList.toggle('hl', on); });
        }
        if(!listMode){
          // direct labels at the line ends, spread apart vertically
          labs.forEach(function(l){ l.y = Y(l.r ? bestOf(l.r) : cmp.map(bestOf).reduce(function(a, b){ return a + b; }, 0) / cmp.length); });
          var sorted = labs.slice().sort(function(a, b){ return a.y - b.y; }), gap = 16;
          sorted.forEach(function(l, i){ if(i && l.y < sorted[i - 1].y + gap) l.y = sorted[i - 1].y + gap; });
          var over = sorted[sorted.length - 1].y - (H - m.b);
          if(over > 0) sorted.forEach(function(l){ l.y -= over; });
          labs.forEach(function(l){
            var tx = EX.s('text', { 'class': 'tl-t ' + l.cls, x: X(maxR) + 8, y: l.y + 4 }, svg, l.text);
            tx.addEventListener('mouseenter', function(){ hi(l, true); });
            tx.addEventListener('mouseleave', function(){ hi(l, false); });
          });
        } else {
          var ul = EX.h('ul', { 'class': 'fxt-tlist' }, testSec);
          labs.forEach(function(l){
            var li = EX.h('li', { 'class': l.cls }, ul);
            EX.h('i', { 'aria-hidden': 'true' }, li); EX.h('span', null, li, l.text);
            li.addEventListener('mouseenter', function(){ hi(l, true); });
            li.addEventListener('mouseleave', function(){ hi(l, false); });
          });
        }
      }

      function renderDiff(){
        var n = st.node ? IDX[st.run].by[st.node] : null;
        diffBox.innerHTML = '';
        if(!st.diffOpen || !n || !n.diff){ diffBox.hidden = true; return; }
        diffBox.hidden = false;
        var hd = EX.h('div', { 'class': 'fxt-diffhead' }, diffBox);
        EX.h('b', null, hd, 'Code change in ' + nodeName(n).toLowerCase() + ' (run ' + runNo(st.run) + ')');
        if(n.diff_truncated) EX.h('span', null, hd, ' · first ' + F.int(n.diff.length) + ' of ' + F.int(n.diff_full_chars) + ' characters');
        var pre = EX.h('pre', { 'class': 'code diff wrap', tabindex: 0, 'aria-label': 'Code change in ' + nodeName(n) }, diffBox);
        pre.innerHTML = n.diff.split('\n').map(function(l){
          var c = /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |Binary )/.test(l) ? 'meta' : /^@@/.test(l) ? 'hunk' : /^\+/.test(l) ? 'add' : /^-/.test(l) ? 'del' : '';
          return '<span class="ln' + (c ? ' ' + c : '') + '">' + (EX.esc(l) || ' ') + '</span>';
        }).join('');
      }

      /* ---------- actions ---------- */
      function selectNode(id, user){
        if(id && !IDX[st.run].by[id]) return;
        if(id !== st.node){ st.diffOpen = false; st.test = null; }
        st.node = id || null;
        markSel(); renderSide(); renderDiff(); renderTest();
        if(user){
          if(id) EX.select('node', { run: st.run, node: id, source: 'tree' });
          EX.hash.set('tree', id ? { run: st.run, node: id } : { run: st.run });
        }
      }
      function syncChips(){
        sourceRuns.forEach(function(r){
          chips[r].setAttribute('aria-pressed', String(r === st.run));
          chips[r].setAttribute('tabindex', r === st.run ? 0 : -1);
        });
        showChipNote(st.run);
      }
      function openRun(run, nodeId, user, test){
        var r = resolve(run, nodeId); if(!r) return;
        st.run = r.run; st.node = r.node; st.test = test || r.test; st.diffOpen = false;
        drawAll();
        if(user){
          EX.select('run', { run: st.run, source: 'tree' });
          if(st.node) EX.select('node', { run: st.run, node: st.node, source: 'tree' });
          EX.hash.set('tree', st.node ? { run: st.run, node: st.node } : { run: st.run });
        }
      }
      function drawAll(){ syncChips(); drawChart(); renderSide(); renderDiff(); renderTest(); }

      /* ---------- linking (never switches tabs) ---------- */
      EX.on('select-run', function(p){
        if(!p || p.source === 'tree' || !T[p.run]) return;
        var r = resolve(p.run, null);
        if(r.run === st.run && (T[p.run].kind === 'source' || (r.node === st.node && r.test === st.test))) return;
        openRun(p.run, null, false);
      });
      EX.on('select-node', function(p){
        if(!p || p.source === 'tree' || !T[p.run]) return;
        var r = resolve(p.run, String(p.node));
        if(r.run === st.run && r.node === st.node && r.test === st.test) return;
        if(r.run === st.run && !r.test) selectNode(r.node, false);
        else openRun(p.run, String(p.node), false);
      });
      EX.on('hash', function(h){
        if(!h || h.section !== 'tree' || !h.params.run || !T[h.params.run]) return;
        var r = resolve(h.params.run, h.params.node);
        if(r.run !== st.run || r.node !== st.node || r.test !== st.test) openRun(h.params.run, h.params.node, false);
      });

      /* ---------- first draw + resize ---------- */
      function narrowCheck(){ root.classList.toggle('is-narrow', (node.clientWidth || 0) < 820); }
      narrowCheck(); drawAll();
      function relayout(){ narrowCheck(); drawChart(); renderTest(); }
      ctx.onResize(relayout);
      ctx.onShow(relayout);
    });
  });
})();

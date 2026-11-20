/* fig-results.js — two mounts.
   1. "results" (Figure 3, main story): a plain dot strip. Three rows (no coach / original coach /
      self-improved coach), one dot per finished player, mean tick + thin 95% interval with the mean
      printed beside it, the no-coach range as a shaded band, and a dashed "think longer" reference.
      One interaction: hover / focus / tap a dot for its tooltip (one tab stop, arrows move).
      Neither listens nor emits.
   2. "results-detail" (Explore → Numbers): the full view for readers who want it. Three views
      (Score · vs compute · per 10k tokens; tokens are gateway-ledger tokens per test input), the
      gen-20/40 rows, the xhigh reference row, and G, Δ, I_g − B0 as Welch intervals against 0.
      Emits select-run {run, source:'results'} when a dot is pinned. Listens: nothing.
   Data: summary.json, compute.json. Styles: assets/fig-results.css (linked by index.html; injected
   here as a <link> if missing).                                                                    */
(function(){
  'use strict';

  /* ---------------- shared helpers ---------------- */
  function ensureCSS(){
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for(var i = 0; i < links.length; i++){ if(/fig-results\.css/.test(links[i].getAttribute('href') || '')) return; }
    if(document.getElementById('fx-results-css')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/fig-results.css'; l.id = 'fx-results-css';
    document.head.appendChild(l);
  }

  /* two-sided 95% Student t critical values by df (display intervals only) */
  var T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179];
  function tInterval(vals){
    var n = vals.length, m = d3.mean(vals);
    if(n < 2) return { n: n, mean: m, lo: null, hi: null };
    var sd = d3.deviation(vals), h = (T975[n - 1] || 1.96) * sd / Math.sqrt(n);
    return { n: n, mean: m, lo: m - h, hi: m + h };
  }

  var PLAIN = { B0: 'No coach', I0: 'Original coach', Ig: 'Generation-12 coach', g20: 'Generation-20 coach',
    g40: 'Generation-40 coach', xhigh: 'Think longer (no coach)' };
  function armLabel(a){ return (EX.ARM_LABEL && EX.ARM_LABEL[a]) || PLAIN[a] || a; }

  /* plain run label: core's EX.runLabel(run,{plain:true}) when available, else a local copy */
  function plainRun(run){
    if(EX.ARM_LABEL && EX.runLabel){
      var s = EX.runLabel(run, { plain: true });
      if(s && !/[_₀]|I_g|B0/.test(s)) return s;
    }
    var m;
    if((m = /^B0_rep(\d)$/.exec(run))) return 'No coach, run ' + (+m[1] + 1);
    if(run === 'xhigh') return 'Think longer';
    if((m = /^payoff_I0_(\d)$/.exec(run))) return 'Original coach, run ' + m[1];
    if((m = /^payoff_Ig_source_(s\d)$/.exec(run))) return 'Generation-12 coach from ' + m[1];
    if((m = /^ext_source_(s\d)_g(\d+)$/.exec(run))) return 'Generation-' + m[2] + ' coach from ' + m[1];
    return run;
  }

  /* notation for Explore: EX.sym when core provides it, else a local equivalent */
  var SUBS = { I0: ['I', '0'], Ig: ['I', 'g'], A0: ['A', '0'] };
  function symHTML(n){
    if(EX.sym) return EX.sym(n, 'html');
    var p = SUBS[n]; return '<i>' + p[0] + '</i><sub>' + p[1] + '</sub>';
  }
  function symText(n){
    if(EX.sym) return EX.sym(n, 'text');
    return { I0: 'I₀', Ig: 'I_g', A0: 'A₀' }[n];
  }
  /* write ['Original coach (', {sym:'I0'}, ')'] into an SVG <text> as tspans */
  function svgParts(textEl, parts){
    while(textEl.firstChild) textEl.removeChild(textEl.firstChild);
    parts.forEach(function(p){
      if(typeof p === 'string'){ textEl.appendChild(document.createTextNode(p)); return; }
      var s = SUBS[p.sym];
      EX.s('tspan', { 'font-style': 'italic' }, textEl, s[0]);
      EX.s('tspan', { 'baseline-shift': 'sub', 'font-size': '75%' }, textEl, s[1]);
      EX.s('tspan', null, textEl, ' ');
    });
  }

  /* per-run exact scores from summary.json (compute.json carries rounded copies) */
  function exactScores(S){
    var exact = {};
    (S.B0.reps || []).forEach(function(v, i){ exact['B0_rep' + i] = v; });
    Object.keys(S.I0_runs || {}).forEach(function(k){ exact[k] = S.I0_runs[k]; });
    Object.keys(S.Ig_runs || {}).forEach(function(k){ exact[k] = S.Ig_runs[k]; });
    (S.final_runs || []).forEach(function(r){ if(r.heldout != null) exact[r.run] = r.heldout; });
    if(S.xhigh && S.xhigh.score != null) exact.xhigh = S.xhigh.score;
    return exact;
  }
  function armStat(S, arm, vals){
    var key = { I0: '0', Ig: '12', g20: '20', g40: '40' }[arm];
    var pg = key && S.extension && S.extension.per_generation && S.extension.per_generation[key];
    if(pg && pg.n === vals.length) return { n: pg.n, mean: pg.mean, lo: pg.lo, hi: pg.hi };
    var t = tInterval(vals);
    if(arm === 'B0' && S.B0 && S.B0.mean != null) t.mean = S.B0.mean;
    return t;
  }

  /* one tab stop for a set of SVG dot groups; arrows move, Home/End jump */
  function rovingDots(nodes, onFocus, onActivate){
    var cur = 0;
    function set(i, focus){
      cur = Math.max(0, Math.min(nodes.length - 1, i));
      nodes.forEach(function(n, j){ n.setAttribute('tabindex', j === cur ? '0' : '-1'); });
      if(focus) nodes[cur].focus();
    }
    nodes.forEach(function(n, i){
      n.addEventListener('focus', function(){ cur = i; set(i, false); onFocus(i, n); });
      n.addEventListener('keydown', function(e){
        var k = e.key, j = null;
        if(k === 'ArrowRight' || k === 'ArrowDown') j = i + 1;
        else if(k === 'ArrowLeft' || k === 'ArrowUp') j = i - 1;
        else if(k === 'Home') j = 0; else if(k === 'End') j = nodes.length - 1;
        else if((k === 'Enter' || k === ' ') && onActivate){ e.preventDefault(); onActivate(i); return; }
        if(j != null){ e.preventDefault(); set(j, true); }
      });
    });
    set(0, false);
    return { set: set };
  }

  /* ======================================================================
     1. Main-story Figure 3
     ====================================================================== */
  var MAIN_ARMS = ['B0', 'I0', 'Ig', 'xhigh'];

  EX.mount('results', function(node, ctx){
    ensureCSS();
    return EX.loadAll(['summary']).then(function(res){ buildMain(node, ctx, res[0]); });
  });

  function buildMain(node, ctx, S){
    var F = EX.fmt;
    node.innerHTML = '';
    var exact = exactScores(S);
    var runs = Object.keys(exact).filter(function(r){ return MAIN_ARMS.indexOf(EX.runGroup(r)) >= 0; }).map(function(r){
      return { id: r, arm: EX.runGroup(r), score: exact[r] };
    });
    runs.sort(function(a, b){
      return MAIN_ARMS.indexOf(a.arm) - MAIN_ARMS.indexOf(b.arm) || a.score - b.score || a.id.localeCompare(b.id);
    });
    var stats = {};
    MAIN_ARMS.forEach(function(a){
      var v = runs.filter(function(r){ return r.arm === a; }).map(function(r){ return r.score; });
      stats[a] = a === 'xhigh' ? { n: v.length, mean: v[0] } : armStat(S, a, v);
    });
    var ROWLAB = { B0: 'No coach', I0: 'Original coach', Ig: 'Generation-12 coach', xhigh: 'Think longer, no coach' };

    var root = EX.h('div', { 'class': 'fx-results fx-rm' }, node);
    var svgEl = EX.s('svg', { 'class': 'fx-rm-svg', role: 'group',
      'aria-label': 'Exam score of every finished player. ' + MAIN_ARMS.map(function(a){
        return ROWLAB[a] + ': ' + stats[a].n + (stats[a].n === 1 ? ' run, ' : ' runs, average ') + F.pct(stats[a].mean);
      }).join('; ') + '.' }, root);
    var svg = d3.select(svgEl);

    var W = 600, narrow = false;

    function render(){
      svg.selectAll('*').remove();
      var g = {};
      g.mL = narrow ? 4 : 196;
      g.mR = narrow ? 8 : 20;
      g.top = narrow ? 8 : 14;
      g.rowH = narrow ? 70 : 58;
      g.strip = narrow ? 46 : g.rowH / 2;
      var rowTop = function(i){ return g.top + i * g.rowH; };
      var rowY = function(i){ return rowTop(i) + g.strip; };
      var bottom = rowTop(MAIN_ARMS.length) + 4;
      var H = bottom + 56;
      svg.attr('width', W).attr('height', H).attr('viewBox', '0 0 ' + W + ' ' + H);
      var x = d3.scaleLinear().domain([0.20, 0.45]).range([g.mL, W - g.mR]);
      var ticks = narrow ? [0.20, 0.30, 0.40] : [0.20, 0.25, 0.30, 0.35, 0.40, 0.45];

      /* grid + axis */
      var gGrid = svg.append('g');
      ticks.forEach(function(v){
        gGrid.append('line').attr('class', 'gridline').attr('x1', x(v)).attr('x2', x(v)).attr('y1', g.top).attr('y2', bottom);
      });
      /* a quiet divider above the think-longer row: it is a different kind of player */
      svg.append('line').attr('class', 'fx-rm-div').attr('x1', 0).attr('x2', W).attr('y1', rowTop(3) + (narrow ? 0 : 2)).attr('y2', rowTop(3) + (narrow ? 0 : 2));
      var gAx = svg.append('g').attr('class', 'axis fx-rm-ax').attr('transform', 'translate(0,' + (bottom + 6) + ')')
        .call(d3.axisBottom(x).tickValues(ticks).tickFormat(function(v){ return F.pct(v, 0); }).tickSize(0).tickPadding(4));
      gAx.select('.domain').remove();
      svg.append('text').attr('class', 'fx-rm-axt').attr('x', x(0.20)).attr('y', bottom + 44).attr('text-anchor', 'start')
        .text(narrow ? 'Exam score (share of 120 puzzles solved)' : 'Exam score: share of the 120 exam puzzles solved in two tries');

      /* rows */
      var gRows = svg.append('g');
      MAIN_ARMS.forEach(function(a, i){
        var s = stats[a], y = rowY(i);
        var rg = gRows.append('g').attr('class', 'fx-rm-row' + (a === 'xhigh' ? ' is-ref' : ''));
        var armRuns = runs.filter(function(r){ return r.arm === a; });
        var maxX = d3.max(armRuns, function(r){ return x(r.score); });
        var val = a === 'xhigh' ? F.pct(s.mean) + ', one run' : F.pct(s.mean) + ' average';
        if(narrow){
          var lt = rg.append('text').attr('class', 'fx-rm-lab').attr('x', 0).attr('y', rowTop(i) + 18).text(ROWLAB[a] + '  ');
          lt.append('tspan').attr('class', 'fx-rm-val').text(val);
        } else {
          rg.append('text').attr('class', 'fx-rm-lab').attr('x', 0).attr('y', y + 5).text(ROWLAB[a]);
          if(a === 'xhigh') rg.append('text').attr('class', 'fx-rm-val').attr('x', x(s.mean) - 16).attr('y', y + 5).attr('text-anchor', 'end').text(val);
          else rg.append('text').attr('class', 'fx-rm-val').attr('x', maxX + 14).attr('y', y + 5).text(val);
        }
        if(a !== 'xhigh') rg.append('line').attr('class', 'fx-rm-mean').attr('x1', x(s.mean)).attr('x2', x(s.mean)).attr('y1', y - 12).attr('y2', y + 12);
      });

      /* dots: tied scores are nudged apart vertically */
      var off = {};
      MAIN_ARMS.forEach(function(a){
        var arr = runs.filter(function(r){ return r.arm === a; });
        var cluster = [], last = -1e9;
        function flush(){ cluster.forEach(function(d, k){ off[d.id] = cluster.length === 1 ? 0 : (Math.ceil(k / 2) * (k % 2 ? -1 : 1)) * 9; }); cluster = []; }
        arr.forEach(function(d){ var px = x(d.score); if(cluster.length && px - last > 9) flush(); cluster.push(d); last = px; });
        flush();
      });
      runs.forEach(function(d){ d._x = x(d.score); d._y = rowY(MAIN_ARMS.indexOf(d.arm)) + (off[d.id] || 0); });
      var gDots = svg.append('g').attr('class', 'fx-rm-dots');
      var nodes = runs.map(function(d){
        var dg = gDots.append('g').attr('class', 'fx-rm-dot' + (d.arm === 'xhigh' ? ' is-ref' : '')).attr('transform', 'translate(' + d._x.toFixed(1) + ',' + d._y.toFixed(1) + ')')
          .attr('role', 'img').attr('aria-label', plainRun(d.id) + ': ' + F.pct(d.score));
        dg.append('circle').attr('class', 'ring').attr('r', 9.5);
        dg.append('circle').attr('class', 'dot').attr('r', 6);
        return dg.node();
      });
      function tip(d){
        return '<b>' + EX.esc(plainRun(d.id)) + '</b>: ' + EX.esc(F.pct(d.score));
      }
      function setHot(i){
        nodes.forEach(function(n, j){ n.classList.toggle('is-hot', j === i); });
      }
      rovingDots(nodes, function(i, n){ setHot(i); EX.tooltip.show(tip(runs[i]), n); });
      nodes.forEach(function(n){ n.addEventListener('blur', function(){ setHot(-1); EX.tooltip.hide(); }); });

      function nearest(evt){
        var p = d3.pointer(evt, svgEl), best = -1, bd = 22 * 22;
        runs.forEach(function(d, i){ var dx = d._x - p[0], dy = d._y - p[1], dd = dx * dx + dy * dy; if(dd < bd){ bd = dd; best = i; } });
        return best;
      }
      svgEl.onpointermove = function(e){
        if(e.pointerType === 'touch') return;
        var i = nearest(e);
        setHot(i);
        if(i >= 0){ EX.tooltip.show(tip(runs[i]), nodes[i]); svgEl.style.cursor = 'default'; }
        else EX.tooltip.hide();
      };
      svgEl.onpointerleave = function(){ setHot(-1); EX.tooltip.hide(); };
      svgEl.onclick = function(e){
        var i = nearest(e);
        if(i >= 0){ setHot(i); EX.tooltip.show(tip(runs[i]), nodes[i]); }
        else { setHot(-1); EX.tooltip.hide(); }
      };
    }

    function layout(w){
      W = Math.max(280, Math.floor(w || 600));
      narrow = W < 560;
      root.classList.toggle('narrow', narrow);
      render();
    }
    layout(ctx.width());
    ctx.onResize(layout);
    if(ctx.onShow) ctx.onShow(function(){ layout(ctx.width()); });
  }

  /* ======================================================================
     2. Explore → Numbers: the full figure
     ====================================================================== */
  var ARMS = ['B0', 'I0', 'Ig', 'g20', 'g40'];
  var REF = 'xhigh';
  var ROWS = ARMS.concat([REF]);
  var NAME_PARTS = {
    B0: ['No coach'], I0: ['Original coach'], Ig: ['Generation-12 coach'],
    g20: ['Generation-20 coach'], g40: ['Generation-40 coach'], xhigh: ['Think longer, no coach']
  };
  function nameText(a){ return NAME_PARTS[a].map(function(p){ return typeof p === 'string' ? p : symText(p.sym); }).join(''); }
  var SYM = { B0: 'square', I0: 'circle', Ig: 'circle', g20: 'triangle', g40: 'diamond', xhigh: 'circle' };
  var VIEWS = [
    { value: 'score', label: 'Score' },
    { value: 'tokens', label: 'vs compute' },
    { value: 'eff', label: 'per 10k tokens' }
  ];
  function symPath(arm, size){
    var t = { square: d3.symbolSquare, circle: d3.symbolCircle, triangle: d3.symbolTriangle, diamond: d3.symbolDiamond }[SYM[arm]];
    var s = size || (arm === 'B0' ? 62 : arm === 'g20' ? 64 : arm === 'g40' ? 62 : 72);
    return d3.symbol().type(t).size(s)();
  }
  function symClass(arm){ return 'sym' + (arm === 'Ig' ? ' fill' : arm === REF ? ' ref' : ''); }

  EX.mount('results-detail', function(node, ctx){
    ensureCSS();
    return EX.loadAll(['summary', 'compute']).then(function(res){ buildDetail(node, ctx, res[0], res[1]); });
  });

  function buildDetail(node, ctx, S, C){
    var F = EX.fmt;
    node.innerHTML = '';

    /* ---------------- data ---------------- */
    var exact = exactScores(S);
    var runs = C.runs.filter(function(r){ return ROWS.indexOf(r.group) >= 0; }).map(function(r){
      var n = r.n_test_inputs || 167;
      var ledger = r.heldout_eval_ledger_tokens != null;
      var tok = ledger ? r.heldout_eval_ledger_tokens / n : r.tokens_per_test_input;
      var score = exact[r.run] != null ? exact[r.run] : r.score;
      return { id: r.run, arm: r.group, score: score, tok: tok, ledger: ledger, eff: score / (tok / 10000),
        cost: r.heldout_eval_cost, node: r.final_node };
    });
    runs.sort(function(a, b){ return ROWS.indexOf(a.arm) - ROWS.indexOf(b.arm) || a.id.localeCompare(b.id); });
    var allLedger = runs.every(function(r){ return r.ledger; });
    function armRuns(a){ return runs.filter(function(r){ return r.arm === a; }); }

    var stats = { score: {}, eff: {}, tok: {} };
    ARMS.forEach(function(a){
      var rs = armRuns(a);
      stats.score[a] = armStat(S, a, rs.map(function(r){ return r.score; }));
      stats.eff[a] = tInterval(rs.map(function(r){ return r.eff; }));
      stats.tok[a] = tInterval(rs.map(function(r){ return r.tok; }));
    });
    var refRun = armRuns(REF)[0];
    stats.score[REF] = { n: 1, mean: refRun ? refRun.score : null };
    stats.eff[REF] = { n: 1, mean: refRun ? refRun.eff : null };

    var b0 = armRuns('B0');
    var band = {
      score: { lo: d3.min(b0, function(r){ return r.score; }), hi: d3.max(b0, function(r){ return r.score; }), mean: S.B0.mean },
      eff: { lo: d3.min(b0, function(r){ return r.eff; }), hi: d3.max(b0, function(r){ return r.eff; }), mean: d3.mean(b0, function(r){ return r.eff; }) }
    };

    /* ---------------- DOM ---------------- */
    var root = EX.h('div', { 'class': 'fx-results fx-rd' }, node);
    EX.h('div', { 'class': 'fig-sub-title' }, root, 'No kind of coach differs detectably from no coach');
    var ctl = EX.h('div', { 'class': 'controls fx-r-ctl' }, root);
    var view = 'score';
    var seg = EX.seg(ctl, VIEWS, view, function(v){ setView(v); }, { ariaLabel: 'View' });

    var body = EX.h('div', { 'class': 'fx-r-body' }, root);
    var chartCol = EX.h('div', { 'class': 'fx-r-chart' }, body);
    var svgEl = EX.s('svg', { 'class': 'fx-r-svg', role: 'group', 'aria-label': 'Exam score of every final player, grouped by arm' }, chartCol);
    var legend = EX.h('div', { 'class': 'fx-r-legend', 'aria-label': 'Marker key' }, chartCol);
    ROWS.forEach(function(a){
      var sp = EX.h('span', null, legend);
      var sv = EX.s('svg', { width: 12, height: 12, viewBox: '-6 -6 12 12', 'aria-hidden': 'true' }, sp);
      EX.s('path', { d: symPath(a, 50), 'class': symClass(a) }, sv);
      var lab = EX.h('span', null, sp);
      lab.innerHTML = NAME_PARTS[a].map(function(p){ return typeof p === 'string' ? EX.esc(p) : symHTML(p.sym); }).join('');
    });
    var note = EX.h('p', { 'class': 'fx-r-note' }, chartCol);
    var readout = EX.h('div', { 'class': 'fx-r-readout', 'aria-live': 'polite' }, chartCol);

    var side = EX.h('div', { 'class': 'fx-r-side' }, body);
    buildSide(side);

    var svg = d3.select(svgEl);
    var gGrid = svg.append('g');
    var gBand = svg.append('g');
    var gAx = svg.append('g').attr('class', 'axis');
    var gAy = svg.append('g').attr('class', 'axis');
    var axTitleX = svg.append('text').attr('class', 'ax-title');
    var axTitleY = svg.append('text').attr('class', 'ax-title');
    var gRows = svg.append('g');
    var sepLine = svg.append('line').attr('class', 'sep');
    var gCI = svg.append('g').attr('class', 'g-ci');
    var gDots = svg.append('g').attr('class', 'g-dots');

    var bandRect = gBand.append('rect').attr('class', 'b0-band');
    var bandLine = gBand.append('line').attr('class', 'b0-line');
    var bandLab = gBand.append('text').attr('class', 'band-lab halo');

    var rowSel = gRows.selectAll('g.rowlab').data(ROWS).enter().append('g')
      .attr('class', function(a){ return 'rowlab' + (a === REF ? ' ref' : ''); });
    rowSel.append('text').attr('class', 'lbl halo').each(function(a){ svgParts(this, NAME_PARTS[a]); });
    rowSel.append('text').attr('class', 'lbl-sub halo');

    var ciSel = gCI.selectAll('g.ci').data(ARMS).enter().append('g').attr('class', 'ci');
    ciSel.append('line').attr('class', 'ci-line');
    ciSel.append('line').attr('class', 'ci-cap c1');
    ciSel.append('line').attr('class', 'ci-cap c2');
    ciSel.append('line').attr('class', 'mean-tick');
    ciSel.append('text').attr('class', 'ci-arrow a1').attr('text-anchor', 'middle');
    ciSel.append('text').attr('class', 'ci-arrow a2').attr('text-anchor', 'middle');

    var pinned = null, hot = null;
    var dotSel = gDots.selectAll('g.dg').data(runs, function(d){ return d.id; }).enter().append('g')
      .attr('class', 'dg').attr('tabindex', -1).attr('role', 'button').attr('aria-pressed', 'false')
      .attr('aria-label', function(d){ return ariaFor(d); });
    dotSel.append('circle').attr('class', 'hit').attr('r', 12);
    dotSel.append('circle').attr('class', 'ring').attr('r', 9);
    dotSel.append('path').attr('class', function(d){ return symClass(d.arm); }).attr('d', function(d){ return symPath(d.arm); });

    var REACH = 24;
    function nearest(evt){
      var p = d3.pointer(evt, svgEl), best = null, bd = REACH * REACH;
      runs.forEach(function(d){
        if(d._x == null) return;
        var dx = d._x - p[0], dy = d._y - p[1], dd = dx * dx + dy * dy;
        if(dd < bd){ bd = dd; best = d; }
      });
      return best;
    }
    function dotNode(d){ return dotSel.filter(function(x){ return x.id === d.id; }).node(); }
    svgEl.addEventListener('pointermove', function(e){
      if(e.pointerType === 'touch') return;
      var d = nearest(e);
      if(d !== hot) setHot(d);
      if(d){ EX.tooltip.show(tipHTML(d), dotNode(d)); svgEl.style.cursor = 'pointer'; }
      else { EX.tooltip.hide(); svgEl.style.cursor = ''; }
    });
    svgEl.addEventListener('pointerleave', function(){ setHot(null); EX.tooltip.hide(); svgEl.style.cursor = ''; });
    svgEl.addEventListener('click', function(e){
      var d = nearest(e);
      if(!d) return;
      togglePin(d);
      if(pinned) EX.tooltip.show(tipHTML(d), dotNode(d)); else EX.tooltip.hide();
    });

    /* keyboard: one tab stop for all dots, arrows in visual order */
    var roving = null;
    function bindRoving(){
      var order = focusOrder();
      var nodes = order.map(function(id){ return dotSel.filter(function(x){ return x.id === id; }).node(); });
      // replace old listeners by cloning is overkill; listeners read `order` through closure, so rebind per view
      nodes.forEach(function(n){ n.__rd && n.__rd(); });
      var cur = 0;
      function set(i, focus){
        cur = Math.max(0, Math.min(nodes.length - 1, i));
        nodes.forEach(function(n, j){ n.setAttribute('tabindex', j === cur ? '0' : '-1'); });
        if(focus) nodes[cur].focus();
      }
      nodes.forEach(function(n, i){
        var d = d3.select(n).datum();
        function onFocus(){ cur = i; set(i, false); setHot(d); EX.tooltip.show(tipHTML(d), n); }
        function onBlur(){ setHot(null); EX.tooltip.hide(); }
        function onKey(e){
          var k = e.key, j = null;
          if(k === 'ArrowRight' || k === 'ArrowDown') j = i + 1;
          else if(k === 'ArrowLeft' || k === 'ArrowUp') j = i - 1;
          else if(k === 'Home') j = 0; else if(k === 'End') j = nodes.length - 1;
          else if(k === 'Enter' || k === ' '){ e.preventDefault(); togglePin(d); return; }
          else if(k === 'Escape' && pinned){ togglePin(null); return; }
          if(j != null){ e.preventDefault(); set(j, true); }
        }
        n.addEventListener('focus', onFocus); n.addEventListener('blur', onBlur); n.addEventListener('keydown', onKey);
        n.__rd = function(){ n.removeEventListener('focus', onFocus); n.removeEventListener('blur', onBlur); n.removeEventListener('keydown', onKey); };
      });
      set(0, false);
      roving = { set: set };
    }

    function ariaFor(d){
      return EX.runLabel(d.id) + ', ' + nameText(d.arm) + ': exam score ' + F.pct(d.score) + ', ' + F.tokens(d.tok) + ' tokens per test input';
    }
    function tipHTML(d){
      return '<b>' + EX.esc(plainRun(d.id)) + '</b> · ' + EX.esc(F.pct(d.score)) +
        '<br>' + EX.esc(F.tokens(d.tok)) + ' tokens per test input' + (d.ledger ? ' (ledger)' : '') +
        '<br>' + EX.esc(F.num(d.eff, 3)) + ' score per 10k tokens';
    }
    function renderReadout(){
      var d = hot || pinned;
      if(!d){ readout.textContent = 'Hover over, focus or tap a dot to read its run. Click or press Enter to pin it.'; return; }
      var isPin = pinned && d === pinned && (!hot || hot === pinned);
      readout.innerHTML = (isPin ? '<span class="pin">Pinned:</span> ' : '') + '<b>' + EX.esc(plainRun(d.id)) + '</b> · ' +
        'exam score <b>' + EX.esc(F.pct(d.score)) + '</b> · ' + EX.esc(F.tokens(d.tok)) + ' tokens per test input' +
        (d.cost != null ? ' · exam cost ' + EX.esc(F.usd(d.cost)) : '');
      if(isPin){
        var b = EX.h('button', { type: 'button', 'class': 'btn quiet small' }, readout, 'Clear');
        b.addEventListener('click', function(){ togglePin(null); });
      }
    }
    function setHot(d){
      hot = d;
      dotSel.classed('is-hot', function(x){ return d && x.id === d.id; });
      renderReadout();
    }
    function applyPin(){
      dotSel.classed('is-pinned', function(x){ return pinned && x.id === pinned.id; })
        .attr('aria-pressed', function(x){ return String(!!(pinned && x.id === pinned.id)); });
      renderReadout();
    }
    function togglePin(d){
      pinned = (d && pinned && pinned.id === d.id) ? null : d;
      applyPin();
      if(pinned) EX.select('run', { run: pinned.id, source: 'results' });
    }
    function focusOrder(){
      return dotSel.data().slice().sort(function(a, b){
        if(view === 'tokens') return (a._x - b._x) || (a._y - b._y);
        return (ROWS.indexOf(a.arm) - ROWS.indexOf(b.arm)) || (a._x - b._x) || (a._y - b._y);
      }).map(function(d){ return d.id; });
    }

    /* ---------------- layout ---------------- */
    var W = 600, narrow = false;
    function rowGeom(){
      var g = {};
      g.labelW = narrow ? 0 : 200;
      g.mL = narrow ? 6 : g.labelW + 8;
      g.mR = narrow ? 10 : 18;
      g.top = 34;
      g.rowH = narrow ? 62 : 48;
      g.sepGap = 20;
      g.axisH = 48;
      g.labOff = narrow ? 14 : 0;
      g.stripOff = narrow ? 40 : g.rowH / 2;
      g.rowTop = function(i){ return g.top + i * g.rowH + (i >= ARMS.length ? g.sepGap : 0); };
      g.rowY = function(i){ return g.rowTop(i) + g.stripOff; };
      g.bottom = g.rowTop(ROWS.length - 1) + g.rowH;
      g.H = g.bottom + g.axisH;
      return g;
    }
    function scoreDomain(){
      var lo = d3.min(runs, function(r){ return r.score; }), hi = d3.max(runs, function(r){ return r.score; });
      ARMS.forEach(function(a){ var s = stats.score[a]; if(s.lo != null){ lo = Math.min(lo, s.lo); hi = Math.max(hi, s.hi); } });
      return [Math.floor((lo - 0.005) * 100 / 2) * 2 / 100, Math.ceil((hi + 0.005) * 100 / 2) * 2 / 100];
    }
    function effDomain(){
      var lo = d3.min(runs, function(r){ return r.eff; }), hi = d3.max(runs, function(r){ return r.eff; });
      ARMS.forEach(function(a){ var s = stats.eff[a]; if(s.lo != null){ lo = Math.min(lo, s.lo); hi = Math.max(hi, s.hi); } });
      return [Math.floor((lo - 0.005) * 100) / 100, Math.ceil((hi + 0.005) * 100) / 100];
    }
    function jitter(list, key, step){
      var byArm = {};
      list.forEach(function(d){ (byArm[d.arm] = byArm[d.arm] || []).push(d); });
      var off = {};
      Object.keys(byArm).forEach(function(a){
        var arr = byArm[a].slice().sort(function(p, q){ return key(p) - key(q); });
        var cluster = [], lastX = -1e9;
        function flush(){
          cluster.forEach(function(d, i){ var k = Math.ceil(i / 2) * (i % 2 ? -1 : 1); off[d.id] = cluster.length === 1 ? 0 : k * step; });
          cluster = [];
        }
        arr.forEach(function(d){ var x = key(d); if(cluster.length && x - lastX > 7) flush(); cluster.push(d); lastX = x; });
        flush();
      });
      return off;
    }
    function T(sel, animate){ return animate ? sel.transition().duration(EX.dur(250)).ease(d3.easeCubicOut) : sel; }

    function render(animate){
      var isRows = view !== 'tokens';
      animate = animate && EX.dur(250) > 0;
      var H, xs, ys = null, g = rowGeom();
      var valKey = view === 'eff' ? 'eff' : 'score';
      if(isRows){
        H = g.H;
        xs = d3.scaleLinear().domain(view === 'eff' ? effDomain() : scoreDomain()).range([g.mL, W - g.mR]);
      } else {
        var mL = narrow ? 44 : 56, mR = narrow ? 10 : 18, top = 28, plotH = narrow ? 300 : 360;
        H = top + plotH + 50;
        var maxTok = d3.max(runs, function(r){ return r.tok; });
        xs = d3.scaleLinear().domain([0, Math.ceil(maxTok / 10000) * 10000]).range([mL, W - mR]);
        ys = d3.scaleLinear().domain(scoreDomain()).range([top + plotH, top]);
      }
      svg.attr('height', H).attr('width', W).attr('viewBox', '0 0 ' + W + ' ' + H);
      svgEl.setAttribute('aria-label', view === 'tokens'
        ? 'Exam score against ledger tokens per test input, one mark per final player'
        : view === 'eff' ? 'Exam score per 10k ledger tokens, one dot per final player, grouped by arm'
        : 'Exam score of every final player, grouped by arm, with arm means and 95% intervals');

      var nT = narrow ? 4 : 7;
      var xFmt = view === 'score' ? function(v){ return F.pct(v, 0); }
        : view === 'eff' ? function(v){ return F.num(v, 2); } : function(v){ return v === 0 ? '0' : Math.round(v / 1000) + 'k'; };
      var yAxisPos = isRows ? g.bottom + 8 : ys.range()[0] + 8;
      T(gAx, animate).attr('transform', 'translate(0,' + yAxisPos + ')').call(d3.axisBottom(xs).ticks(nT).tickFormat(xFmt).tickSizeOuter(0).tickSize(4));
      var xTicks = xs.ticks(nT);
      var gridTop = isRows ? g.top - 6 : ys.range()[1];
      var gridBot = isRows ? g.bottom : ys.range()[0];
      var vlines = gGrid.selectAll('line.gv').data(xTicks, function(v){ return view + v; });
      vlines.exit().remove();
      vlines.enter().append('line').attr('class', 'gridline gv').merge(vlines)
        .attr('x1', function(v){ return xs(v); }).attr('x2', function(v){ return xs(v); }).attr('y1', gridTop).attr('y2', gridBot);
      if(ys){
        gAy.style('display', null);
        gAy.attr('transform', 'translate(' + (xs.range()[0] - 6) + ',0)')
          .call(d3.axisLeft(ys).ticks(narrow ? 5 : 6).tickFormat(function(v){ return F.pct(v, 0); }).tickSizeOuter(0).tickSize(4));
        var hl = gGrid.selectAll('line.gh').data(ys.ticks(narrow ? 5 : 6));
        hl.exit().remove();
        hl.enter().append('line').attr('class', 'gridline gh').merge(hl)
          .attr('x1', xs.range()[0]).attr('x2', xs.range()[1]).attr('y1', function(v){ return ys(v); }).attr('y2', function(v){ return ys(v); });
      } else {
        gAy.style('display', 'none');
        gGrid.selectAll('line.gh').remove();
      }
      axTitleX.attr('x', xs.range()[1]).attr('y', yAxisPos + 36).attr('text-anchor', 'end')
        .text(view === 'score' ? 'exam score (share of 120 puzzles solved)' : view === 'eff' ? 'exam score per 10k tokens' : 'tokens per exam question');
      axTitleY.attr('x', ys ? xs.range()[0] - 6 : 0).attr('y', ys ? ys.range()[1] - 12 : 0).attr('text-anchor', 'middle')
        .style('display', ys ? null : 'none').text('exam score');

      if(isRows){
        var bb = band[valKey], bx0 = xs(bb.lo), bx1 = xs(bb.hi);
        T(bandRect, animate).attr('x', bx0).attr('width', Math.max(1, bx1 - bx0)).attr('y', g.top - 6).attr('height', g.rowTop(ARMS.length) - g.top + 2);
        T(bandLine, animate).attr('x1', xs(bb.mean)).attr('x2', xs(bb.mean)).attr('y1', g.top - 6).attr('y2', g.rowTop(ARMS.length) - 4);
        var labTxt = view === 'eff' ? 'no-coach range · mean ' + F.num(bb.mean, 3) : 'no-coach range · mean ' + F.pct(bb.mean);
        bandLab.text(labTxt);
        var lw = labTxt.length * 7, cx = xs(bb.mean), anchor = 'middle', lx = cx;
        if(cx + lw / 2 > W - 4){ anchor = 'end'; lx = Math.min(W - 4, bx1); }
        if(cx - lw / 2 < (narrow ? 2 : g.mL - 40)){ anchor = 'start'; lx = Math.max(narrow ? 2 : g.mL - 40, bx0); }
        T(bandLab, animate).attr('x', lx).attr('y', g.top - 12);
        bandLab.attr('text-anchor', anchor);
      } else {
        var by0 = ys(band.score.hi), by1 = ys(band.score.lo);
        T(bandRect, animate).attr('x', xs.range()[0]).attr('width', xs.range()[1] - xs.range()[0]).attr('y', by0).attr('height', Math.max(1, by1 - by0));
        T(bandLine, animate).attr('x1', xs.range()[0]).attr('x2', xs.range()[1]).attr('y1', ys(band.score.mean)).attr('y2', ys(band.score.mean));
        bandLab.text('no-coach range · mean ' + F.pct(band.score.mean)).attr('text-anchor', 'start');
        T(bandLab, animate).attr('x', xs.range()[0] + 6).attr('y', by0 - 6);
      }

      if(isRows){
        rowSel.style('display', null).style('opacity', 1).attr('transform', function(a, i){
          return 'translate(0,' + (narrow ? g.rowTop(i) + g.labOff : g.rowY(i)) + ')';
        });
        rowSel.select('.lbl').attr('x', 0).attr('y', narrow ? 0 : -3);
        rowSel.select('.lbl-sub').attr('x', narrow ? W - g.mR : 0).attr('y', narrow ? 0 : 15)
          .attr('text-anchor', narrow ? 'end' : 'start')
          .text(function(a){
            var s = stats[valKey][a];
            if(a === REF) return 'reference · 1 run';
            return 'n=' + s.n + ' · mean ' + (view === 'eff' ? F.num(s.mean, 3) : F.pct(s.mean));
          });
        var sy = Math.round(g.rowTop(ARMS.length) - g.sepGap / 2) + 0.5;
        sepLine.style('display', null).attr('x1', 0).attr('x2', W).attr('y1', sy).attr('y2', sy);
      } else {
        rowSel.style('display', 'none'); sepLine.style('display', 'none');
      }

      var x0 = xs.range()[0], x1 = xs.range()[1];
      gCI.classed('soft', !isRows);
      ciSel.each(function(a){
        var gsel = d3.select(this), i = ARMS.indexOf(a);
        var s = isRows ? stats[valKey][a] : stats.score[a];
        var lo = s.lo, hi = s.hi, m = s.mean, L, M, c1, c2, A1 = null, A2 = null;
        if(isRows){
          var y = g.rowY(i), pl = xs(lo), ph = xs(hi), cl = Math.max(x0, pl), ch = Math.min(x1, ph);
          L = [cl, y, ch, y]; M = [xs(m), y - 8, xs(m), y + 8];
          c1 = pl >= x0 ? [pl, y - 4, pl, y + 4] : [cl, y, cl, y];
          c2 = ph <= x1 ? [ph, y - 4, ph, y + 4] : [ch, y, ch, y];
          if(pl < x0) A1 = [cl + 4, y + 4, '◂'];
          if(ph > x1) A2 = [ch - 4, y + 4, '▸'];
        } else {
          var tx = xs(stats.tok[a].mean), yl = ys(lo), yh = ys(hi), ym = ys(m);
          L = [tx, yl, tx, yh]; M = [tx - 8, ym, tx + 8, ym];
          c1 = [tx - 4, yl, tx + 4, yl]; c2 = [tx - 4, yh, tx + 4, yh];
        }
        function setL(sel, v){ T(sel, animate).attr('x1', v[0]).attr('y1', v[1]).attr('x2', v[2]).attr('y2', v[3]); }
        setL(gsel.select('.ci-line'), L); setL(gsel.select('.mean-tick'), M);
        setL(gsel.select('.c1'), c1); setL(gsel.select('.c2'), c2);
        gsel.select('.a1').text(A1 ? A1[2] : '').attr('x', A1 ? A1[0] : 0).attr('y', A1 ? A1[1] : 0);
        gsel.select('.a2').text(A2 ? A2[2] : '').attr('x', A2 ? A2[0] : 0).attr('y', A2 ? A2[1] : 0);
        var title = gsel.select('title'); if(title.empty()) title = gsel.append('title');
        var effMode = valKey === 'eff' && isRows;
        title.text(nameText(a) + ': mean ' + (effMode ? F.num(m, 3) : F.pct(m)) + ', 95% interval ' +
          (effMode ? '[' + F.num(lo, 3) + ', ' + F.num(hi, 3) + ']' : F.ciPct(lo, hi)) + ' (display only)');
      });

      var off = isRows ? jitter(runs, function(d){ return xs(d[valKey]); }, 8) : {};
      runs.forEach(function(d){
        if(isRows){ d._x = xs(d[valKey]); d._y = g.rowY(ROWS.indexOf(d.arm)) + (off[d.id] || 0); }
        else { d._x = xs(d.tok); d._y = ys(d.score); }
      });
      T(dotSel, animate).attr('transform', function(d){ return 'translate(' + d._x.toFixed(1) + ',' + d._y.toFixed(1) + ')'; });

      legend.style.display = isRows ? 'none' : '';
      var tokNote = allLedger ? 'Tokens are the gateway ledger’s player tokens for the exam run, divided by its 167 test inputs. ' : '';
      if(view === 'score') note.textContent = 'Bars: arm mean and a 95% interval, for display only; the pre-registered comparisons are the Welch intervals ' +
        (root.classList.contains('stack') ? 'below' : 'on the right') + '. Shaded band: the range of the three no-coach runs. Tied scores are nudged apart vertically.';
      else if(view === 'eff') note.textContent = 'Each run’s exam score divided by its tokens per test input, per 10k tokens. ' + tokNote +
        'Bars: arm mean and 95% interval (display only); ◂ ▸ mark an interval that runs off the scale.';
      else note.textContent = tokNote + 'y: exam score. Bars: each arm’s 95% interval for score, drawn at its mean token use (display only). Every player had the same two-call budget, so the arms sit in one cluster.';
      bindRoving();
    }

    function setView(v){ view = v; seg.set(v); render(true); }

    /* ---------------- G / Δ side panel ---------------- */
    function buildSide(host){
      EX.h('div', { 'class': 'fx-r-sidetitle' }, host, 'The pre-registered comparisons');
      EX.h('p', { 'class': 'fx-r-sidetext' }, host, 'Differences in exam score, in points, with 95% Welch intervals. An interval that crosses 0 can\'t be told apart from no effect.');
      var items = [
        { key: 'G', sym: 'G', name: 'Original coach vs no coach', words: ['no coach better', 'coach better'] },
        { key: 'Delta', sym: 'Δ', name: 'Generation-12 vs original coach', words: ['original better', 'generation-12 better'] },
        { key: 'Ig_gain_over_B0', sym: '', name: 'Generation-12 coach vs no coach', words: ['no coach better', 'coach better'] }
      ].filter(function(it){ return S[it.key]; });
      var ext = 0;
      items.forEach(function(it){ var s = S[it.key]; ext = Math.max(ext, Math.abs(s.lo), Math.abs(s.hi)); });
      var lim = Math.ceil(ext * 100 + 0.5) / 100;
      var rowsEls = items.map(function(it){
        var s = S[it.key];
        var box = EX.h('div', { 'class': 'cmp' }, host);
        var nm = EX.h('div', { 'class': 'cmp-name' }, box);
        nm.appendChild(document.createTextNode(it.name));
        if(it.sym){ nm.appendChild(document.createTextNode(' (')); EX.h('i', null, nm, it.sym); nm.appendChild(document.createTextNode(')')); }
        
        var val = EX.h('div', { 'class': 'cmp-val' }, box);
        val.innerHTML = '<span class="m">' + EX.esc(F.ptsU(s.est)) + '</span>, interval <span class="m">' + EX.esc(F.ci(s.lo, s.hi)) + '</span>';
        var sv = EX.s('svg', { role: 'img', 'aria-label': it.name + ': ' + F.ptsU(s.est) + ', 95% interval ' + F.ci(s.lo, s.hi) + ' points' }, box);
        var crosses = s.lo < 0 && s.hi > 0;
        EX.h('div', { 'class': 'cmp-verdict' }, box, crosses ? 'Crosses 0: no detectable difference.' : (s.lo >= 0 ? 'Above 0.' : 'Below 0.'));
        return { it: it, s: s, svg: sv };
      });
      host.__draw = function(w){
        rowsEls.forEach(function(r){
          var sv = r.svg; while(sv.firstChild) sv.removeChild(sv.firstChild);
          var pad = 10, H = 50, x = d3.scaleLinear().domain([-lim, lim]).range([pad, w - pad]);
          sv.setAttribute('width', w); sv.setAttribute('height', H); sv.setAttribute('viewBox', '0 0 ' + w + ' ' + H);
          var y = 14;
          EX.s('line', { 'class': 'axl', x1: x(-lim), x2: x(lim), y1: y, y2: y }, sv);
          EX.s('line', { 'class': 'z', x1: x(0), x2: x(0), y1: 2, y2: y + 12 }, sv);
          EX.s('line', { 'class': 'bar', x1: x(r.s.lo), x2: x(r.s.hi), y1: y, y2: y }, sv);
          EX.s('line', { 'class': 'cap', x1: x(r.s.lo), x2: x(r.s.lo), y1: y - 5, y2: y + 5 }, sv);
          EX.s('line', { 'class': 'cap', x1: x(r.s.hi), x2: x(r.s.hi), y1: y - 5, y2: y + 5 }, sv);
          EX.s('circle', { 'class': 'est', cx: x(r.s.est), cy: y, r: 4 }, sv);
          var top = Math.floor(lim * 100);
          [-top, 0, top].forEach(function(v){
            EX.s('text', { 'class': 'tk', x: x(v / 100), y: y + 19, 'text-anchor': 'middle' }, sv, v === 0 ? '0' : F.signed(v, 0));
          });
          EX.s('text', { 'class': 'dir', x: x(-lim), y: y + 35, 'text-anchor': 'start' }, sv, '← ' + r.it.words[0]);
          EX.s('text', { 'class': 'dir', x: x(lim), y: y + 35, 'text-anchor': 'end' }, sv, r.it.words[1] + ' →');
        });
      };
    }

    function layout(mw){
      if(!mw) return;
      var wide = mw >= 820;
      narrow = mw < 560;
      root.classList.toggle('stack', !wide);
      root.classList.toggle('narrow', narrow);
      W = Math.max(280, Math.floor(wide ? mw - 300 - 28 - 1 : mw));
      side.__draw(Math.max(220, wide ? 300 - 24 : Math.min(mw, 520)));
      render(false);
    }
    layout(ctx.width() || 600);
    applyPin();
    ctx.onResize(function(w){ layout(w); });
    if(ctx.onShow) ctx.onShow(function(){ layout(ctx.width()); });
  }
})();

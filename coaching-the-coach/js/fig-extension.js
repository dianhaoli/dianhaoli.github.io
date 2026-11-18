/* fig-extension.js — two mounts.
   1. `generations` (main story, Figure 4): "Did coaches from later generations do better?"
      x = the generation the coach was taken from (0 / 12 / 20 / 40, proportional), y = exam score.
      A mean line with its 95% band, the individual runs as faint dots, the no-coach band and a
      dashed "think longer" reference. ONE interaction: a toggle that highlights the one coach
      (same code) whose players were scored three times.
   Data: summary.json (extension, B0, xhigh, final_runs), trees.json (coach_origin).
   Main mount: no events, no hash. Detail mount: emits select-run on a pin; listens to select-run quietly.
   CSS: assets/fig-extension.css (injected as a <link> if index.html does not already load it). */
(function(){
  'use strict';

  function ensureCSS(){
    if(document.querySelector('link[href*="fig-extension.css"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/fig-extension.css';
    document.head.appendChild(l);
  }

  var GENS = [0, 12, 20, 40];
  var SEEDS = [0, 1, 2, 3];

  /* ---------- shared data prep ---------- */
  function prep(S, T){
    var E = S.extension, finals = {};
    (S.final_runs || []).forEach(function(f){ finals[f.run] = f; });
    var pts = E.points.map(function(p){
      var t = T[p.run] || {}, o = t.coach_origin || {};
      var lin = o.source_lineage || null, fin = finals[p.run] || {};
      var src = o.source_run || null;
      var m = src ? /^source_s(\d)$/.exec(src) : null;
      var seed = (p.seed_index != null && p.seed_index >= 0 && p.seed_index <= 3 && m && (+m[1] - 1) === p.seed_index) ? p.seed_index : null;
      return {
        run: p.run, gen: p.generation, score: p.heldout, seed: seed,
        src: src, node: o.source_node != null ? String(o.source_node) : null,
        tokens: lin ? lin.cum_meta_tokens : 0, depth: lin ? lin.depth : 0,
        finalNode: fin.final_node != null ? String(fin.final_node) : (t.final ? String(t.final.final_node) : null),
        repeatOf: null, sameAs: []
      };
    });
    var byRun = {}; pts.forEach(function(p){ byRun[p.run] = p; });
    var seedPts = {};
    SEEDS.forEach(function(s){
      var list = seedPts[s] = pts.filter(function(p){ return p.seed === s; }).sort(function(a, b){ return a.gen - b.gen; });
      list.forEach(function(p, i){
        for(var j = 0; j < i; j++){ if(list[j].node === p.node && p.repeatOf == null) p.repeatOf = list[j].gen; }
        p.sameAs = list.filter(function(q){ return q !== p && q.node === p.node; }).map(function(q){ return q.gen; });
      });
    });
    // the one coach (source run + node) whose players were scored most often; ties -> largest spread
    var groups = {};
    pts.forEach(function(p){ if(p.src && p.node != null){ var k = p.src + ':' + p.node; (groups[k] = groups[k] || []).push(p); } });
    var best = null;
    Object.keys(groups).forEach(function(k){
      var g = groups[k].slice().sort(function(a, b){ return a.gen - b.gen; });
      var sc = g.map(function(p){ return p.score; });
      var spread = Math.max.apply(null, sc) - Math.min.apply(null, sc);
      if(!best || g.length > best.pts.length || (g.length === best.pts.length && spread > best.spread)) best = { key: k, pts: g, spread: spread };
    });
    return { S: S, E: E, pts: pts, byRun: byRun, seedPts: seedPts, sameCoach: best, PG: E.per_generation,
      b0lo: Math.min.apply(null, S.B0.reps), b0hi: Math.max.apply(null, S.B0.reps) };
  }

  /* place text labels row by row, bumping a label down a row when it would overlap one already placed */
  function placeRows(texts, rowY, rowH, pad){
    var rows = [];
    texts.forEach(function(t){
      var bb = t.getBBox(), x0 = bb.x - pad, x1 = bb.x + bb.width + pad, r = 0;
      while(rows[r] && rows[r].some(function(iv){ return x0 < iv[1] && x1 > iv[0]; })) r++;
      (rows[r] = rows[r] || []).push([x0, x1]);
      t.setAttribute('y', rowY + r * rowH);
    });
    return rows.length;
  }

  /* =====================================================================
     1. Main story: mount `generations`
     ===================================================================== */
  EX.mount('generations', function(node, ctx){
    ensureCSS();
    var F = EX.fmt;

    function layout(w){
      var narrow = w < 600;
      return { narrow: narrow, H: narrow ? 300 : 340, M: { t: 24, r: 12, b: 0, l: 42 } };
    }

    // skeleton at the final size, before the data arrives
    node.innerHTML = '';
    var root = EX.h('div', { 'class': 'fx-generations' }, node);
    var bar = EX.h('div', { 'class': 'fxg-bar' }, root);
    var toggle = EX.h('button', { type: 'button', 'class': 'btn fxg-toggle', 'aria-pressed': 'false', disabled: 'disabled' }, bar, 'Highlight one coach tested three times');
    var live = EX.h('span', { 'class': 'fxg-live', 'aria-live': 'polite' }, bar);
    var plotWrap = EX.h('div', { 'class': 'fxg-plot-wrap' }, root);
    var sk = layout(ctx.width() || 600);
    plotWrap.style.minHeight = (sk.H + (sk.narrow ? 92 : 74)) + 'px';

    return EX.loadAll(['summary', 'trees']).then(function(res){
      var D = prep(res[0], res[1].trees), S = D.S, PG = D.PG;
      var on = false, svg = null;
      toggle.removeAttribute('disabled');
      var same = D.sameCoach;
      var sameRuns = same ? same.pts.map(function(p){ return p.run; }) : [];
      if(!same || same.pts.length < 2) toggle.hidden = true;

      toggle.addEventListener('click', function(){
        on = !on; toggle.setAttribute('aria-pressed', String(on));
        toggle.textContent = on ? 'Hide the highlight' : 'Highlight one coach tested three times';
        root.classList.toggle('show-same', on);
        live.textContent = on ? 'Highlighted: the same coach code, scored ' + same.pts.map(function(p){ return F.pct(p.score); }).join(', ') + '. The spread is noise.' : '';
      });

      function draw(){
        var w = Math.max(300, plotWrap.clientWidth || ctx.width());
        var L = layout(w), narrow = L.narrow, M = L.M, H = L.H;
        root.classList.toggle('narrow', narrow);
        plotWrap.innerHTML = '';
        svg = EX.s('svg', { 'class': 'fxg-plot', width: w, height: H, viewBox: '0 0 ' + w + ' ' + H, role: 'group',
          'aria-label': 'Average exam score by the generation the coach was taken from: ' +
            GENS.map(function(g){ return 'generation ' + g + ' ' + F.pct(PG[String(g)].mean); }).join(', ') +
            '. No coach ' + F.pct(S.B0.mean) + '; think longer ' + F.pct(S.xhigh.score) + '.' }, plotWrap);
        var yBot = H - 6;  // plot bottom, axis labels are added below and the svg grows to fit
        var Y = d3.scaleLinear().domain([0.20, 0.42]).range([yBot, M.t]);
        var x0 = M.l + (narrow ? 34 : 152), x1 = w - M.r - (narrow ? 48 : 76);
        var Xlin = d3.scaleLinear().domain([0, 40]).range([x0, x1]);
        // phone: the four generations evenly spaced (proportional spacing crowds 12 and 20 together)
        var X = narrow ? function(g){ var i = GENS.indexOf(g); return i >= 0 ? x0 + i * (x1 - x0) / (GENS.length - 1) : (x0 + 2.5 * (x1 - x0) / (GENS.length - 1)); } : Xlin;
        var right = w - M.r;

        // y grid + ticks
        var gy = EX.s('g', { 'class': 'axis' }, svg);
        [0.20, 0.25, 0.30, 0.35, 0.40].forEach(function(v){
          EX.s('line', { 'class': 'gridline', x1: M.l, x2: right, y1: Y(v), y2: Y(v) }, svg);
          EX.s('text', { x: M.l - 8, y: Y(v), dy: '0.32em', 'text-anchor': 'end' }, gy, F.pct(v, 0));
        });

        // no-coach band
        EX.s('rect', { 'class': 'b0-band', x: M.l, width: right - M.l, y: Y(D.b0hi), height: Y(D.b0lo) - Y(D.b0hi) }, svg);
        EX.s('line', { 'class': 'b0-line', x1: M.l, x2: right, y1: Y(S.B0.mean), y2: Y(S.B0.mean) }, svg);
        var b0t = EX.s('text', { 'class': 'fxg-ref halo', x: M.l + 8 }, svg);
        if(narrow){
          // phone: no room beside the band, so a swatch + label in the empty bottom-left of the plot
          var ky = Y(0.215);
          EX.s('rect', { 'class': 'b0-band', x: M.l + 8, y: ky - 6, width: 18, height: 10 }, svg);
          EX.s('line', { 'class': 'b0-line', x1: M.l + 8, x2: M.l + 26, y1: ky - 1, y2: ky - 1 }, svg);
          b0t.setAttribute('y', ky); b0t.setAttribute('dy', '0.32em'); b0t.setAttribute('x', M.l + 32);
          b0t.textContent = 'No coach ' + F.pct(S.B0.mean) + ' (band: its 3 runs)';
        } else {
          // below the band at the right edge, clear of the generation-0 dots and the mean line
          b0t.setAttribute('x', right - 4); b0t.setAttribute('text-anchor', 'end');
          b0t.setAttribute('y', Y(D.b0lo) + 18);
          b0t.textContent = 'No coach ' + F.pct(S.B0.mean) + ' (band: its 3 runs)';
        }

        // think-longer reference
        EX.s('line', { 'class': 'fxg-xh', x1: M.l, x2: right, y1: Y(S.xhigh.score), y2: Y(S.xhigh.score) }, svg);
        EX.s('text', { 'class': 'fxg-ref halo', x: right, y: Y(S.xhigh.score) - 7, 'text-anchor': 'end' }, svg,
          (narrow ? 'Think longer ' : 'Think longer, no coach ') + F.pct(S.xhigh.score));

        // mean line (the run dots show the spread; no interval band, to keep one fill on the chart)
        var line = d3.line().x(function(g){ return X(g); }).y(function(g){ return Y(PG[String(g)].mean); });
        EX.s('path', { 'class': 'fxg-mean', d: line(GENS) }, svg);

        // individual runs: faint dots right of each column, dodged when scores tie
        var dotsG = EX.s('g', { 'class': 'fxg-dots', tabindex: '-1' }, svg);   // explicit -1: Chromium makes SVG groups with focusin listeners tabbable
        var dotX = {};
        GENS.forEach(function(g){
          var list = D.pts.filter(function(p){ return p.gen === g; }).sort(function(a, b){ return a.score - b.score; });
          var used = [];
          list.forEach(function(p){
            var k = 0;
            while(used.some(function(u){ return u.k === k && Math.abs(Y(u.s) - Y(p.score)) < 7; })) k++;
            used.push({ k: k, s: p.score });
            dotX[p.run] = X(g) + 13 + k * 9;
          });
        });
        D.pts.slice().sort(function(a, b){ return a.gen - b.gen || a.score - b.score; }).forEach(function(p){
          var a0 = p.finalNode === 'initial';
          var g = EX.s('g', { 'class': 'fxg-dot' + (sameRuns.indexOf(p.run) >= 0 ? ' same' : ''), tabindex: '-1', role: 'img',
            transform: 'translate(' + dotX[p.run].toFixed(1) + ',' + Y(p.score).toFixed(1) + ')',
            'aria-label': plainLabel(p) + ': ' + F.pct(p.score) + (a0 ? '. This run\'s final player was the untouched starting player' : '') }, dotsG);
          EX.s('circle', { 'class': 'fxg-focus', r: 8 }, g);
          EX.s('circle', { 'class': 'fxg-pt' + (a0 ? ' hollow' : ''), r: 4.2 }, g);
          EX.s('circle', { 'class': 'hit', r: 10 }, g);
          EX.tooltip.attach(g, function(){ return tipHTML(p); });
        });
        EX.roving(dotsG, '.fxg-dot', { orientation: 'horizontal' });

        // the same coach, three times (shown by the toggle)
        if(same && same.pts.length > 1){
          var sg = EX.s('g', { 'class': 'fxg-samegrp', 'aria-hidden': 'true' }, svg);
          // no connecting line: these are repeats of one coach, not a trend over generations
          same.pts.forEach(function(p){
            EX.s('circle', { 'class': 'fxg-same-ring', cx: dotX[p.run], cy: Y(p.score), r: 9 }, sg);
            EX.s('circle', { 'class': 'fxg-same-pt', cx: dotX[p.run], cy: Y(p.score), r: 5 }, sg);
            EX.s('text', { 'class': 'fxg-same-lbl halo', x: dotX[p.run] + 9, y: Y(p.score), dy: '0.35em' }, sg, F.pct(p.score));
          });
          // the one-line note, in the empty top-left of the plot
          var nt = EX.s('text', { 'class': 'fxg-same-note halo', x: M.l + 8, y: Y(0.385) }, sg);
          if(narrow){
            EX.s('tspan', { x: M.l + 8 }, nt, 'Ringed: one unchanged coach,');
            EX.s('tspan', { x: M.l + 8, dy: '1.3em' }, nt, 'tested 3 times. The spread is noise.');
          } else nt.textContent = 'Ringed: one unchanged coach, tested 3 times. The spread is noise.';
        }

        // means: points + direct labels above
        GENS.forEach(function(g){
          var c = PG[String(g)];
          EX.s('circle', { 'class': 'fxg-mean-pt', cx: X(g), cy: Y(c.mean), r: 4.5 }, svg);
          EX.s('text', { 'class': 'fxg-mean-lbl halo', x: X(g) - 3, y: Y(c.mean) - 12, 'text-anchor': 'middle' }, svg, F.pct(c.mean))
            .appendChild(EX.s('title', null, null, 'Generation ' + g + ': average ' + F.pct(c.mean) + ' over ' + c.n + ' runs'));
        });

        // x axis: generation numbers, then plain sub-labels (bumped to a new row when they would collide)
        EX.s('line', { 'class': 'zero-line', x1: M.l, x2: right, y1: yBot, y2: yBot }, svg);
        var ax = EX.s('g', { 'class': 'axis' }, svg);
        GENS.forEach(function(g){
          EX.s('line', { x1: X(g), x2: X(g), y1: yBot, y2: yBot + 5 }, ax);
          EX.s('text', { 'class': 'fxg-gen', x: X(g), y: yBot + 20, 'text-anchor': 'middle' }, svg, String(g));
        });
        var subs = [];
        var subText = { 0: 'original coach', 12: narrow ? 'self-improved coach' : 'self-improved coach (main test)', 20: 'follow-up', 40: 'follow-up' };
        (narrow ? [0, 12, 30] : GENS).forEach(function(g){
          var t = EX.s('text', { 'class': 'fxg-sub' + (g >= 20 ? ' fxg-follow' : ''), x: X(g), y: yBot + 38, 'text-anchor': 'middle' }, svg, subText[g] || 'follow-up');
          subs.push(t);
        });
        var nRows = placeRows(subs, yBot + 38, 17, 6);
        if(narrow){   // one "follow-up" label under a bracket spanning 20 and 40
          var by = +subs[2].getAttribute('y') - 14;
          EX.s('path', { 'class': 'fxg-bracket', d: 'M' + X(20) + ',' + (by - 3) + 'V' + by + 'H' + X(40) + 'V' + (by - 3) }, svg);
        }
        var tY = yBot + 38 + nRows * 17 + 4;
        EX.s('text', { 'class': 'fxg-axtitle', x: narrow ? M.l : M.l, y: narrow ? tY + 2 : yBot + 20, 'text-anchor': 'start' }, svg,
          narrow ? 'Generation the coach was picked at' : 'Picked at generation');
        if(narrow) tY += 18;
        var Hf = Math.ceil(tY + 4);
        svg.setAttribute('height', Hf); svg.setAttribute('viewBox', '0 0 ' + w + ' ' + Hf);
        plotWrap.style.minHeight = '';
      }

      function plainLabel(p){ return EX.runLabel(p.run, { plain: true }); }
      function tipHTML(p){
        var h = '<b>' + EX.esc(plainLabel(p)) + ': ' + F.pct(p.score) + '</b>';
        if(p.finalNode === 'initial') h += '<br>This run\'s final player was the untouched starting player.';
        if(sameRuns.indexOf(p.run) >= 0) h += '<br>Same coach code as the other ringed runs.';
        return h;
      }

      draw();
      ctx.onResize(function(){ draw(); });
    });
  });
})();

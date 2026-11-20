/* fig-audit.js — Explore › Code changes (mount "audit").
   At rest: one computed sentence, one stacked bar (general vs ARC-specific audited changes), then the
   distinct changes grouped by coach version (one coach version can be picked several times; its change is
   audited once per pick). Each change is one line; the ARC-specific ones start open.
   Behind "More options": tag / run filters, open or close all, and how often each source run's coach edited itself.
   Data: trees.json (trees[source].diff_audit[], nodes, tested runs' final exam scores), summary.json (self_edit, diff_audit_summary).
   Emits: select-node ("Show in tree", which also opens the tree tab). Listens: select-node (marks a group quietly).
   Hash: #audit?run=…&node=… */
(function(){
  'use strict';

  var PICK_ORDER = { Ig: 0, g6: 1, g20: 2, g30: 3, g40: 4 };

  function parsePick(pick){
    var m = /^A_gen12:(source_s\d+)$/.exec(pick);
    if(m) return { kind: 'Ig', run: m[1], gen: 12 };
    m = /^ext:(source_s\d+)_g(\d+)$/.exec(pick);
    if(m) return { kind: 'g' + m[2], run: m[1], gen: +m[2] };
    return { kind: pick, run: null, gen: null };
  }
  function seed(run){ return run.replace('source_s', ''); }

  EX.mount('audit', function(node, ctx){
    node.innerHTML = '';
    return EX.loadAll(['summary', 'trees']).then(function(res){
      var S = res[0], TR = res[1], T = TR.trees, F = EX.fmt;
      var sourceRuns = TR.runs.filter(function(r){ return T[r] && T[r].kind === 'source'; });

      function testedBy(p){
        var rid = p.kind === 'Ig' ? 'payoff_Ig_' + p.run : 'ext_' + p.run + '_' + p.kind;
        return T[rid] ? rid : null;
      }
      function nodeOf(run, id){ var ns = T[run].nodes; for(var i = 0; i < ns.length; i++) if(ns[i].id === id) return ns[i]; return null; }

      /* ---------- audited rows -> coach versions -> distinct changes ---------- */
      var nAudited = 0, nArcAudited = 0, groups = [], gIndex = {};
      sourceRuns.forEach(function(run){
        (T[run].diff_audit || []).forEach(function(a){
          nAudited++; if(a.tag === 'ARC-specific') nArcAudited++;
          var nid = a.node != null ? String(a.node) : a.pick;
          var gk = run + '|' + nid, g = gIndex[gk];
          if(!g){
            var nd = a.node != null ? nodeOf(run, String(a.node)) : null;
            g = gIndex[gk] = { key: gk, run: run, node: a.node != null ? String(a.node) : null, gen: nd ? nd.generation : null, picks: [], changes: [], ck: {} };
            groups.push(g);
          }
          if(g.picks.indexOf(a.pick) < 0) g.picks.push(a.pick);
          var ck = a.file + '#' + a.idx, c = g.ck[ck];
          if(!c){ c = g.ck[ck] = { id: 'c' + Object.keys(gIndex).length + '_' + g.changes.length, g: g, file: a.file, idx: a.idx, arc: false, reason: a.reason || '', text: a.text || null, audits: 0 }; g.changes.push(c); }
          c.audits++;
          if(a.tag === 'ARC-specific'){ c.arc = true; c.reason = a.reason || c.reason; }
        });
      });
      groups.forEach(function(g){
        g.picks.sort(function(a, b){ return PICK_ORDER[parsePick(a).kind] - PICK_ORDER[parsePick(b).kind]; });
        g.changes.sort(function(a, b){ return (b.arc - a.arc) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.idx - b.idx; });
        g.hasArc = g.changes.some(function(c){ return c.arc; });
        g.tested = g.picks.map(parsePick).filter(function(p){ return testedBy(p); });
      });
      groups.sort(function(a, b){ return (b.hasArc - a.hasArc) || sourceRuns.indexOf(a.run) - sourceRuns.indexOf(b.run) || (+a.node - +b.node); });
      var allChanges = []; groups.forEach(function(g){ allChanges = allChanges.concat(g.changes); });
      var SUM = S.diff_audit_summary || {};
      if(SUM.hunks != null && SUM.hunks !== nAudited && window.console) console.warn('[audit] diff_audit rows', nAudited, '!= summary.hunks', SUM.hunks);
      var nGenAudited = nAudited - nArcAudited;

      function pickName(p){
        if(p.kind === 'Ig') return 'generation-12 coach';
        return testedBy(p) ? 'generation-' + p.gen + ' coach' : 'gen ' + p.gen + ' pick';
      }
      function examText(p){
        var rid = testedBy(p); if(!rid || !T[rid].final) return '';
        var f = T[rid].final;
        return ' (exam ' + F.pct(f.heldout) + (f.final_node === 'initial' ? ', the untouched player was kept' : '') + ')';
      }
      function pickedAs(g){
        var ps = g.picks.map(parsePick), tested = ps.filter(function(p){ return testedBy(p); }), untested = ps.filter(function(p){ return !testedBy(p); });
        var parts = tested.map(function(p){ return pickName(p) + examText(p); });
        if(untested.length){
          var u = untested.map(function(p){ return 'gen ' + p.gen; }).join(' and ') + ' pick' + (untested.length > 1 ? 's' : '');
          parts.push(tested.length ? 'also the ' + u + ' (same code as the tested pick' + (tested.length > 1 ? 's' : '') + ')' : u + ': code never examined on the exam');
        }
        return parts.join('; ');
      }

      var state = { tag: 'all', run: 'all', open: {}, marked: null };
      allChanges.forEach(function(c){ if(c.arc) state.open[c.id] = true; });

      var root = EX.h('div', { 'class': 'fx-audit' }, node);
      // one counting basis on screen: distinct changes (the list below shows each once)
      var nArcD0 = allChanges.filter(function(c){ return c.arc; }).length, nGenD0 = allChanges.length - nArcD0;
      EX.h('p', { 'class': 'fa-lead' }, root, 'The tested coaches made ' + allChanges.length + ' distinct changes to their own code. ' +
        nArcD0 + ' of them were judged specific to these puzzles (ARC-specific); the rest are general advice.');

      // one stacked bar, direct-labelled
      var bw = EX.h('div', { 'class': 'fa-barwrap' }, root);
      var bar = EX.h('div', { 'class': 'fa-bar', role: 'img', 'aria-label': nGenD0 + ' general and ' + nArcD0 + ' ARC-specific distinct changes' }, bw);
      EX.h('span', { 'class': 'fa-seg gen', style: { flexGrow: String(nGenD0) } }, bar);
      EX.h('span', { 'class': 'fa-seg arc', style: { flexGrow: String(Math.max(nArcD0, 0.0001)) } }, bar);
      var bl = EX.h('div', { 'class': 'fa-barlab', 'aria-hidden': 'true' }, bw);
      EX.h('span', null, bl, nGenD0 + ' general');
      var al = EX.h('span', { 'class': 'fa-arcl' }, bl);
      EX.h('i', { 'class': 'fa-sq' }, al); al.appendChild(document.createTextNode(nArcD0 + ' ARC-specific'));
      EX.h('p', { 'class': 'fa-note' }, root, 'Counted once per picked coach, as in the write-up: ' + nAudited + ' changes, ' + nArcAudited + ' ARC-specific.');

      var more = EX.more(root, 'More options', buildMore);
      var listEl = EX.h('div', { 'class': 'fa-list' }, root);

      function visible(c){ return (state.tag === 'all' || (state.tag === 'arc') === c.arc) && (state.run === 'all' || c.g.run === state.run); }
      function diffHTML(text){
        return text.split('\n').map(function(l){
          var c = l.indexOf('@@') === 0 ? 'hunk' : l.charAt(0) === '+' ? 'add' : l.charAt(0) === '-' ? 'del' : '';
          return '<span class="ln' + (c ? ' ' + c : '') + '">' + (EX.esc(l) || ' ') + '</span>';
        }).join('');
      }
      function renderList(){
        listEl.innerHTML = '';
        var shown = 0;
        groups.forEach(function(g){
          var cs = g.changes.filter(visible); if(!cs.length) return;
          shown++;
          var sec = EX.h('section', { 'class': 'fa-group' + (state.marked === g.key ? ' is-marked' : ''), 'data-key': g.key }, listEl);
          var gh = EX.h('div', { 'class': 'fa-gh' }, sec);
          var t = EX.h('div', { 'class': 'fa-gh-t' }, gh);
          EX.h('b', null, t, 'Run ' + seed(g.run) + ', version ' + (g.node || '?'));
          if(g.gen != null) t.appendChild(document.createTextNode(' · generation ' + g.gen));
          EX.h('div', { 'class': 'fa-gh-p' }, t, 'Picked as ' + pickedAs(g) + '.');
          if(g.node){
            var sb = EX.h('button', { type: 'button', 'class': 'btn small quiet fa-gh-btn', 'aria-label': 'Show run ' + seed(g.run) + ' version ' + g.node + ' in the tree' }, gh, 'Show in tree');
            sb.addEventListener('click', function(){
              state.marked = g.key; markGroups();
              EX.hash.set('audit', { run: g.run, node: g.node }, { replace: true });
              if(EX.explore && EX.explore.open) EX.explore.open('tree', { scroll: true });
              EX.select('node', { run: g.run, node: g.node, source: 'audit' });
            });
          }
          cs.forEach(function(c){
            var d = EX.h('details', { 'class': 'fa-row' + (c.arc ? ' is-arc' : '') }, sec);
            if(state.open[c.id]) d.open = true;
            var sm = EX.h('summary', null, d);
            var tg = EX.h('span', { 'class': 'fa-tag' }, sm);
            if(c.arc){ EX.h('i', { 'class': 'fa-sq', 'aria-hidden': 'true' }, tg); tg.appendChild(document.createTextNode('ARC-specific')); }
            else tg.textContent = 'general';
            EX.h('span', { 'class': 'fa-file' }, sm, c.file + (g.changes.filter(function(x){ return x.file === c.file; }).length > 1 ? ' · part ' + (c.idx + 1) : ''));
            EX.h('span', { 'class': 'fa-reason' }, sm, c.reason);
            d.addEventListener('toggle', function(){ if(d.open) state.open[c.id] = true; else delete state.open[c.id]; });
            var body = EX.h('div', { 'class': 'fa-body' }, d);
            EX.h('p', { 'class': 'fa-full' }, body, c.reason);
            if(c.text){ var pre = EX.h('pre', { 'class': 'code diff wrap fa-diff', tabindex: '0', 'aria-label': 'Change in ' + c.file }, body); pre.innerHTML = diffHTML(c.text); }
            else EX.h('p', { 'class': 'fa-full' }, body, 'No change text was saved.');
          });
        });
        if(!shown) EX.h('p', { 'class': 'empty' }, listEl, 'No change matches these options.');
      }
      function markGroups(){
        listEl.querySelectorAll('.fa-group').forEach(function(s){ s.classList.toggle('is-marked', s.getAttribute('data-key') === state.marked); });
      }

      /* ---------- More options ---------- */
      function buildMore(body){
        var ctr = EX.h('div', { 'class': 'controls fa-controls' }, body);
        var nArcD = allChanges.filter(function(c){ return c.arc; }).length;
        EX.seg(ctr, [
          { value: 'all', label: 'All ' + allChanges.length },
          { value: 'arc', label: 'ARC-specific ' + nArcD },
          { value: 'gen', label: 'General ' + (allChanges.length - nArcD) }
        ], state.tag, function(v){ state.tag = v; renderList(); }, { ariaLabel: 'Show changes' });
        EX.selectBox(ctr, [{ value: 'all', label: 'All runs' }].concat(sourceRuns.map(function(r){ return { value: r, label: 'Run ' + seed(r) }; })),
          state.run, function(v){ state.run = v; renderList(); }, { label: 'Run' });
        var ob = EX.h('button', { type: 'button', 'class': 'btn' }, ctr, 'Open all');
        var cb = EX.h('button', { type: 'button', 'class': 'btn' }, ctr, 'Close all');
        ob.addEventListener('click', function(){ allChanges.forEach(function(c){ if(visible(c)) state.open[c.id] = true; }); renderList(); });
        cb.addEventListener('click', function(){ state.open = {}; renderList(); });

        var SE = S.self_edit || {};
        var seRuns = sourceRuns.filter(function(r){ return SE[r]; });
        if(!seRuns.length) return;
        var tot = { gens: 0, ed: 0, par: 0 };
        seRuns.forEach(function(r){ tot.gens += SE[r].gens; tot.ed += SE[r].self_edit_gens; tot.par += SE[r].self_edit_parents; });
        EX.h('h5', { 'class': 'fa-h5' }, body, 'How often the coach edited its own code');
        EX.h('p', { 'class': 'fa-note' }, body, 'First ' + SE[seRuns[0]].gens + ' generations of each source run: ' + tot.ed + ' of ' + tot.gens +
          ' generations changed coach code; ' + tot.par + ' of those were later built on.');
        var list = EX.h('div', { 'class': 'fa-se', role: 'img', 'aria-label': seRuns.map(function(r){ return 'run ' + seed(r) + ': ' + SE[r].self_edit_gens + ' of ' + SE[r].gens; }).join('; ') }, body);
        seRuns.forEach(function(r){
          var v = SE[r], row = EX.h('div', { 'class': 'fa-se-row' }, list);
          EX.h('span', { 'class': 'fa-se-name' }, row, 'Run ' + seed(r));
          var tr = EX.h('span', { 'class': 'fa-se-track' }, row);
          for(var i = 0; i < v.gens; i++) EX.h('span', { 'class': 'fa-cell ' + (i < v.self_edit_parents ? 'par' : i < v.self_edit_gens ? 'ed' : 'no') }, tr);
          EX.h('span', { 'class': 'fa-se-n' }, row, v.self_edit_gens + ' of ' + v.gens);
        });
        var lg = EX.h('div', { 'class': 'fa-legend' }, body);
        lg.innerHTML = '<span><i class="fa-cell par"></i>edited coach code, later built on</span><span><i class="fa-cell ed"></i>edited coach code</span><span><i class="fa-cell no"></i>no coach edit</span>';
      }

      renderList();

      /* ---------- linking (quiet) ---------- */
      function markFrom(run, nodeId){
        var g = groups.filter(function(x){ return x.run === run && x.node === String(nodeId); })[0];
        state.marked = g ? g.key : null; markGroups(); return g;
      }
      EX.on('select-node', function(p){ if(p && p.source !== 'audit') markFrom(p.run, p.node); });
      var hs = EX.hash.get();
      if(hs && hs.section === 'audit' && hs.params && hs.params.run && hs.params.node) markFrom(hs.params.run, hs.params.node);
      void more;
    });
  });
})();

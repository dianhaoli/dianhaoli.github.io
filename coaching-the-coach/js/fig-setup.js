/* fig-setup.js — Figure 1, "the loop".
   Left: the coach edits the player, the player plays practice puzzles, scores go back to the coach,
   and the coach also rewrites itself (blue). Right: the coach is frozen and trains a fresh player,
   which sits the exam. Complete at rest; no interaction.
   Wide layout (mount >= 820px): one 960-wide SVG. Narrow: a stacked 340-wide SVG.
   Data: summary.json (practice-set size, exam size, generations, rounds). Emits nothing. */
(function(){
  'use strict';

  var CSS = [
    '.fx-setup svg{display:block;width:100%;height:auto;margin:0 auto;overflow:visible}',
    '.fx-setup.wide svg{max-width:960px}',
    '.fx-setup.narrow svg{max-width:400px}',
    '.fx-setup .bx{fill:var(--box-fill);stroke:var(--rule-strong);stroke-width:1}',
    '.fx-setup .bx-acc{fill:var(--box-fill);stroke:var(--accent);stroke-width:1.6}',
    '.fx-setup .tag{fill:none;stroke:var(--rule-strong);stroke-width:1;stroke-dasharray:3 3}',
    '.fx-setup .t-box{font-size:15px;font-weight:600;fill:var(--ink)}',
    '.fx-setup .t-head{font-size:15px;font-weight:600;fill:var(--ink-2)}',
    '.fx-setup .t-lab{font-size:14px;fill:var(--ink-2)}',
    '.fx-setup .t-note{font-size:14px;fill:var(--ink-muted)}',
    '.fx-setup .t-acc{font-size:14px;fill:var(--accent);font-weight:500}',
    '.fx-setup .ln{stroke:var(--rule-strong);stroke-width:1.3;fill:none}',
    '.fx-setup .ln-acc{stroke:var(--accent);stroke-width:1.8;fill:none}',
    '.fx-setup .ah{fill:var(--rule-strong)} .fx-setup .ah-acc{fill:var(--accent)}',
    '.fx-setup .div{stroke:var(--rule);stroke-width:1;stroke-dasharray:3 4}',
    '.fx-setup .halo{paint-order:stroke;stroke:var(--panel);stroke-width:5px;stroke-linejoin:round}'
  ].join('\n');

  function injectCSS(){
    if(document.getElementById('fx-setup-css')) return;
    var st = document.createElement('style'); st.id = 'fx-setup-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  EX.mount('setup', function(node, ctx){
    injectCSS();
    return EX.load('summary').then(function(S){
      var D = EX.derive(S), sets = S.sets;
      var T = {
        practice: sets.source_practice_tasks + ' practice puzzles',
        exam: 'Exam: ' + sets.heldout_tasks + ' unseen puzzles',
        repeat: '↻ repeat for ' + D.sourceGens + '–' + D.extMaxGen + ' generations',
        trains: 'trains a fresh player, ' + D.rounds + ' rounds',
        score: 'score = puzzles solved in ≤2 tries'
      };
      var LABEL = 'Diagram. Step 1, the coach improves itself: the coach edits the player\'s code, the player plays ' + T.practice +
        ', the scores go back to the coach, and the coach also rewrites itself; repeated for ' + D.sourceGens + ' to ' + D.extMaxGen +
        ' generations. Step 2, we test it: the self-improved coach, or the original coach, is frozen and ' + T.trains +
        '; that player sits the ' + T.exam.replace('Exam: ', 'exam of ') + '. For comparison, an uncoached player sat the same exam, both normally and thinking longer.';

      var mode = null;
      function render(){
        var w = node.clientWidth || 960;
        var m = w >= 820 ? 'wide' : 'narrow';
        if(m === mode && node.firstChild) return;
        mode = m;
        node.innerHTML = '';
        var root = EX.h('div', { 'class': 'fx-setup ' + m }, node);
        var svg = EX.s('svg', { viewBox: m === 'wide' ? '0 0 960 312' : '0 0 340 716', role: 'img', 'aria-label': LABEL }, root);
        var mk = defs(svg);
        if(m === 'wide') drawWide(svg, mk); else drawNarrow(svg, mk);
      }

      /* ---------- primitives ---------- */
      function defs(svg){
        var d = EX.s('defs', null, svg), ids = {};
        [['n', 'ah'], ['a', 'ah-acc']].forEach(function(p){
          var id = EX.uid('fxs-' + p[0]); ids[p[0]] = id;
          var m = EX.s('marker', { id: id, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 8, markerHeight: 8,
            orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, d);
          EX.s('path', { d: 'M0,1 L9,5 L0,9 z', 'class': p[1] }, m);
        });
        return ids;
      }
      function box(svg, x, y, w, h, title, acc){
        EX.s('rect', { 'class': acc ? 'bx-acc' : 'bx', x: x, y: y, width: w, height: h, rx: 5 }, svg);
        EX.s('text', { 'class': 't-box', x: x + w / 2, y: y + h / 2 + 5, 'text-anchor': 'middle' }, svg, title);
      }
      function tag(svg, x, y, w, h, text){
        EX.s('rect', { 'class': 'tag', x: x, y: y, width: w, height: h, rx: 4 }, svg);
        EX.s('text', { 'class': 't-note', x: x + w / 2, y: y + h / 2 + 5, 'text-anchor': 'middle' }, svg, text);
      }
      function arrow(svg, mk, d, acc){
        EX.s('path', { 'class': acc ? 'ln-acc' : 'ln', d: d, 'marker-end': 'url(#' + mk[acc ? 'a' : 'n'] + ')' }, svg);
      }
      function text(svg, cls, x, y, s, anchor){
        return EX.s('text', { 'class': cls + ' halo', x: x, y: y, 'text-anchor': anchor || 'start' }, svg, s);
      }

      /* ---------- wide: 960 x 312 ---------- */
      function drawWide(svg, mk){
        text(svg, 't-head', 20, 26, 'Step 1 · The coach improves itself');
        text(svg, 't-head', 600, 26, 'Step 2 · We test it');
        EX.s('line', { 'class': 'div', x1: 560, x2: 560, y1: 8, y2: 304 }, svg);
        // left loop: Player (left), Coach (right), practice puzzles below the player
        box(svg, 20, 96, 180, 56, 'Player');
        box(svg, 330, 96, 180, 56, 'Coach');
        box(svg, 20, 216, 180, 56, T.practice);
        arrow(svg, mk, 'M392,94 C378,46 462,46 448,92', true);                 // rewrites itself
        text(svg, 't-acc', 420, 52, 'rewrites itself', 'middle');
        arrow(svg, mk, 'M329,124 L203,124');
        text(svg, 't-lab', 266, 115, 'edits code', 'middle');
        arrow(svg, mk, 'M110,153 L110,213');
        text(svg, 't-lab', 120, 188, 'plays');
        arrow(svg, mk, 'M201,244 L404,244 Q420,244 420,228 L420,155');
        text(svg, 't-lab', 310, 236, 'scores', 'middle');
        text(svg, 't-note', 20, 300, T.repeat);
        // right: frozen coach -> fresh player -> exam
        arrow(svg, mk, 'M511,124 L597,124', true);
        text(svg, 't-acc', 554, 115, 'freeze', 'middle');
        box(svg, 600, 96, 184, 56, 'Self-improved coach', true);
        tag(svg, 796, 108, 158, 32, 'or the original coach');
        arrow(svg, mk, 'M692,153 L692,213');
        text(svg, 't-lab', 704, 188, T.trains);
        box(svg, 572, 216, 240, 56, T.exam);
        text(svg, 't-note', 692, 298, T.score, 'middle');
        // the two baselines that sat the same exam with no coach at all
        text(svg, 't-note', 832, 210, 'compared with:');
        tag(svg, 832, 218, 124, 28, 'no coach');
        tag(svg, 832, 254, 124, 28, 'thinking longer');
        arrow(svg, mk, 'M831,232 L815,238');
        arrow(svg, mk, 'M831,268 L815,252');
      }

      /* ---------- narrow: 340 x 626, stacked ---------- */
      function drawNarrow(svg, mk){
        text(svg, 't-head', 0, 16, 'Step 1 · The coach improves itself');
        box(svg, 62, 62, 176, 50, 'Coach');
        arrow(svg, mk, 'M126,61 C112,26 188,26 174,59', true);
        text(svg, 't-acc', 196, 40, 'rewrites itself');
        arrow(svg, mk, 'M150,113 L150,155');
        text(svg, 't-lab', 160, 138, 'edits code');
        box(svg, 62, 158, 176, 50, 'Player');
        arrow(svg, mk, 'M150,209 L150,251');
        text(svg, 't-lab', 160, 234, 'plays');
        box(svg, 62, 254, 176, 50, T.practice);
        arrow(svg, mk, 'M61,279 L38,279 Q28,279 28,269 L28,97 Q28,87 38,87 L59,87');
        text(svg, 't-lab', 36, 234, 'scores');
        text(svg, 't-note', 0, 334, T.repeat);
        // freeze: from the coach, down the right side, into the frozen coach
        arrow(svg, mk, 'M239,87 L302,87 Q314,87 314,99 L314,427 Q314,439 302,439 L241,439', true);
        text(svg, 't-acc', 270, 79, 'freeze', 'middle');
        EX.s('line', { 'class': 'div', x1: 0, x2: 300, y1: 356, y2: 356 }, svg);
        text(svg, 't-head', 0, 392, 'Step 2 · We test it');
        box(svg, 62, 414, 176, 50, 'Self-improved coach', true);
        tag(svg, 62, 474, 176, 30, 'or the original coach');
        arrow(svg, mk, 'M150,505 L150,553');
        text(svg, 't-lab', 160, 524, 'trains a fresh player,');
        text(svg, 't-lab', 160, 541, D.rounds + ' rounds');
        box(svg, 30, 556, 240, 50, T.exam);
        text(svg, 't-note', 150, 624, T.score, 'middle');
        text(svg, 't-note', 30, 660, 'compared with:');
        tag(svg, 30, 672, 112, 30, 'no coach');
        tag(svg, 152, 672, 118, 30, 'thinking longer');
      }

      render();
      ctx.onResize(function(){ render(); });
    });
  });
})();

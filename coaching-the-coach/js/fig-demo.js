/* fig-demo.js — Figure 6, "Inside one coaching round" (mount `demo`).
   A separate, traced re-run of one coaching round, with the model's reasoning summaries saved.
   Two tabs (the puzzle the edit fixed / the puzzle still wrong) and a five-step stepper:
     1 the player tries, 2 the coach reads the misses, 3 the coach thinks and edits,
     4 the player tries again, 5 did it hold up (repeat runs).
   ONE interaction: the stepper (Back / Next, clickable step dots, ←/→ while focus is in the figure).
   Data: demo.json (built by arcexp/build_demo_bundle.py; NOT part of the experiment's results).
   Emits / listens: nothing.
   CSS: assets/fig-demo.css (injected as a <link> if index.html does not already load it). */
(function(){
  'use strict';

  function ensureCSS(){
    if(document.querySelector('link[href*="fig-demo.css"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/fig-demo.css';
    document.head.appendChild(l);
  }

  var STEPS = [
    { key: 'try',   label: 'The player tries' },
    { key: 'read',  label: 'The coach looks at the misses' },
    { key: 'edit',  label: 'The coach thinks and edits' },
    { key: 'again', label: 'The player tries again' },
    { key: 'hold',  label: 'Did it hold up?' }
  ];
  var TABS = [
    { kind: 'fixed', label: 'Solved more often after the edit' },
    { kind: 'still_wrong', label: 'Still wrong after the edit' }
  ];
  /* Plain-language names for the turns of the traced round. Written by hand from each turn's
     command (shown right below the name), so they are used only for that round. */
  var TURN_NAMES = { c4: {
    1: 'Looks around the code', 2: 'Reads the run log and the code', 3: 'Reads how practice runs are scored',
    4: 'Opens the practice report', 5: 'Skims the failure logs', 6: 'Rewrites the prompt and the second try',
    7: 'Rewords the review instruction', 8: 'Checks that the code still compiles', 9: 'Describes its change',
    10: 'Says it is done'
  } };
  /* Our own one-line reading of the player's reasoning summaries and answers, written by hand; keyed by task and side.
     Shown labelled as our reading, never as the model's words. */
  var OUR_READING = {
    b15fca0b: {
      before: 'The summaries weigh several ideas, among them a path between the two red (2) cells and filling the regions that the blue (1) lines wall off. The correct answer is one yellow (4) path that winds between the blue lines from one red cell to the other. Try 1 came close to it; try 2 filled larger areas.',
      after: 'This time the summaries lean on filling regions and outer strips walled off by the blue (1) lines. The answer paints yellow (4) down the right edge and in blocks on the left instead of one path between the red (2) cells, and the review returned the same grid.'
    }
  };
  /* Verbatim sentences from the coach's reasoning summary that explain the edit (checked against the data at render). */
  var EDIT_QUOTE = { c4: { turn: 6, parts: [
    'Right now, there are two direct calls repeating the same prompt, so I want to change that.',
    'Instead, I should ask the model to critique the first candidate and validate it against training pairs.'
  ] } };
  var COLOR_NAMES = ['black', 'blue', 'red', 'green', 'yellow', 'grey', 'magenta', 'orange', 'light blue', 'maroon'];

  var fmt = EX.fmt;
  function isGrid(g){ return Array.isArray(g) && g.length > 0 && Array.isArray(g[0]); }
  function cellsOff(g, t){
    if(!isGrid(g) || !isGrid(t)) return null;
    if(g.length !== t.length || g[0].length !== t[0].length) return -1;
    var n = 0;
    for(var r = 0; r < g.length; r++) for(var c = 0; c < g[0].length; c++) if(g[r][c] !== t[r][c]) n++;
    return n;
  }
  function plural(n, one, many){ return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  function word(n){ return WORDS[n] != null ? WORDS[n] : String(n); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

  /* reasoning summaries use **bold** headings and blank-line paragraphs; everything else is escaped */
  function mdHTML(text){
    return String(text || '').trim().split(/\n\s*\n/).map(function(p){
      var e = EX.esc(p).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
      return '<p>' + e + '</p>';
    }).join('');
  }

  EX.mount('demo', function(node, ctx){
    ensureCSS();
    node.innerHTML = '';
    var st = { tab: 0, step: 0 };
    var D = null;

    var root = EX.h('div', { 'class': 'fx-demo' }, node);
    var tabsEl = EX.h('div', { 'class': 'tabs fxd-tabs', role: 'tablist', 'aria-label': 'Which puzzle' }, root);
    var stageId = EX.uid('fxd-stage');
    var tabBtns = TABS.map(function(t, i){
      var b = EX.h('button', { type: 'button', role: 'tab', id: stageId + '-tab' + i, 'aria-controls': stageId,
        'aria-selected': i === 0 ? 'true' : 'false', tabindex: i === 0 ? '0' : '-1' }, tabsEl, t.label);
      b.addEventListener('click', function(){ setTab(i, false); });
      return b;
    });
    tabsEl.addEventListener('keydown', function(e){
      if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault(); e.stopPropagation();
      var i = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (st.tab + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
      setTab(i, true);
    });

    var stepper = EX.h('ol', { 'class': 'fxd-steps', 'aria-label': 'Steps' }, root);
    var stepBtns = STEPS.map(function(s, i){
      var li = EX.h('li', { 'class': 'fxd-stepli' }, stepper);
      var b = EX.h('button', { type: 'button', 'class': 'fxd-stepbtn', 'aria-label': 'Step ' + (i + 1) + ': ' + s.label }, li);
      EX.h('span', { 'class': 'fxd-num', 'aria-hidden': 'true' }, b, String(i + 1));
      EX.h('span', { 'class': 'fxd-steplab', 'aria-hidden': 'true' }, b, s.label);
      b.addEventListener('click', function(){ go(i, false); });
      return b;
    });

    var stage = EX.h('div', { 'class': 'fxd-stage', id: stageId, role: 'tabpanel', tabindex: '0',
      'aria-labelledby': stageId + '-tab0' }, root);
    var stageHead = EX.h('div', { 'class': 'fxd-stagehead', 'aria-live': 'polite' }, stage);
    var body = EX.h('div', { 'class': 'fxd-body' }, stage);
    EX.h('div', { 'class': 'fxd-wait' }, body, 'Loading the traced run…');

    var nav = EX.h('div', { 'class': 'fxd-nav' }, root);
    var back = EX.h('button', { type: 'button', 'class': 'btn quiet fxd-back' }, nav, '← Back');
    var next = EX.h('button', { type: 'button', 'class': 'btn primary big fxd-next' }, nav, 'Next →');
    back.addEventListener('click', function(){ go(st.step - 1, true); });
    next.addEventListener('click', function(){
      if(st.step < STEPS.length - 1) return go(st.step + 1, true);
      if(st.tab < TABS.length - 1){ st.step = 0; setTab(st.tab + 1, false); bringIntoView(); }
      else { st.tab = 0; setTab(0, false); go(0, true); }
    });

    root.addEventListener('keydown', function(e){
      if(e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if(e.altKey || e.ctrlKey || e.metaKey) return;
      var tag = (e.target.tagName || '').toLowerCase();
      if(tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.closest('[role=tablist]')) return;
      e.preventDefault();
      go(st.step + (e.key === 'ArrowRight' ? 1 : -1), false);
    });

    function bringIntoView(){
      var r = root.getBoundingClientRect();
      if(r.top < 0) root.scrollIntoView({ block: 'start', behavior: EX.reduceMotion ? 'auto' : 'smooth' });
    }
    function setTab(i, focus){
      st.tab = i;
      tabBtns.forEach(function(b, j){
        b.setAttribute('aria-selected', j === i ? 'true' : 'false');
        b.setAttribute('tabindex', j === i ? '0' : '-1');
      });
      stage.setAttribute('aria-labelledby', tabBtns[i].id);
      if(focus) tabBtns[i].focus();
      render();
    }
    function go(i, fromButton){
      if(i < 0 || i >= STEPS.length) return;
      var hadFocusInStage = stage.contains(document.activeElement);
      st.step = i;
      render();
      if(hadFocusInStage && !stage.contains(document.activeElement)) stage.focus({ preventScroll: true });
      if(fromButton) bringIntoView();
    }

    function sizes(){
      var w = Math.max(280, root.clientWidth || ctx.width() || 336);
      return { w: w, narrow: w < 680, ex: w < 680 ? Math.max(56, Math.min(84, Math.floor((w - 40) / 4))) : 92,
        big: w < 680 ? Math.min(200, Math.floor((w - 24) / 2)) : 190 };
    }

    /* ---------- shared pieces ---------- */
    function thoughts(parent, text, opts){
      opts = opts || {};
      var wrap = EX.h('div', { 'class': 'fxd-thought' }, parent);
      EX.h('div', { 'class': 'fxd-lbl' }, wrap, opts.label || 'Its reasoning summary');
      if(!text || !String(text).trim()){
        EX.h('div', { 'class': 'fxd-none' }, wrap, 'No reasoning summary came back for this call (the API returns one for only some calls).');
        return wrap;
      }
      var box = EX.h('div', { 'class': 'fxd-tbody', html: mdHTML(text) }, wrap);
      if(opts.lines) box.style.maxHeight = 'calc(' + opts.lines + ' * 1.55em)';
      var btn = EX.h('button', { type: 'button', 'class': 'btn quiet small fxd-readall', 'aria-expanded': 'false' }, wrap, 'Read all');
      if(box.scrollHeight <= box.clientHeight + 2){ btn.remove(); box.classList.add('fits'); return wrap; }
      var words = String(text).trim().split(/\s+/).length;
      btn.textContent = 'Read all (' + fmt.int(words) + ' words)';
      btn.addEventListener('click', function(){
        var open = box.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.textContent = open ? 'Show less' : 'Read all (' + fmt.int(words) + ' words)';
        if(opts.lines) box.style.maxHeight = open ? '' : 'calc(' + opts.lines + ' * 1.55em)';
        if(open){ box.setAttribute('tabindex', '0'); box.setAttribute('aria-label', 'Reasoning summary, full text'); }
        else { box.removeAttribute('tabindex'); box.scrollTop = 0; }
      });
      return wrap;
    }
    function codeBlock(parent, text, cls, label){
      var pre = EX.h('pre', { 'class': 'code wrap fxd-code ' + (cls || ''), tabindex: '0', 'aria-label': label || 'Code' }, parent);
      pre.textContent = text;
      return pre;
    }
    function collapse(parent, label, build){
      var d = EX.h('details', { 'class': 'fxd-coll' }, parent);
      EX.h('summary', null, d, label);
      var b = EX.h('div', { 'class': 'fxd-collbody' }, d);
      var built = false;
      d.addEventListener('toggle', function(){ if(d.open && !built){ built = true; build(b); } });
      return d;
    }
    function verdictText(call, i, calls, truth, side){
      var g = call.parsed_grid;
      if(!isGrid(g)) return { ok: false, text: '× no answer' };
      if(call.parsed_correct) return { ok: true, text: '✓ correct' };
      if(i > 0 && EX.gridsEqual(g, calls[0].parsed_grid)){
        var grids = calls.filter(function(c){ return isGrid(c.parsed_grid); }).length;
        var dropped = (side.submitted || []).length < grids;
        return { ok: false, text: dropped ? '× same as try 1, so the player sent only one answer' : '× same as try 1' };
      }
      var n = cellsOff(g, truth);
      if(n === -1) return { ok: false, text: '× wrong size' };
      return { ok: false, text: '× ' + plural(n, 'cell') + ' off' };
    }
    function bestOff(side, truth){
      var best = null;
      (side.calls || []).forEach(function(c){
        var n = cellsOff(c.parsed_grid, truth);
        if(n != null && n >= 0 && (best == null || n < best)) best = n;
      });
      return best;
    }
    function reading(parent, P, which){
      var t = (OUR_READING[P.task] || {})[which];
      if(!t) return;
      var d = EX.h('div', { 'class': 'fxd-reading' }, parent);
      EX.h('div', { 'class': 'fxd-lbl' }, d, 'Our reading of its summaries and answers (not the model\'s words)');
      EX.h('p', { 'class': 'fxd-p' }, d, t);
    }
    function colorKey(parent, P){
      var seen = {};
      function add(g){ (g || []).forEach(function(r){ r.forEach(function(v){ seen[v] = 1; }); }); }
      P.train.forEach(function(p){ add(p.input); add(p.output); });
      P.test.forEach(function(t){ add(t.input); add(t.output); });
      var ul = EX.h('ul', { 'class': 'fxd-key', 'aria-label': 'Colour key: the number behind each colour' }, parent);
      Object.keys(seen).map(Number).sort().forEach(function(v){
        var li = EX.h('li', null, ul);
        EX.h('span', { 'class': 'fxd-sw', style: { background: EX.ARC[v] }, 'aria-hidden': 'true' }, li);
        EX.h('span', null, li, v + ' ' + COLOR_NAMES[v]);
      });
    }

    function examples(parent, P, z){
      var ex = EX.h('div', { 'class': 'fxd-examples' }, parent);
      P.train.forEach(function(p, k){
        var it = EX.h('div', { 'class': 'fxd-ex' }, ex);
        EX.h('div', { 'class': 'fxd-lbl' }, it, 'Example ' + (k + 1));
        EX.arcPair(it, p.input, p.output, { maxSize: z.ex, maxCell: 12 });
      });
    }
    function testRow(parent, P, z){
      var row = EX.h('div', { 'class': 'fxd-test' }, parent);
      var t = P.test[0];
      var a = EX.h('div', { 'class': 'fxd-gridcol' }, row);
      EX.h('div', { 'class': 'fxd-lbl' }, a, 'Test input');
      EX.arcGrid(a, t.input, { maxSize: z.narrow ? z.big - 8 : 130, maxCell: 14, title: 'Test input' });
      EX.h('span', { 'class': 'arc-arrow fxd-arrow', 'aria-hidden': 'true' }, row, '→');
      var b = EX.h('div', { 'class': 'fxd-gridcol' }, row);
      EX.h('div', { 'class': 'fxd-lbl' }, b, 'Correct answer');
      EX.arcGrid(b, t.output, { maxSize: z.narrow ? z.big - 8 : 130, maxCell: 14, title: 'Correct answer' });
      colorKey(parent, P);
    }

    function attempt(parent, side, P, z, isAfter){
      var truth = P.test[0].output;
      var calls = side.calls || [];
      var solvedOn = null;
      calls.forEach(function(c, i){ if(solvedOn == null && c.parsed_correct) solvedOn = i + 1; });
      var res = EX.h('div', { 'class': 'fxd-result' }, parent);
      if(side.solved) EX.h('span', { 'class': 'ok' }, res, '✓ Solved' + (solvedOn ? ' on try ' + solvedOn : ''));
      else EX.h('span', { 'class': 'no' }, res, '× Not solved: ' + (calls.length > 1 ? 'both tries wrong' +
        ((side.submitted || []).length === 1 ? ', and only one answer was sent' : '') : 'the try was wrong'));

      calls.forEach(function(c, i){
        var row = EX.h('div', { 'class': 'fxd-call' }, parent);
        var isReview = /A previous attempt proposed/.test(c.prompt_summary || '');
        var head = EX.h('div', { 'class': 'fxd-callhead' }, row);
        EX.h('span', { 'class': 'fxd-callname' }, head, 'Try ' + (i + 1) + (isReview ? ': a review of try 1' : ''));
        if(c.seconds != null) EX.h('span', { 'class': 'fxd-callmeta' }, head, 'call took ' + fmt.secs(c.seconds));
        var cols = EX.h('div', { 'class': 'fxd-callcols' }, row);
        var right = EX.h('div', { 'class': 'fxd-callright' }, cols);
        var left = EX.h('div', { 'class': 'fxd-callleft' }, cols);
        thoughts(left, c.reasoning_summary);
        EX.h('div', { 'class': 'fxd-lbl' }, right, 'Its answer');
        EX.arcGrid(right, c.parsed_grid, { maxSize: z.narrow ? z.big - 8 : 150, maxCell: 14,
          diffAgainst: truth, title: 'Try ' + (i + 1) + ' answer', emptyText: 'no answer' });
        var v = verdictText(c, i, calls, truth, side);
        EX.h('div', { 'class': 'fxd-verdict ' + (v.ok ? 'ok' : 'no') }, right, v.text);
      });
      if(!calls.length) EX.h('div', { 'class': 'empty' }, parent, 'No model calls were recorded for this run.');
    }

    /* ---------- the five steps ---------- */
    function stepTry(P, z){
      head('The player sees the examples and the test input, then gets two tries. Wrong cells are outlined.');
      examples(body, P, z);
      testRow(body, P, z);
      reading(body, P, 'before');
      attempt(body, P.before, P, z, false);
    }

    function stepRead(P, z){
      var CR = D.coach_round, rep = CR.baseline_report || {};
      var per = rep.per_task_score || {}, ids = Object.keys(per);
      var nSolved = ids.filter(function(k){ return per[k] >= 1; }).length;
      head('Before editing, the coach gets the practice report: which puzzles the player solved and a log of each miss. Here is what it actually looked at.');
      var sec = EX.h('div', { 'class': 'fxd-sec' }, body);
      EX.h('div', { 'class': 'fxd-subh' }, sec, 'The practice report: ' + nSolved + ' of ' + ids.length + ' puzzles solved');
      var strip = EX.h('ul', { 'class': 'fxd-strip', 'aria-label': 'Practice puzzles, solved or missed' }, sec);
      ids.forEach(function(k){
        var ok = per[k] >= 1, me = k === P.task;
        var li = EX.h('li', { 'class': 'fxd-cell ' + (ok ? 'ok' : 'no') + (me ? ' me' : ''),
          'aria-label': (me ? 'This puzzle: ' : 'Puzzle ' + k + ': ') + (ok ? 'solved' : 'missed') }, strip);
        EX.h('span', { 'aria-hidden': 'true' }, li, ok ? '✓' : '×');
      });
      EX.h('div', { 'class': 'fxd-striplab' }, sec, 'The outlined square is this puzzle.');

      var shown = CR.baseline_failures_shown || [], read = CR.baseline_failures_read || [];
      var tIdx = -1;
      (CR.turns || []).forEach(function(t, i){ if(tIdx < 0 && /chat_history/.test(t.tool_command || '')) tIdx = i; });
      var T = tIdx >= 0 ? CR.turns[tIdx] : null;
      var sec2 = EX.h('div', { 'class': 'fxd-sec' }, body);
      EX.h('div', { 'class': 'fxd-subh' }, sec2, 'What it looked at');
      var txt = 'Each of the ' + shown.length + ' missed puzzles, this one included, has a log of the player\'s prompts and answers. ';
      if(T){
        var m1 = /head -(\d+)/.exec(T.tool_command), m2 = /cut -c1-(\d+)/.exec(T.tool_command);
        txt += 'The coach named ' + (read.length === shown.length ? 'all ' + read.length : read.length + ' of them') +
          ' in one command (turn ' + T.turn + '), but from each it printed only the lines that start with "Input:" or "Output:" or contain "Error:"' +
          (m1 ? ', at most ' + m1[1] + ' lines' : '') + (m2 ? ', each cut to ' + m2[1] + ' characters' : '') + '. ' +
          'A prompt runs over many lines, so it saw only its first line, the same opening sentence for every puzzle, and the start of each answer. ' +
          'It saw no examples, no test input and no correct answer, so these lines could not show it what went wrong.';
      } else {
        txt += 'No command that opened these logs was found in the trace.';
      }
      EX.h('p', { 'class': 'fxd-p' }, sec2, txt);
      if(T){
        var ex = (T.failure_log_excerpts || {})[P.task];
        if(ex){
          EX.h('div', { 'class': 'fxd-lbl fxd-mt' }, sec2, 'Everything it printed from this puzzle\'s log (line number, then the line)');
          codeBlock(sec2, ex, 'fxd-out', 'What the coach saw of this puzzle\'s log');
        }
        EX.h('p', { 'class': 'fxd-p fxd-quiet fxd-mt' }, sec2, 'The same command also printed the puzzle README, the helper code and lines of the scoring code. Its reasoning summary for that turn is mostly about those.');
        thoughts(sec2, T.reasoning_summary, { label: 'Its reasoning summary in that turn' });
        EX.h('div', { 'class': 'fxd-lbl fxd-mt' }, sec2, 'The command it ran');
        codeBlock(sec2, T.tool_command, 'fxd-cmd', 'Command in turn ' + T.turn);
        collapse(sec2, 'Show everything the command printed', function(b){
          if(T.tool_output_note) EX.h('div', { 'class': 'fxd-note' }, b, 'Shortened here: ' + T.tool_output_note + '. The coach saw all of it.');
          codeBlock(b, T.tool_output || '', 'fxd-out', 'Output of turn ' + T.turn);
        });
      }
    }

    function stepEdit(P, z){
      var CR = D.coach_round, turns = CR.turns || [];
      var names = TURN_NAMES[CR.round] || {};
      head('The coach edits the player\'s code. First what it changed, then how it got there.');

      var sec = EX.h('div', { 'class': 'fxd-sec fxd-edit' }, body);
      EX.h('div', { 'class': 'fxd-subh' }, sec, 'What it changed');
      var summary = String(CR.editor_summary || '').replace(/^Editor's summary:\s*/i, '');
      EX.h('p', { 'class': 'fxd-p fxd-summary' }, sec, summary ? cap(summary) : 'No summary of the edit was written.');
      EX.h('div', { 'class': 'fxd-src' }, sec, 'Our plain-language summary of the code change.');
      var EQ = EDIT_QUOTE[CR.round], qt = EQ && turns[EQ.turn - 1];
      if(qt && EQ.parts.every(function(x){ return (qt.reasoning_summary || '').indexOf(x) >= 0; })){
        var qd = EX.h('div', { 'class': 'fxd-mt' }, sec);
        EX.h('div', { 'class': 'fxd-lbl' }, qd, 'Why, in its reasoning summary (turn ' + EQ.turn + ')');
        EX.h('blockquote', { 'class': 'fxd-quote' }, qd, '“' + EQ.parts.join(' … ') + '”');
      }
      if(CR.practice_score_before != null && CR.practice_score_after_child_eval != null){
        var R0 = P.repeats || {};
        EX.h('p', { 'class': 'fxd-p fxd-mt' }, sec, 'On the 25 practice puzzles the original player scored ' + fmt.pct(CR.practice_score_before, 0) +
          '. In the round\'s own check of the edited player it scored ' + fmt.pct(CR.practice_score_after_child_eval, 0) +
          ': one puzzle more, from one run each, which is within run-to-run noise. In that check it ' +
          (R0.edited_child_eval_solved ? 'solved' : 'missed') + ' this puzzle.');
      }
      EX.more(sec, 'Show code change', function(b){
        var pre = EX.h('pre', { 'class': 'code diff tall fxd-diff', tabindex: '0', 'aria-label': 'Code change' }, b);
        String(CR.diff || '').split('\n').forEach(function(line){
          var cls = /^(\+\+\+|---|diff |index )/.test(line) ? 'meta' : line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line.indexOf('@@') === 0 ? 'hunk' : '';
          EX.h('span', { 'class': 'ln ' + cls }, pre, line || ' ');
        });
      });

      var sec2 = EX.h('div', { 'class': 'fxd-sec' }, body);
      EX.h('div', { 'class': 'fxd-subh' }, sec2, 'How it got there, in ' + turns.length + ' turns');
      EX.h('p', { 'class': 'fxd-p fxd-quiet' }, sec2, 'In each turn the coach reasons, then may run one command on the player\'s code. Turn names are our labels for each command. Reasoning summaries are shown as the API returned them; they are lossy and sometimes garbled.');
      var tl = EX.h('ol', { 'class': 'fxd-timeline' }, sec2);
      turns.forEach(function(t){
        var li = EX.h('li', { 'class': 'fxd-turn' }, tl);
        EX.h('div', { 'class': 'fxd-turnh' }, li, 'Turn ' + t.turn + (names[t.turn] ? ': ' + names[t.turn] : ''));
        if(t.reasoning_summary && t.reasoning_summary.trim()) thoughts(li, t.reasoning_summary, { lines: 4 });
        else EX.h('div', { 'class': 'fxd-none' }, li, 'No reasoning summary came back for this turn.');
        if(t.visible_message && t.visible_message.trim()){
          EX.h('div', { 'class': 'fxd-lbl fxd-mt' }, li, 'It wrote');
          EX.h('div', { 'class': 'fxd-said', html: mdHTML(t.visible_message) }, li);
        }
        if(t.tool_command){
          collapse(li, t.tool_output ? 'Show the command and what it printed' : 'Show the command', function(b){
            EX.h('div', { 'class': 'fxd-lbl' }, b, 'The command it ran');
            codeBlock(b, t.tool_command, 'fxd-cmd', 'Command in turn ' + t.turn);
            if(t.tool_output){
              EX.h('div', { 'class': 'fxd-lbl fxd-mt' }, b, 'What it printed' + (t.tool_output_note ? ' (shortened here: ' + t.tool_output_note + '; the coach saw all of it)' : ''));
              codeBlock(b, t.tool_output, 'fxd-out', 'Output of turn ' + t.turn);
            }
          });
        } else if(t.next_input_kind === 'harness_nudge' && t.tool_output){
          collapse(li, 'Show the reminder the harness sent back (the coach ran no command this turn)', function(b){
            codeBlock(b, t.tool_output, 'fxd-out', 'Reminder after turn ' + t.turn);
          });
        } else if(t.next_input_kind == null){
          EX.h('div', { 'class': 'fxd-none' }, li, 'The round ends here.');
        }
      });

      var others = D.other_rounds || [];
      if(others.length){
        var broke = others.filter(function(o){ return o.patch_bytes > 0 && o.practice_score_after_child_eval === 0; });
        var none = others.filter(function(o){ return !o.patch_bytes; });
        var bits = [];
        if(none.length) bits.push(word(none.length) + ' made no edit');
        if(broke.length) bits.push(word(broke.length) + ' broke the player so that it scored 0');
        EX.h('p', { 'class': 'fxd-p fxd-quiet' }, body, 'We ran ' + word(others.length + 1) + ' coaching rounds for this demo. Of the other ' +
          word(others.length) + ', ' + bits.join(' and ') + '. This is the only one that changed the player without breaking it.');
      }
    }

    function stepAgain(P, z){
      var CR4 = D.coach_round, R4 = P.repeats || {};
      head('The edited player gets the same puzzle and the same two tries. This is a separate run made after the round' +
        (CR4.practice_score_after_shown_run != null ? ' (it scored ' + fmt.pct(CR4.practice_score_after_shown_run, 0) + ' on the practice puzzles)' : '') +
        '; in the round\'s own practice check (' + fmt.pct(CR4.practice_score_after_child_eval, 0) + ') the edited player ' +
        (R4.edited_child_eval_solved ? 'solved' : 'missed') + ' this puzzle.');
      var review = null;
      (P.after.calls || []).forEach(function(c){
        var m = /(A previous attempt proposed[\s\S]*)$/.exec(c.prompt_summary || '');
        if(m && !review) review = m[1].replace(/\[grid \d+x\d+\]/, '[its first answer]').trim();
      });
      if(review){
        var q = EX.h('div', { 'class': 'fxd-sec fxd-review' }, body);
        EX.h('div', { 'class': 'fxd-lbl' }, q, 'New since the edit: try 2 is a review. Its prompt ends with');
        EX.h('blockquote', { 'class': 'fxd-quote' }, q, review);
      }
      testRow(body, P, z);
      reading(body, P, 'after');
      var truth = P.test[0].output, notes = [];
      var b0 = (P.before.calls || [])[0], a0 = (P.after.calls || [])[0];
      if(b0 && a0 && isGrid(a0.parsed_grid) && !a0.parsed_correct && EX.gridsEqual(a0.parsed_grid, b0.parsed_grid))
        notes.push('Try 1 gave the same wrong grid that try 1 gave before the edit. It\'s a new call that happened to land on the same answer.');
      var ob = bestOff(P.before, truth), oa = bestOff(P.after, truth);
      if(!P.after.solved && ob != null && oa != null && oa > ob)
        notes.push('Its closest answer is further off than before the edit: ' + plural(oa, 'cell') + ' off, against ' + ob + ' before.');
      notes.forEach(function(n){ EX.h('p', { 'class': 'fxd-p fxd-quiet' }, body, n); });
      attempt(body, P.after, P, z, true);
    }

    function stepHold(P, z){
      var R = P.repeats || {};
      head('Runs are not deterministic: the same player can solve a puzzle once and miss it the next time. So we ran each player on this puzzle ' + word(R.A0_runs || 0) + ' more times.');
      function runsOf(main, detail){
        var out = [{ solved: !!main.solved, label: 'Run shown', calls: main.calls || [], sent: (main.submitted || []).length }];
        (detail || []).forEach(function(r, i){ out.push({ solved: !!r.solved, label: 'Repeat ' + (i + 1), calls: r.calls || [], sent: (r.submitted_correct || []).length }); });
        return out;
      }
      var editedRuns = runsOf(P.after, R.edited_runs_detail);
      if(R.edited_child_eval_solved != null) editedRuns.push({ solved: !!R.edited_child_eval_solved, label: 'Round\'s check', calls: [], untraced: true });
      var rows = [
        { name: 'Original player', runs: runsOf(P.before, R.A0_runs_detail) },
        { name: 'Edited player', runs: editedRuns }
      ];
      var tbl = EX.h('div', { 'class': 'fxd-hold' }, body);
      rows.forEach(function(row){
        var k = row.runs.filter(function(r){ return r.solved; }).length;
        var line = EX.h('div', { 'class': 'fxd-holdrow' }, tbl);
        var nm = EX.h('div', { 'class': 'fxd-holdname' }, line);
        EX.h('div', { 'class': 'fxd-subh' }, nm, row.name);
        EX.h('div', { 'class': 'fxd-holdk' }, nm, 'solved in ' + k + ' of ' + row.runs.length + ' runs');
        var marks = EX.h('ul', { 'class': 'fxd-runs' }, line);
        row.runs.forEach(function(r){
          var li = EX.h('li', { 'class': 'fxd-run' }, marks);
          EX.h('span', { 'class': 'fxd-runmark ' + (r.solved ? 'ok' : 'no'), 'aria-hidden': 'true' }, li, r.solved ? '✓' : '×');
          EX.h('span', { 'class': 'fxd-runlab' }, li, r.label);
          EX.h('span', { 'class': 'sr-only fxd-sr' }, li, r.solved ? ': solved' : ': not solved');
        });
        row.k = k;
      });

      var a = rows[0], b = rows[1];
      function onTry2(r){ return r.solved && r.calls.length > 1 && r.calls[0].parsed_correct === false && r.calls[1].parsed_correct === true; }
      function onTry1(r){ return r.solved && r.calls.length && r.calls[0].parsed_correct === true; }
      var traced = b.runs.filter(function(r){ return !r.untraced; });
      var reviewFixes = traced.filter(onTry2).length;
      var sent = 'The original player solved this puzzle in ' + a.k + ' of ' + a.runs.length + ' runs; the edited player in ' + b.k + ' of ' + b.runs.length + '.';
      if(b.k > 0 && reviewFixes === b.k) sent += ' Every one of the edited player\'s solves came the same way: try 1 was wrong and the review in try 2 fixed it.';
      var a1 = a.runs.filter(onTry1).length, a2 = a.runs.filter(onTry2).length;
      if(b.k === 0){
        var oneSent = traced.filter(function(r){
          return r.calls.length > 1 && r.calls[1].parsed_correct === false && r.sent === 1;
        }).length;
        if(oneSent) sent += ' In ' + (oneSent === traced.length ? 'all ' + word(oneSent) : word(oneSent) + ' of the ' + word(traced.length)) +
          ' traced runs of the edited player, the review returned the same wrong grid as try 1, so it sent one answer instead of two.';
        if(a2) sent += ' The original player\'s ' + (a2 === 1 ? 'one solve' : 'solves') + ' came from its second try, an independent attempt that the edit replaced with the review.';
      } else if(a.k > 0 && a1 === a.k){
        sent += ' The original player\'s ' + (a.k === 1 ? 'one solve' : 'solves') + ' came on try 1.';
      }
      EX.h('p', { 'class': 'fxd-p fxd-holdtext' }, body, sent);
      if(b.runs.some(function(r){ return r.untraced; }))
        EX.h('p', { 'class': 'fxd-src' }, body, '"Round\'s check" is the edited player\'s run in the coaching round\'s own practice check (72% overall); only its score is shown here.'
          .replace('72%', fmt.pct(D.coach_round.practice_score_after_child_eval, 0)));
      EX.h('p', { 'class': 'fxd-p fxd-quiet' }, body, 'With ' + word(a.runs.length) + ' or ' + word(b.runs.length) + ' runs each, and two puzzles picked to illustrate, this shows how the edit works, not whether it helps on average.');
      var M = D.meta || {};
      if(M.demo_cost_usd_total != null) EX.h('p', { 'class': 'fxd-src' }, body, 'This traced demo cost ' + fmt.usd(M.demo_cost_usd_total) + ' in model calls. It is not part of the experiment\'s results.');
    }

    var headEl = null;
    function head(text){ headEl.textContent = text; }

    function render(){
      var z = sizes();
      root.classList.toggle('narrow', z.narrow);
      stepBtns.forEach(function(b, i){
        if(i === st.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
        b.classList.toggle('done', i < st.step);
      });
      back.disabled = st.step === 0;
      next.textContent = st.step < STEPS.length - 1 ? 'Next: ' + STEPS[st.step + 1].label.toLowerCase().replace(/^the /, '') + ' →'
        : (st.tab < TABS.length - 1 ? 'See the puzzle that stayed wrong →' : 'Back to the start');
      stageHead.innerHTML = '';
      EX.h('div', { 'class': 'fxd-stepnum' }, stageHead, 'Step ' + (st.step + 1) + ' of ' + STEPS.length);
      EX.h('div', { 'class': 'fxd-steptitle' }, stageHead, STEPS[st.step].label);
      headEl = EX.h('p', { 'class': 'fxd-lead' }, stageHead);
      body.innerHTML = '';
      if(!D) return;
      var P = D.puzzles.filter(function(p){ return p.kind === TABS[st.tab].kind; })[0];
      if(!P){ EX.h('div', { 'class': 'empty' }, body, 'This puzzle is missing from demo.json.'); return; }
      [stepTry, stepRead, stepEdit, stepAgain, stepHold][st.step](P, z);
    }

    var lastW = 0;
    ctx.onResize(function(){ var w = root.clientWidth; if(w !== lastW){ lastW = w; render(); } });

    return EX.load('demo').then(function(d){
      D = d;
      var cav = (D.meta || {}).caveats || [];
      if(cav.length){
        var cd = EX.h('details', { 'class': 'fxd-coll fxd-caveats' }, root);
        EX.h('summary', null, cd, 'Notes on these traces');
        var ul = EX.h('ul', { 'class': 'fxd-cavlist' }, cd);
        cav.forEach(function(c){ EX.h('li', null, ul, c); });
      }
      lastW = root.clientWidth;
      render();
    });
  });
})();

# Page text: EditHunt

Edit the text under each `[[id]]` line. Do not change or remove the `[[id]]` lines.

Rules for the writer:
- Formatting you can use: **bold**, *italic*, `code`, [text](link). Nothing else.
- Math is written between `\(` and `\)`, for example `\(h\)`. Keep it exactly as written; you may move it within its block.
- One paragraph per block (no blank lines inside a block).
- Keep every number exactly as written. You may move a number within its block.
- `[^N]` marks where side note N attaches; its text is in its own `[[fn.N]]` block. Keep the markers.
- Links like `[1](#ref-marks)` are citations. Keep them.
- Blocks marked `(short)` are labels or titles: keep them short.
- Blocks marked `(new)` were added in this round and have not been through a rewrite yet.
- Not in this file (data, not prose): the prompt tokens in Figure 1, the tool-call snippets in Figure 5, the table rows and column headers in Figure 6, the equations in the two "definitions" boxes, and the reference list.

---

## Top

[[title]]  (short)
Can an AI agent find and undo a secret edit inside a model?

[[dek.1]]
Someone has quietly tampered with a small language model. Ask it which state Fargo is in and it still says North Dakota. Ask for the capital, though, and it now says Nashville. We give an AI agent the edited model and a set of tools for looking inside it, but *not* the original. Its job: find what was changed and put the model back the way it was.

[[dek.2]]
Short answer: sometimes. With no hint about how, the strongest agent came up with a real interpretability method (a way of working out what's going on inside a model) on its own. It compared the model's internal activity layer by layer, found the edit, estimated it almost exactly and removed it. Its best run got there in 10 turns for about 7 cents. But no agent ever undid a model with two hidden edits, and more than half of the correct fixes agents found were lost before they submitted.

[[hl.r1]]  (short) (new)
Patch the answers back

[[hl.r2]]  (short) (new)
Find and invert the edit

[[hl.note]]  (new)
How much of the original model each approach gets back, best case over the hidden edits (0 = still edited, 1 = fully restored). Fixing the outputs is not enough: you have to look inside.

[[facts]]
Edited model: Qwen2.5-1.5B (the earlier experiments also use Qwen2.5-3B, Qwen2.5-7B and gemma-2-2b). Agents: gpt-6.1-sol and gpt-6-luna, with Claude Sonnet 5.5 on the earlier tasks. September to November 2026.

[[jump]]
Jump to: [What we found](#found) · [The secret edit](#plant) · [Why it's hard](#hard) · [What the agent did](#recipe) · [Where agents fail](#fail) · [Every run](#runs)

---

## What we found

[[found.h]]  (short) (new)
What we found

[[found.1]]  (new)
**Agents can do real interpretability work unprompted.** gpt-6.1-sol passed 5 of 24 runs with no hint about method, using a model-diffing approach it worked out for itself. Its best run had a passing fix by turn 10, for about $0.07.

[[found.2]]  (new)
**The stronger model looks inside; the weaker one doesn't.** gpt-6-luna passed 0 of 8. It averaged activations about 7.5 times per run, against 51 for gpt-6.1-sol.

[[found.3]]  (new)
**No agent undid two edits.** On instances with two hidden edits, 0 of 8 runs passed: agents fixed the first edit and stopped looking.

[[found.4]]  (new)
**Good fixes get lost.** Without the original model, agents can't rank their own fixes. Submitting the best edit each agent had already tested would have passed 9 of 16 runs instead of 4.

---

## Why build this

[[why.h]]  (short) (new)
Why build this task

[[why.p1]]  (new)
When a model changes, through fine-tuning, bad training data or deliberate tampering, we want to know exactly what changed. Auditing a model for a hidden change is slow work for people, and it is hard to tell whether an audit found everything. Recent work turns this into a game: researchers plant a known problem in a model and measure whether auditors, human or AI, can find it [1](#ref-marks) [2](#ref-bricken).

[[why.p2]]  (new)
EditHunt is a small, fully checkable version of that game, built as a training environment for agents. Because we planted the edit ourselves, the grader can measure exactly how close the agent's fix comes to the original model, with no human or AI judge. And the task is built so that watching the model's answers is not enough: the agent has to find what changed inside.

---

## 1. Where the fact lives

[[where.h]]  (short)
First, where does the model keep the answer?

[[where.p1]]
Ask a model to finish "The state containing Dallas has its capital in" and it says "Austin". To get there it has to make two hops: Dallas → Texas, then Texas → Austin. If the model really works out "Texas" somewhere along the way, we should be able to find that spot and change it.

[[fig.prompt.title]]  (short)
The middle step sits on the city's token, then moves to the end of the sentence.

[[fig.prompt.text]]
A model passes text through a stack of layers, keeping a running internal state for each token (a word or piece of a word). It works out the state at the city's position. Later, at what we call the handoff layer, attention copies that information to the last position, where the capital is chosen.

[[fig.prompt.b1.h]]  (short)
early layers

[[fig.prompt.b1]]  (short)
"Dallas" is recognised

[[fig.prompt.b2.h]]  (short)
middle layers, at "Dallas"

[[fig.prompt.b2]]  (short)
state = Texas is computed and held here

[[fig.prompt.b3.h]]  (short)
handoff, at "in"

[[fig.prompt.b3]]  (short)
Texas is copied to the last token; the capital is picked

[[fig.prompt.caption]]
**Figure 1**: the two-hop prompt. The state sits at the city's last token until the handoff layer.

[[where.p2]]
Here's how we tested that. We took the model's average activations (its internal numbers at a given layer) on the city's last token for California cities, subtracted the average for Texas cities, and added that difference to Texas cities that weren't used to build it. Across a wide band of middle layers, the model starts answering "Sacramento". A random push of the same size almost never does (at most 5% of cities). The same pattern shows up in all four models we tried, and in each one it stops abruptly at a fixed layer: the **handoff**, where the information has already moved to the end of the sentence.

[[fig.curves.title]]  (short)
One "state" direction works in all four models, until the handoff.

[[fig.curves.text]]
Share of held-out cities whose answer flips to the other state's capital, by layer. Hover over or tap the chart to read each model's value at that depth.

[[fig.curves.caption]]
**Figure 2**: flip rate by layer, shown as a fraction of the model's depth. Dots mark each model's handoff layer. About 105 held-out cities per point.

[[where.p3]]
This direction means "this city is in California", not just "say Sacramento": it also changes the answer to "Which US state is X in?" (95–98% of the time). That matters for what comes next. Since we know where the state lives and what it looks like, we can plant an edit there and grade an exact undo.

---

## 2. The secret edit

[[plant.h]]  (short)
Planting the edit

[[plant.p1]]
We plant a hidden edit in Qwen2.5-1.5B so that cities in one state (say, Minnesota) answer as if they were in another (Tennessee). The edit works like a small switch. It watches for the model's own internal sense of "this is Minnesota" and, when it sees it, nudges the activations toward Tennessee. Because it reacts to the model's internal representation rather than to a list of cities, it also fires a little on neighbouring places like North Dakota and Ontario border towns. That leak is how the agent can spot it.

[[plant.gate.lead]]  (new)
Concretely, at one layer the plant adds a push \(v\) to the activation \(h\) at every token, scaled by a gate that reads how strongly \(h\) points along the model's own direction for the source state, \(k\):

[[plant.gate.after]]  (new)
The gate stays at 0 on ordinary text and rises to 1 on cities the model firmly places in the source state. Every instance is built this way; what changes is the push \(v\), the layer, and how many plants there are.

[[fig.plant.title]]  (short)
Four kinds of hidden edit, from one layer to two separate edits.

[[fig.plant.text]]
Each instance hides one of these, and the agent isn't told which.

[[plant.kind.hop2]]
**Capital only** (layer 8). The capital changes but the state answer doesn't, so the model still says Fargo is in North Dakota.

[[plant.kind.state]]
**Whole state** (layer 16). The city now behaves as if it were in the other state, whatever you ask.

[[plant.kind.spread]]
**Spread** (layers 8, 9 and 10). The same push split across three layers, so there's no single spike to find.

[[plant.kind.two]]
**Two edits** (layers 8 and 14). Two different states moved at two different layers.

[[fig.plant.caption]]
**Figure 3**: the four plant types. Two state pairs each, eight instances in total.

[[plant.p2]]
The agent gets tools to run prompts, read activations at any layer, average them over groups of cities, combine vectors and test an edit. It has 150 turns and 12,000 forward passes (a forward pass is one run of the model on one input). It doesn't get the original model, the test cities, or the prompts used for grading. It submits an edit, which can switch itself on and off the same way the plant does.

[[plant.p3]]
The score is **restoration**: how much of the gap between the edited model and the original the agent closed. We measure it on held-out cities from the affected state, cities from other states and ordinary text. Doing nothing scores 0, a perfect undo scores 1, and breaking things that were never edited counts against you. To pass, an agent has to reach 80% of what a privileged solver gets.[^1]

[[fn.1]]  (new)
The solver is given the true plant and subtracts the same gated push at the same layer. It scores 0.84–0.98 across instances, so it is the bar to measure against, not a perfect score.

[[formal.summary]]  (short) (new)
The definitions, precisely

[[formal.plant.h]]  (short) (new)
The plant

[[formal.plant.p]]  (new)
At layer \(L\), at every token position, with \(k\) the source-state direction, \(b\) and \(w\) setting where the gate opens, and \(v\) the push:

[[formal.R.h]]  (short) (new)
Restoration

[[formal.R.p]]  (new)
Over a private set of prompts \(X\) (held-out affected cities, cities from other states and ordinary text, each in 9 contexts), comparing next-token distributions of the original, planted and fixed models:

[[formal.pass.h]]  (short) (new)
Passing

[[formal.pass.p]]  (new)
We call an instance hard when no fixed script scores more than half the solver's score. Only one of the eight meets that bar: the North Carolina two-edit instance.

---

## 3. Why it's hard

[[hard.h]]  (short) (new)
Why this is hard

[[hard.p1]]  (new)
The task is easy to state. Five things make it hard to do.

[[hard.1]]  (new)
**There is no original to compare against.** The agent only ever sees the edited model. Every check it runs tells it how far a fix moves the *edited* model, not how close it gets to the original.

[[hard.2]]  (new)
**The test cities are hidden.** The agent never sees the cities used for grading, including every city in the affected state. It has to find the edit through the little it leaks onto neighbouring places.

[[hard.3]]  (new)
**"Correct" answers are the wrong target.** The original model was never perfect, so making the edited model give real-world capitals again does not restore it (Figure 4).

[[hard.4]]  (new)
**The edit can hide in more than one place.** It can be split across three layers, or there can be two separate edits, and the agent isn't told which.

[[hard.5]]  (new)
**A fixed recipe is not enough.** Four short model-diffing scripts (automated recipes for hunting down what changed) each solve some single-edit instances, but none gets close on the two-edit ones (0.41–0.49, against a solver at 0.87–0.94).

[[fig.proxy.title]]  (short)
Fixing the answers is not the same as fixing the model.

[[fig.proxy.text]]
The obvious approach is to train an edit that makes the wrong answers right again. It recovers very little, because "right" means right in the real world, and the original model was never perfect to begin with. Inverting the mechanism recovers almost everything.

[[fig.proxy.bar1]]  (short)
Patch the answers

[[fig.proxy.bar2]]  (short)
Invert the edit

[[fig.proxy.caption]]
**Figure 4**: range of restoration across the plant types, for an edit trained to patch answers back to the truth and for an edit that inverts the plant.

[[hard.p2]]
That gap is the point of the task. An agent can't pass by looking at outputs alone; it has to find what changed inside the model.

---

## 4. What the agent did

[[recipe.h]]  (short)
What a successful agent did, unprompted

[[recipe.p1]]
The task gives no hint about method. Even so, every passing run of gpt-6.1-sol followed the same five steps. Below is its best run, on the capital-only Minnesota → Tennessee plant. It had a passing edit by turn 10, after 231 forward passes and about $0.07, and its final submission scored 0.978 against a solver at 0.983.

[[fig.recipe.title]]  (short)
Five steps from symptom to fix.

[[fig.recipe.text]]
Click a step to see what the agent actually called and what came back.

[[recipe.s1.name]]  (short)
Find symptoms

[[recipe.s1.text]]
The Minnesota cities are kept private, so the agent swept cities from nearby states and caught the edit leaking: Fargo, North Dakota now has its capital in Nashville.

[[recipe.s2.name]]  (short)
Find the layer

[[recipe.s2.text]]
For each layer, it measured how much the activations change at that layer for affected cities compared with unaffected ones. One layer stands out: in a sister run, the extra jump at layer 8 measured 38.2, against 13.4 at layer 7. This is model diffing without the original model, with the unaffected cities standing in for it.

[[recipe.s3.name]]  (short)
Estimate the edit

[[recipe.s3.text]]
That same difference is an estimate of what was added. Averaging it over more cities and several ways of phrasing the question made it stable. Separate estimates agreed with each other, and across the passing runs the estimate closely matched the true planted vector: a cosine similarity of 0.93–0.97, where 1 would mean pointing in exactly the same direction.

[[recipe.s4.name]]  (short)
Build the undo

[[recipe.s4.text]]
Measuring how far each city points along that direction splits them cleanly: about 0 for unaffected cities, about 54 for fully affected ones, and values in between for cities the plant only partly reaches. The agent subtracted the direction wherever it shows up, capped at 55, so the fix only switches on where the plant did.

[[recipe.s5.name]]  (short)
Check it

[[recipe.s5.text]]
It tested the fix on the edited model. Affected cities flip back to a sensible capital, unaffected cities don't move, ordinary text barely changes, and the state answers stay put.

[[fig.recipe.caption]]
**Figure 5**: the winning route, with real tool calls and outputs from one run. Every clean pass used this route; none got its winning direction by training it with the optimizer.

[[formal2.summary]]  (short) (new)
The agent's method, precisely

[[formal2.diff.h]]  (short) (new)
Finding the layer

[[formal2.diff.p]]  (new)
With \(\bar a_L\) the average activation at layer \(L\) over affected cities and \(\bar c_L\) the same over unaffected ones, the agent looked for the layer where this extra jump spikes. Normalised, it is the estimate \(u\) of the push:

[[formal2.undo.h]]  (short) (new)
The undo

[[formal2.undo.p]]  (new)
A gate keyed on the estimate itself, so it only opens where the plant wrote. In the best run, \(s = 55\), \(\ell = 1\), \(\mathrm{hi} = 56\):

[[recipe.p2]]
In three runs, on two different instances, the best edit an agent tested actually scored higher than the privileged solver that inverts the true plant.

---

## 5. Where agents fail

[[fail.h]]  (short)
Where agents fail

[[fail.p1]]
The failures teach as much as the successes. They fall into four groups.

[[fail.two.h]]  (short)
They stop after one edit.

[[fail.two.p]]
On two-edit instances, every run found one plant, fixed it and submitted. None went back to check whether anything else was off. A perfect fix of one plant tops out around 0.60, below the bar. Part of this is on the environment: the second edit's state could only be probed through private cities, which the tools skipped without saying so.

[[fail.select.h]]  (short)
They can't tell which fix is best.

[[fail.select.p]]
Without the original model, an agent can only measure how far its fix moves the *edited* model. That separates broken fixes from working ones, but it can't rank the working ones. In one run, the agent held an edit scoring 0.964 and submitted a different one scoring 0.762. Three runs tried to "polish" a good edit at the end with the optimizer (automatic training toward the right answers), and it made things worse every time (0.959 → 0.921, 0.975 → 0.928, 0.964 → 0.762). The optimizer pushes toward real-world answers, not toward the original model's answers.

[[fail.spread.h]]  (short)
Spread edits have no spike.

[[fail.spread.p]]
When the push is split over three layers, there's no single jump to find. On the Minnesota spread instance, agents went 0 for 5. They either latched onto layer 5, where the model naturally forms the state, or patched too late.

[[fail.weak.h]]  (short)
The weaker model doesn't diff.

[[fail.weak.p]]
gpt-6-luna passed 0 of 8. It averaged activations about 7.5 times per run, compared with 51 for gpt-6.1-sol, and leaned on the optimizer instead. It often mistook noise or spill-over for the plant, and in 5 of 8 runs it never queried a single city from the affected state that it was allowed to see.

[[fail.p2]]
One failure was ours. Each run had a $0.90 cost limit that the agent couldn't see. Because every turn resends the whole conversation, the limit hit around turns 80–120, while the agent still thought it had dozens of turns left. Seven runs were holding a passing edit when they were cut off. An agent that had simply submitted its best tested edit would have passed 9 of 16 runs instead of 4.

---

## 6. Every run

[[runs.h]]  (short)
Every run

[[runs.p1]]
Each row is one hidden-edit instance. Scores are restoration; the pass bar is 80% of the solver's score.

[[runs.key.pass]]  (short)
passed

[[runs.key.held]]  (short)
holding a passing edit when cut off

[[runs.key.fail]]  (short)
below the bar

[[fig.runs.caption]]
**Figure 6**: all v0.2 runs. "Cut off" means the hidden cost limit stopped the run; the number in brackets is the best edit it had tested by then.

---

## 7. How we got here

[[path.h]]  (short)
How we got here

[[path.p1]]
T8 is the last in a series of tasks. Each earlier one taught us what makes a task worth training an agent on: it should be solvable, not solvable by a fixed script, and leave room between a typical agent and the best one.

[[path.t1]]
**Flip the capital (T1).** Too easy: Claude Sonnet 5.5 passed 8 of 8 with the obvious average-difference recipe in 4–6 turns.

[[path.t2]]
**Flip the capital but keep the state (T2).** Hard at first (Sonnet passed 1 of 7), but then a fixed recipe turned out to solve it, and the room left above that recipe was smaller than the grader's noise. We kept it as a warm-up.

[[path.t8]]
**Undo a hidden edit (T8).** Built so the obvious approach fails and the right method depends on the instance. This is the one that separates agents.

[[path.p2]]
Along the way, we screened other attribute-editing tasks in the style of the RAVEL benchmark [3](#ref-ravel) (changing one fact about a city or other entity). Only one more cleared the bar (a city's language, on gemma-2-2b), and only just.

---

## 8. Caveats

[[cav.h]]  (short)
What this does and doesn't show

[[cav.1]]
**Small numbers.** Two runs per instance for gpt-6.1-sol, one for gpt-6-luna, and eight instances. Several pass margins are within the grader's noise.

[[cav.2]]
**Reasoning wasn't logged.** Anything we say about *why* an agent did something is inferred from its tool calls.

[[cav.3]]
**Our cost limit cut off winning runs.** The next version shows the remaining budget and logs reasoning.

[[cav.4]]
**One model, one kind of fact.** All T8 instances use Qwen2.5-1.5B and state capitals. And now that the method for single edits is known, a trained policy could just memorize it. The task needs a generator that keeps producing new kinds of plants.

---

## Footer

[[foot.links]]
Code, data and full results: [GitHub](https://github.com/dianhaoli/edit_hunt)

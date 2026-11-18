# Page text: EditHunt

Edit the text under each `[[id]]` line. Do not change or remove the `[[id]]` lines.

Rules for the writer:
- Formatting you can use: **bold**, *italic*, `code`, [text](link). Nothing else.
- One paragraph per block (no blank lines inside a block).
- Keep every number exactly as written. You may move a number within its block.
- `[^N]` marks where footnote N attaches; footnote text is in its own `[[fn.N]]` block. Keep the markers.
- Blocks marked `(short)` are labels or titles: keep them short.
- Not in this file (data, not prose): the prompt tokens in Figure 1, the tool-call snippets in Figure 5, and the table rows and column headers in Figure 6.

---

## Top

[[title]]  (short)
Can an AI agent find and undo a secret edit inside a model?

[[dek.1]]
Someone has quietly tampered with a small language model. Ask it which state Fargo is in and it still says North Dakota. Ask for the capital, though, and it now says Nashville. We give an AI agent the edited model and a set of tools for looking inside it, but *not* the original. Its job: find what was changed and put the model back the way it was.

[[dek.2]]
Short answer: sometimes. With no hint about how, the strongest agent came up with a real interpretability method (a way of working out what's going on inside a model) on its own. It compared the model's internal activity layer by layer, found the edit, estimated it almost exactly and removed it. Its best run got there in 10 turns for about 7 cents. But no agent ever undid a model with two hidden edits, and more than half of the correct fixes agents found were lost before they submitted.

[[stat.1.num]]  (short)
0.43 vs 0.99

[[stat.1.label]]
Training the model to give the right answers again recovers at most 0.43 of the original model. Finding the edit and reversing it recovers up to 0.99. You have to look inside.

[[stat.2.num]]  (short)
5 / 24

[[stat.2.label]]
Runs passed by gpt-6.1-sol, the stronger agent. The weaker gpt-6-luna passed 0 of 8.

[[stat.3.num]]  (short)
0 / 8

[[stat.3.label]]
Runs that undid a model with two hidden edits. Agents fixed the first one and stopped looking.

[[facts]]
Edited model: Qwen2.5-1.5B (the earlier experiments also use Qwen2.5-3B, Qwen2.5-7B and gemma-2-2b). Agents: gpt-6.1-sol and gpt-6-luna, with Claude Sonnet 5.5 on the earlier tasks. September to November 2026.

[[jump]]
Jump to: [Where the fact lives](#where) · [The secret edit](#plant) · [What the agent did](#recipe) · [Where agents fail](#fail) · [Every run](#runs)

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
We plant a hidden edit in Qwen2.5-1.5B so that cities in one state (say, Minnesota) answer as if they were in another (Tennessee). The edit works like a small switch. It watches for the model's own internal sense of "this is Minnesota" and, when it sees it, nudges the activations toward Tennessee. Because it reacts to the model's internal representation rather than to a list of cities, it also fires a little on neighbouring places like North Dakota and Ontario border towns. That leak is how the agent can spot it.[^1]

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
The score is **restoration**: how much of the gap between the edited model and the original the agent closed. We measure it on held-out cities from the affected state, cities from other states and ordinary text. Doing nothing scores 0, a perfect undo scores 1, and breaking things that were never edited counts against you. To pass, an agent has to reach 80% of what a privileged solver gets. That solver knows the true plant and simply inverts it (it scores 0.84–0.98).

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

[[plant.p4]]
That gap is the point of the task. An agent can't pass by looking at outputs alone; it has to find what changed inside the model. We also checked that no fixed script solves everything. Four short model-diffing scripts (automated recipes for hunting down what changed) each solve some single-edit instances, but none gets close on the two-edit ones (0.41–0.49, against a solver at 0.87–0.94).

---

## 3. What the agent did

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

[[recipe.p2]]
In three runs, on two different instances, the best edit an agent tested actually scored higher than the privileged solver that inverts the true plant.

---

## 4. Where agents fail

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

## 5. Every run

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

## 6. How we got here

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
Along the way, we screened other attribute-editing tasks in the style of the RAVEL benchmark (changing one fact about a city or other entity). Only one more cleared the bar (a city's language, on gemma-2-2b), and only just.

---

## 7. Caveats

[[cav.h]]  (short)
What this does and doesn't show

[[cav.1]]
Small numbers: two runs per instance for gpt-6.1-sol, one for gpt-6-luna, and eight instances. Several pass margins are within the grader's noise.

[[cav.2]]
The agents' reasoning wasn't logged, so anything we say about *why* an agent did something is inferred from its tool calls.

[[cav.3]]
The hidden cost limit cut off runs that were winning. The next version shows the remaining budget and logs reasoning.

[[cav.4]]
All T8 instances use one model (Qwen2.5-1.5B) and one kind of fact. And now that the method for single edits is known, a trained policy could just memorize it. The task needs a generator that keeps producing new kinds of plants.

---

## Footer

[[foot.links]]
Code and full results: [GitHub](https://github.com/dianhaoli/edit_hunt) · [Findings](https://github.com/dianhaoli/edit_hunt/blob/main/FINDINGS.md) · [T8 transcript analysis](https://github.com/dianhaoli/edit_hunt/blob/main/analysis/t8_transcripts/T8_TRANSCRIPT_ANALYSIS.md) · [Dan Li](../)

[[fn.1]]
The plant is `h += clamp((k·h − b) / w, 0, 1) · v`, added at every position of one layer: `k` reads the model's own source-state direction, and `v` is the push.
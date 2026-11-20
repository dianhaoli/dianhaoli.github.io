# τ-forge write-up: all page text

Every word on the page lives here. Edit a block, then run `python3 build.py`.

Rules for rewriting:
- Keep the `[[id]]` lines exactly; only change the text under them.
- Inline formatting allowed: **bold**, *italic*, `code`, [link](url).
- Math is written as \( ... \) and must stay as is.
- `[^N]` places a side note; `[N](#ref-x)` is a citation. Keep both.
- Numbers come from docs/FACTS.md in the tau-forge repo. Do not round them differently.
- Not in this file: the bar values, the reward-ordering bars, the per-family chart and the "You are the agent" conversation. Those are data (figs.json, play.json).

---

# Header

[[title]]
No LLM in the loop

[[dek.1]]
I trained a 4B model with reinforcement learning on synthetic retail support tasks, where the customer was a short Python program, not a language model. Nothing in training called an LLM: not the task generator, not the customer, not the reward.

[[dek.2]]
The question: can a cheap, deterministic, scripted customer teach an agent skills that carry over to a benchmark where the customer *is* an LLM, one the agent never trained against?

[[hl.r1]]
Qwen3-4B, before RL

[[hl.r2]]
After 75 steps against the script

[[hl.note]]
pass@1 on all 114 held-out τ²-bench retail tasks, 4 trials each, with an LLM playing the customer. +8.1 points, 95% CI [+3.1, +13.4], permutation p = 0.005.

[[facts]]
Qwen3-4B-Instruct · LoRA GRPO · 1 × H100, ~11 h · 75 steps · 0 LLM calls in training · 114 real tasks never seen in training

[[jump]]
[What we found](#found) · [Play the agent](#play) · [The reward](#reward) · [What transferred](#transfer) · [The other customer](#other) · [Caveats](#caveats)

# Findings

[[found.h]]
What we found

[[found.1]]
**It transfers.** pass@1 on τ²-bench retail went from 53.1% to 61.2%. 40 tasks got better and 18 got worse, more ups than run-to-run noise produces under any null model we tried. The 114 real tasks never touched training: they entered the generator only as a reject list of user ids and end-state hashes.

[[found.2]]
**The biggest gains were on long tasks.** Tasks needing 4 or more database writes went from 21% to 42%, and changes of a user's address from 28% to 58%. That fits the script's strictest rule: no yes until you've read the order and said exactly what you'll do.

[[found.3]]
**It didn't transfer where the script is least like a person.** Exchanges hit 21 of 21 on synthetic validation and didn't move on τ² (71 of 116 both times). The script never gets vague, argues or wanders off its agenda; an LLM customer can.

[[found.4]]
**The LLM customer had a bug of its own.** In 62 of 456 conversations it said yes and hung up in the same message, before the agent could act, and every one scored zero. A single added sentence fixed it, and that fix moved the base model's pass^4 more than training did.

# Why a script

[[why.h]]
Why a scripted customer

[[why.p1]]
Every recent RL result on τ-bench that we found puts an LLM in the loop to play the customer [2](#ref-cove) [3](#ref-mua) [4](#ref-kih). That is expensive (one API call per customer turn, hundreds of turns per step), and it is noisy in a way that matters for the algorithm.

[[why.p2]]
GRPO runs the same task \(G = 8\) times and scores each attempt against the others. Its learning signal is the gap between one attempt's reward and the group's mean:

[[why.p3]]
If the customer replies differently to identical text, part of that gap is the customer, not the agent. A rule-based customer replies identically to identical text, so every difference inside a group comes from the agent. It also runs at the speed of Python, and it enforces the store's policy literally, which turns a 1,158-word policy document into something you can be rewarded for following.

[[why.p4]]
The tasks come from τ²-bench's [1](#ref-tau2) retail database alone (500 users, 1,000 orders, 50 products): 10 hand-written templates such as cancel, exchange and refuse-someone-else's-order, with randomized difficulty knobs like a late correction or a missing order id. Each task's gold action chain is replayed against the real tools before it is kept. The pool has 1,807 training tasks (1,410 after a prefilter) and 163 for validation.

# Play

[[play.h]]
Play the agent

[[play.p1]]
Here is one of the synthetic tasks. You are the support agent; the customer is the actual scripted program from training. Pick what the agent says or does next. Every reply and every score below was produced by running the real simulator and reward code on that choice, offline; nothing here is a JavaScript imitation.

[[fig.play.title]]
You are the agent

[[fig.play.text]]
Choose a move. The customer answers, the tool runs, and the conversation is scored when it ends.

[[fig.play.caption]]
**Figure 1.** One synthetic validation task, played through the real `ScriptedUser`, retail tool executor and `reward.py`. "What the customer understood" is the rule parser's reading of the agent's message. Try writing without asking first, or asking with a vague summary.

[[play.p2]]
The customer says yes only to a specific, correct proposal. Written out:

[[play.p3]]
The rule parser behind that check was measured on 162 held-out agent messages written by the untrained model: it spots a consent request 95.7% of the time and judges whether the details match 79.5% of the time, its weakest field. Repeating yourself three times or saying three things it can't parse ends the conversation, so the agent can't stall its way to a yes.

# Reward

[[reward.h]]
A reward you can unit-test

[[reward.p1]]
The reward never asks an LLM whether the agent did well. It hashes the final database and compares it to the gold end state, so any sequence of actions that lands in the right state scores. On top of that sit gates for the policy rules τ²'s grader can't see:

[[reward.p2]]
A success can be discounted but never drops below a failure, and partial credit for a failure is capped at 0.2 (0.3 on multi-request tasks), so the agent can't farm shaping. To pin this down we wrote scripted near-miss agents and made their ordering a test that runs with the rest of the suite:

[[fig.ref.title]]
Scripted agents and the reward they get

[[fig.ref.text]]
Each bar is a hand-written policy that makes one specific mistake. The tests fail if the ordering changes.

[[fig.ref.caption]]
**Figure 2.** Reward per reference agent, as specified in `reward.py` and checked in `tests/`. Re-running every reference agent on the 163 validation tasks reproduced each single-request score exactly; the perfect agent scores 1.0 on all 163.

[[reward.p3]]
The tests caught things RL would have learned. Before one fix, a canned refusal on the first turn, with no lookup at all, scored a full 1.0 on 200 of 200 refusal tasks. Another bug made foreign-order refusal look 79% solved when the real rate was 17%. Every audit fix was a shortcut the policy would otherwise have found.

# Transfer

[[transfer.h]]
What transferred, and what didn't

[[transfer.p1]]
We picked the checkpoint on synthetic validation only and ran τ² once. Broken down by the write tool each real task needs, the gains are uneven:

[[fig.tr.title]]
Success on τ² by the write a task needs

[[fig.tr.text]]
Each row is the set of real tasks whose gold actions include that tool. Hover for counts.

[[fig.tr.caption]]
**Figure 3.** τ²-bench retail success rate, base vs. trained, 4 trials per task. A task counts under every write tool it uses. Rows with few tasks have wide intervals.

[[transfer.p2]]
Synthetic validation was a poor guide to where the gains would land. Exchange went from 14 to 21 of 21 on validation and stayed flat on τ²; address changes didn't move on validation and gained the most on τ². And 24 of the 114 real tasks need a combination of writes that no synthetic task has; they gained more, not less (+14.6 vs +6.4 points), though that gap isn't significant.

[[transfer.p3]]
In the transcripts, the clearest behavioural change is more reading before acting: about 0.35 more lookups before the first write. Writes before authentication, writes without a yes and writes to the wrong record didn't change measurably.

# The other customer

[[other.h]]
The other customer had a bug too

[[other.p1]]
τ² plays the customer with an LLM that ends the chat by emitting `###STOP###`. In our first base-model run, it often agreed to an action and stopped in the same breath:

[[fig.two.title]]
Same agent message, two customers

[[fig.two.text]]
The agent asks for consent. Left: the LLM customer in τ². Right: what the scripted customer does with the same message.

[[fig.two.caption]]
**Figure 4.** Left: τ² task 26, trial 2, from the base model's first run, before the stop rule; the chat ends before the return is made and scores 0 (the same task is 4/4 with the rule). Right: the real scripted customer, run on a hand-built synthetic copy of task 26 and fed the identical agent message; it says yes, waits for the write, and only then stops.

[[other.p2]]
This happened in 62 of 456 conversations, across 45 tasks. We added one sentence to the customer's instructions:

[[other.rule]]
Never generate '###STOP###' in the same message in which you agree to, confirm, or answer a question about an action. After you confirm, wait for the agent's reply; end the conversation only once the agent has said your request is done or cannot be done, and you have nothing else to ask.

[[other.p3]]
With it, the count is 0 of 456 for both models. On its own it raised the base model's pass^4 by 10.5 points, more than training did (+7.9), and pass@1 by 4.6 (not significant on its own). Every number in this post uses the rule for both models. The scripted customer can't make this mistake by construction: it stops only after a write succeeds or the agent correctly refuses.

# Formal box

[[formal.summary]]
The definitions, written out

[[formal.pass.h]]
pass@1 and pass^k

[[formal.pass.p]]
Each task \(t\) is run \(n = 4\) times with \(c_t\) successes; a success means τ²'s reward is 1 (final database correct and every stated requirement met). pass@1 is the mean success rate. pass^k is the chance that \(k\) fresh trials of the same task all succeed, so pass^4 measures reliability, not just ability.

[[formal.grpo.h]]
The learning signal

[[formal.grpo.p]]
For a task \(q\), GRPO samples \(G = 8\) conversations \(o_1,\dots,o_G\) and gives each one an advantage relative to its group. We don't divide by the group's standard deviation (`scale_rewards=none`), use no KL penalty (\(\beta = 0\)) and the DAPO loss [5](#ref-dapo). Groups where all 8 rewards are equal carry no signal and are masked; 27% of groups were.

[[formal.consent.h]]
When the customer says yes

[[formal.consent.p]]
For a consent request \(m\) proposing write \(a\) on order \(o\), with \(o^\ast, d^\ast\) the task's true order and details:

[[formal.reward.h]]
The reward

[[formal.reward.p]]
For write tasks, with \(\mathrm{DB}_T\) the final database and \(g_j \in \{0, 0.3\}\) the gates (a write without a standing yes; a write while authenticated as the wrong user). Refusal and information tasks have their own small tables in `reward.py`.

# Caveats

[[cav.h]]
Caveats

[[cav.1]]
**One training seed, one evaluation run.** The pass@1 gain is significant; the pass^4 gain is borderline (+7.9 points, permutation p = 0.063).

[[cav.2]]
**Not comparable to published numbers.** Our evaluation customer is gpt-6-luna at temperature 1.0 plus the stop rule, not τ²'s default gpt-4.1 at temperature 0. CoVe [2](#ref-cove) reports a similar gain on the same base model with a different setup; we don't put the numbers side by side.

[[cav.3]]
**We haven't shown the script's interactivity is the cause.** The gain could come from the tasks and the database-state reward alone. The test is a degenerate customer that hands over every detail up front and says yes to anything, trained with everything else fixed. We haven't run it.

[[cav.4]]
**Decontamination is per task, not per distribution.** The templates were written by someone who had read τ²'s policy, so the task *types* overlap with the benchmark by design, even though no task, user or end state does.

# Footer

[[foot.links]]
Code, data, tests and every number in this post: [GitHub](https://github.com/dianhaoli/tau-forge)

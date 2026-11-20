"""Build two.json: one synthetic task, one agent, two customers.

The SAME tau-forge task (`ep_exchange_s11_00009`) and the SAME agent -- tau2's
own `LLMAgent` (stock retail system prompt + policy, the retail tools as
OpenAI function tools) on `gpt-4.1` at temperature 0 -- are played against

  * scripted: tau-forge's rule-based `ScriptedUser` (seed 0), exactly as in
    training: every agent turn goes through `runner.Episode.step` (tool calls
    rendered as the `<tool_call>{json}</tool_call>` blocks a policy completion
    uses, executed on a copy-on-write `CowEnv`), scored with
    `reward.score_episode`;
  * llm: tau2's own `UserSimulator` on `gpt-6-luna` at temperature 1.0, with
    tau2's user guidelines patched by tau-forge's `USER_STOP_RULE`
    (`run_tau2.patch_user_stop_rule`) and tau2-style structured instructions
    written from the task's hidden profile. Its history is seeded with the
    greeting and the scripted opening as if it had written that opening
    itself, so both conversations start identically; every later customer
    turn is the LLM's own. Tools run on a fresh `CowEnv`; success = final db
    hash == the task's gold hash.

Each condition runs N times (default 3); run 0 of each is the display run.

Usage:
    OPENAI_API_KEY=sk-dummy python make_two.py [--repo /home/user/tf-facts] [--runs 3]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
TASK_ID = "ep_exchange_s11_00009"
AGENT_MODEL = "gpt-4.1"
AGENT_ARGS = {"temperature": 0.0, "seed": 300}  # tau2 run's default seed
USER_MODEL = "gpt-6-luna"
USER_ARGS = {"temperature": 1.0}
MAX_TURNS = 30  # assistant messages, the runner's budget, applied to both conditions
MAX_CALLS = 30
SHORT = 200

REASON_FOR_CALL = (
    "You recently received an order that included Wireless Earbuds and a Garden Hose, and you want to exchange "
    "both items. You want the Wireless Earbuds with battery life 4 hours and the Garden Hose with material latex; "
    "for each item, only that option changes and every other option stays the same as the item you have now.\n"
    "When the agent first proposes the exact exchange and asks you to confirm it, change your mind: you want the "
    "Wireless Earbuds with battery life 8 hours instead (the Garden Hose still with material latex, every other "
    "option unchanged). Once the agent has proposed the corrected exchange, confirm it."
)
KNOWN_INFO = (
    "You are Ivan Santos, zip code 75277. Your email is ivan.santos3158@example.com.\n"
    "You want to pay any price difference with your PayPal account."
)
UNKNOWN_INFO = (
    "You do not remember the order number. You know the order only by its products: it is the one with the "
    "Wireless Earbuds and the Garden Hose."
)
TASK_INSTRUCTIONS = (
    "Only say that you want to use your PayPal account if the agent asks how you want to pay. "
    "Do not volunteer the change to 8 hours before the agent proposes the exact exchange."
)


def short(s: Optional[str], n: int = SHORT) -> Optional[str]:
    if s is None:
        return None
    return s if len(s) <= n else s[: n - 3] + "..."


def render_completion(am) -> str:
    """The agent message as the policy completion text runner.Episode parses."""
    parts = [am.content] if am.content else []
    for tc in am.tool_calls or []:
        parts.append("<tool_call>\n" + json.dumps({"name": tc.name, "arguments": tc.arguments}) + "\n</tool_call>")
    return "\n".join(parts)


def agent_entry(am) -> dict[str, Any]:
    e: dict[str, Any] = {"role": "agent", "text": am.content or ""}
    if am.tool_calls:
        e["tool_calls"] = [{"name": tc.name, "arguments": tc.arguments} for tc in am.tool_calls]
    return e


def tool_input(am, contents: list[str]):
    from tau2.data_model.message import MultiToolMessage, ToolMessage

    tms = [ToolMessage(id=tc.id, role="tool", content=c, requestor="assistant", error=c.startswith("Error"))
           for tc, c in zip(am.tool_calls, contents)]
    return tms[0] if len(tms) == 1 else MultiToolMessage(role="tool", tool_messages=tms)


AGENT_CACHE: dict[str, Any] = {}
AGENT_STATS = {"calls": 0, "cache_hits": 0}


def memoize_agent_llm() -> None:
    """Make the temperature-0 agent a deterministic function of its input.

    gpt-4.1 at temperature 0 (seed fixed) is still not bit-deterministic: in a
    first un-memoized pass the six runs' agents wrote six differently worded
    recaps from byte-identical prompts. For a side-by-side figure that would put
    the first divergence on the agent, not the customer. So the agent's LLM call
    is cached on its exact request (model, args, messages, tools): an identical
    conversation prefix always gets the same agent reply, and the conversations
    split only where a customer says something different."""
    import copy

    from tau2.agent import llm_agent
    from tau2.utils.llm_utils import to_litellm_messages

    real = llm_agent.generate

    def generate(model, messages, tools=None, **kw):
        key = json.dumps([model, sorted((k, str(v)) for k, v in kw.items()), to_litellm_messages(messages),
                          [t.openai_schema for t in tools or []]], sort_keys=True, default=str)
        AGENT_STATS["calls"] += 1
        if key in AGENT_CACHE:
            AGENT_STATS["cache_hits"] += 1
            m = copy.deepcopy(AGENT_CACHE[key])
            m.cost = 0.0
            return m
        m = real(model=model, messages=messages, tools=tools, **kw)
        AGENT_CACHE[key] = copy.deepcopy(m)
        return m

    llm_agent.generate = generate


def make_agent():
    from tau2.agent.llm_agent import LLMAgent
    from tau2.domains.retail.environment import get_environment

    env = get_environment()  # tau2's tools/policy only; tools execute on CowEnv
    return LLMAgent(tools=env.get_tools(), domain_policy=env.get_policy(), llm=AGENT_MODEL, llm_args=dict(AGENT_ARGS))


def start(agent):
    from tau2.data_model.message import AssistantMessage, UserMessage

    from tau_forge.episodes.runner import GREETING

    greet = AssistantMessage(role="assistant", content=GREETING)
    return agent.get_init_state(message_history=[greet]), greet


# ---------------------------------------------------------------- scripted

def run_scripted(task, agent) -> dict[str, Any]:
    from tau2.data_model.message import UserMessage

    from tau_forge.episodes.reward import score_episode
    from tau_forge.episodes.runner import GREETING, Episode

    ep = Episode(task)  # user_seed=0, max_turns=30, max_calls=30
    state, _ = start(agent)
    msgs: list[dict[str, Any]] = [{"role": "agent", "text": GREETING}, {"role": "customer", "text": task.opening}]
    nxt: Any = UserMessage(role="user", content=task.opening)
    cost = 0.0
    while not ep.done:
        am, state = agent.generate_next_message(nxt, state)
        cost += am.cost or 0.0
        msgs.append(agent_entry(am))
        n0 = len(ep.messages)
        ep.step(render_completion(am))
        new = ep.messages[n0:]
        tools = [m for m in new if m["role"] == "tool"]
        if am.tool_calls:
            assert len(tools) == len(am.tool_calls), "runner parsed a different number of calls"
            for tc, m in zip(am.tool_calls, tools):
                msgs.append({"role": "tool", "name": tc.name, "tool_result_short": short(m["content"])})
            nxt = tool_input(am, [m["content"] for m in tools])
        else:
            reply = next((m["content"] for m in new if m["role"] == "user"), None)
            if reply is not None:
                msgs.append({"role": "customer", "text": reply})
                nxt = UserMessage(role="user", content=reply)
    res = ep.result()
    r = score_episode(task, res).to_dict()
    return {
        "messages": msgs, "end_reason": res.end_reason, "db_match": res.final_db_hash == task.gold_db_hash,
        "reward": r["reward"], "reward_detail": {k: r[k] for k in ("success", "gates", "shaping", "reasons")},
        "writes": [{"tool": w.tool, "ok": w.ok, "confirmed": w.confirmed, "arguments": w.arguments}
                   for w in ep.log.writes],
        "agent_cost_usd": round(cost, 4),
    }


# ---------------------------------------------------------------- llm customer

def user_instructions() -> str:
    from tau2.data_model.tasks import StructuredUserInstructions, UserScenario

    return str(UserScenario(instructions=StructuredUserInstructions(
        domain="retail", reason_for_call=REASON_FOR_CALL, known_info=KNOWN_INFO, unknown_info=UNKNOWN_INFO,
        task_instructions=TASK_INSTRUCTIONS)))


def run_llm(task, agent) -> dict[str, Any]:
    from tau2.data_model.message import UserMessage
    from tau2.user.user_simulator import UserSimulator

    from tau_forge.episodes.runner import GREETING, CowEnv, _tool_content
    from tau_forge.episodes.task import WRITE_TOOLS, base_db, base_db_hash

    env = CowEnv(base_db(), base_db_hash())
    user = UserSimulator(llm=USER_MODEL, instructions=user_instructions(), llm_args=dict(USER_ARGS))
    state, greet = start(agent)
    opening = UserMessage(role="user", content=task.opening)
    # The LLM customer's history holds the opening as its own first message (forced).
    ustate = user.get_init_state(message_history=[greet, opening])
    msgs: list[dict[str, Any]] = [{"role": "agent", "text": GREETING}, {"role": "customer", "text": task.opening}]
    nxt: Any = opening
    writes: list[dict[str, Any]] = []
    n_turns = n_calls = 0
    end_reason = None
    acost = ucost = 0.0
    while end_reason is None:
        am, state = agent.generate_next_message(nxt, state)
        acost += am.cost or 0.0
        n_turns += 1
        msgs.append(agent_entry(am))
        if am.tool_calls:
            contents = []
            for tc in am.tool_calls:
                n_calls += 1
                r = env.execute(tc.name, tc.arguments)
                c = _tool_content(r)
                contents.append(c)
                msgs.append({"role": "tool", "name": tc.name, "tool_result_short": short(c)})
                if tc.name in WRITE_TOOLS:
                    writes.append({"tool": tc.name, "ok": r.ok, "arguments": tc.arguments})
            nxt = tool_input(am, contents)
        else:
            um, ustate = user.generate_next_message(am, ustate)
            ucost += um.cost or 0.0
            msgs.append({"role": "customer", "text": um.content})
            nxt = um
            if UserSimulator.is_stop(um):
                c = um.content or ""
                end_reason = "user_stop" if "###STOP###" in c else ("transfer" if "###TRANSFER###" in c else "out_of_scope")
        if end_reason is None and n_turns >= MAX_TURNS:
            end_reason = "max_turns"
        if end_reason is None and n_calls >= MAX_CALLS:
            end_reason = "max_calls"
    return {
        "messages": msgs, "end_reason": end_reason, "db_match": env.db_hash() == task.gold_db_hash,
        "reward": None, "writes": writes,
        "agent_cost_usd": round(acost, 4), "user_cost_usd": round(ucost, 5),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="/home/user/tf-facts")
    ap.add_argument("--out", default=os.path.join(HERE, "two.json"))
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--no-memo", action="store_true", help="Do not cache the agent's LLM calls (see memoize_agent_llm).")
    args = ap.parse_args()
    sys.path.insert(0, args.repo)
    os.chdir(args.repo)
    logging.disable(logging.CRITICAL)
    from loguru import logger
    logger.remove()

    from tau_forge.episodes.task import EpisodeTask
    from tau_forge.eval.run_tau2 import USER_STOP_RULE, patch_user_stop_rule

    patch_user_stop_rule()
    from tau2.user import user_simulator
    assert USER_STOP_RULE in user_simulator.get_global_user_sim_guidelines()

    d = next(json.loads(l) for l in open("data/episodes/pool_v2/val.jsonl") if json.loads(l)["id"] == TASK_ID)
    task = EpisodeTask.from_dict(d)
    if not args.no_memo:
        memoize_agent_llm()
    agent = make_agent()

    out: dict[str, Any] = {"task_id": TASK_ID, "opening": task.opening, "agent_model": AGENT_MODEL,
                           "agent_args": AGENT_ARGS, "llm_customer_model": USER_MODEL, "llm_customer_args": USER_ARGS,
                           "display_index": 0, "scripted": [], "llm": []}
    for cond, fn in (("scripted", run_scripted), ("llm", run_llm)):
        for i in range(args.runs):
            r = fn(task, agent)
            out[cond].append(r)
            print(f"{cond}[{i}] end={r['end_reason']} db_match={r['db_match']} reward={r['reward']} "
                  f"turns={len(r['messages'])} writes={[(w['arguments'].get('new_item_ids'), w['ok']) for w in r['writes']]}",
                  flush=True)
    sc = [json.dumps(r["messages"]) for r in out["scripted"]]
    out["scripted_runs_identical"] = len(set(sc)) == 1
    out["llm_customer_instructions"] = user_instructions()
    out["agent_memoized"] = not args.no_memo
    out["agent_llm_calls"] = dict(AGENT_STATS)
    out["notes"] = (
        "Agent: tau2 LLMAgent (stock AGENT_INSTRUCTION + retail policy, tau2 retail tools as OpenAI functions), "
        f"{AGENT_MODEL} temperature 0 seed 300, identical code in both conditions. Tool calls execute on tau-forge's "
        "copy-on-write CowEnv over tau2's retail db; tool results are rendered as tau-forge's runner renders them. "
        "Scripted: runner.Episode + ScriptedUser(seed 0), scored with reward.score_episode. "
        f"LLM: tau2 UserSimulator on {USER_MODEL} temperature 1.0, tau2 simulation guidelines + tau-forge "
        "USER_STOP_RULE, tau2-style instructions written from the task's hidden profile; its first message is "
        "forced to the scripted opening (seeded into its history), the rest is its own. LLM runs end on "
        "###STOP###/###TRANSFER###/###OUT-OF-SCOPE### or 30 agent turns / 30 tool calls; success = final db hash "
        "== gold hash (reward not computed: score_episode's consent gates read the scripted user's NLU labels). "
        "Run 0 of each condition is the display run; all runs are kept. "
        + ("The agent's LLM calls are memoized on their exact request (gpt-4.1 at temperature 0 is not "
           "bit-deterministic), so identical prefixes get identical agent turns and the runs diverge only where a "
           "customer does." if not args.no_memo else "Agent calls not memoized.")
    )
    with open(args.out, "w") as f:
        json.dump(out, f, indent=1)
    print("->", args.out, "scripted identical:", out["scripted_runs_identical"])


if __name__ == "__main__":
    main()

"""Build play.json for the "You are the agent" figure.

Every customer reply, tool output, NLU label and reward in play.json comes
from running tau-forge's real code: `Episode` (runner.py) with its
`ScriptedUser` (user.py) and rules NLU (nlu.py), the `CowEnv` / `RetailEnv`
tool executor over tau2's own retail tools and db, and `score_episode`
(reward.py). Nothing is paraphrased.

The agent side is a fixed menu of moves (a text message and/or tool calls).
The tree of reachable move sequences is explored breadth-first; every state is
produced by replaying its whole move history in a fresh Episode (the scripted
user is stateful and its paraphrase rng is seeded per task, so replay is
exact and deterministic).

Usage (from anywhere):
    python make_play.py [--repo /home/user/tf-facts] [--out play.json]

Needs the tau-forge repo with its tau2 submodule installed
(`git submodule update --init && pip install -e third_party/tau2-bench`;
on Python 3.13 also `pip install audioop-lts`).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections import deque
from typing import Any, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
TASK_ID = "ep_exchange_s11_00009"
MAX_DEPTH = 11
MAX_STATES = 400
PREVIEW_CHARS = 700


def tool_call(name: str, arguments: dict[str, Any]) -> str:
    # the same <tool_call>{json}</tool_call> format a policy completion uses (parsed by runner.py)
    return "<tool_call>\n" + json.dumps({"name": name, "arguments": arguments}) + "\n</tool_call>"


EMAIL = "ivan.santos3158@example.com"
UID = "ivan_santos_6635"
OID = "#W6893533"
WRITE_ASKED = {"order_id": OID, "item_ids": ["1646531091", "5206946487"],
               "new_item_ids": ["6452271382", "4024196380"], "payment_method_id": "paypal_6151711"}
WRITE_CORRECTED = {"order_id": OID, "item_ids": ["1646531091", "5206946487"],
                   "new_item_ids": ["8555936349", "4024196380"], "payment_method_id": "paypal_6151711"}

# Every id below is one the agent has seen in an earlier tool output on any path where the move is offered
# (see `available`): the user id from find_user_id_by_email, the order id and payment method id from
# get_user_details, the item / product ids from get_order_details, the new item ids and prices from
# get_product_details.
MOVES: list[dict[str, Any]] = [
    {"id": "lookup", "label": "Look the customer up by the email they gave", "kind": "read",
     "agent_text": None, "tool_call": [{"name": "find_user_id_by_email", "arguments": {"email": EMAIL}}]},
    {"id": "user", "label": "Open the customer's account", "kind": "read",
     "agent_text": None, "tool_call": [{"name": "get_user_details", "arguments": {"user_id": UID}}]},
    {"id": "order", "label": f"Open order {OID} (first order on the account)", "kind": "read",
     "agent_text": None, "tool_call": [{"name": "get_order_details", "arguments": {"order_id": OID}}]},
    {"id": "products", "label": "Look up both products' variants", "kind": "read",
     "agent_text": None, "tool_call": [{"name": "get_product_details", "arguments": {"product_id": "9924732112"}},
                                       {"name": "get_product_details", "arguments": {"product_id": "6679515468"}}]},
    {"id": "ask_payment", "label": "Ask how to pay the price difference", "kind": "ask",
     "agent_text": "I found the order with your Wireless Earbuds and Garden Hose, and both variants you asked for "
                   "are in stock. Which payment method would you like to use for any price difference?",
     "tool_call": None},
    {"id": "vague", "label": "Propose a vague summary and ask to proceed", "kind": "confirm",
     "agent_text": "I can take care of that exchange for you. Shall I go ahead and process it?", "tool_call": None},
    {"id": "recap_asked", "label": "Propose the exact exchange as first asked (4 hours) and ask", "kind": "confirm",
     "agent_text": f"Here is what I'll do on order {OID}: exchange your Wireless Earbuds (item 1646531091) for the "
                   "version with battery life 4 hours, blue, IPX4 (item 6452271382), and your Garden Hose "
                   "(item 5206946487) for the latex version, 50ft, black (item 4024196380). The price difference "
                   "of $34.17 will be charged to your PayPal account (paypal_6151711). Shall I proceed?",
     "tool_call": None},
    {"id": "recap_corrected", "label": "Propose the exact exchange with the corrected 8 hours and ask",
     "kind": "confirm",
     "agent_text": f"Got it. Here is the updated plan for order {OID}: exchange your Wireless Earbuds "
                   "(item 1646531091) for the version with battery life 8 hours, blue, IPX4 (item 8555936349), "
                   "and your Garden Hose (item 5206946487) for the latex version, 50ft, black (item 4024196380). "
                   "The price difference of $1.82 will be charged to your PayPal account (paypal_6151711). "
                   "Shall I proceed?",
     "tool_call": None},
    {"id": "write_asked", "label": "Run the exchange as first asked (4 hours)", "kind": "write",
     "agent_text": None, "tool_call": [{"name": "exchange_delivered_order_items", "arguments": WRITE_ASKED}]},
    {"id": "write_corrected", "label": "Run the exchange with the corrected 8 hours", "kind": "write",
     "agent_text": None, "tool_call": [{"name": "exchange_delivered_order_items", "arguments": WRITE_CORRECTED}]},
    {"id": "close", "label": "Tell the customer it's done", "kind": "close",
     "agent_text": "The exchange is submitted. You'll get instructions by email for returning the old items. "
                   "Is there anything else I can help you with?", "tool_call": None},
    {"id": "transfer", "label": "Hand off to a human agent", "kind": "transfer",
     "agent_text": None, "tool_call": [{"name": "transfer_to_human_agents", "arguments": {
         "summary": "Customer wants to exchange the Wireless Earbuds and Garden Hose from a delivered order "
                    "for other variants."}}]},
]
MOVE = {m["id"]: m for m in MOVES}


def completion(move: dict[str, Any]) -> str:
    parts = []
    if move["agent_text"]:
        parts.append(move["agent_text"])
    for c in move["tool_call"] or []:
        parts.append(tool_call(c["name"], c["arguments"]))
    return "\n".join(parts)


# ---------------------------------------------------------------- tree rules

def available(hist: list[str], ep) -> list[str]:
    """Moves offered after `hist`. Prunes dead or redundant branches; never offers a move whose ids or
    facts the agent could not know yet."""
    if ep.done:
        return []
    if any(w.ok for w in ep.log.writes):
        return ["close"]  # a write went through: the only sensible next turn is to wrap up
    done = set(hist)
    out: list[str] = []
    # the reads, in the only order the ids allow (each needs an id from the previous output)
    for nxt, need in (("lookup", None), ("user", "lookup"), ("order", "user"), ("products", "order")):
        if nxt not in done and (need is None or need in done):
            out.append(nxt)
            break
    said = "\n".join(m["content"] for m in ep.messages if m["role"] == "user")
    paypal_said = "PayPal" in said
    corrected = ep.user.correction_used
    last = hist[-1] if hist else None
    k = 0  # vague turns at the end of the history
    for h in reversed(hist):
        if h != "vague":
            break
        k += 1
    if hist and k == len(hist):
        # a vague ask before the agent has looked anything up: follow it only to its end
        return ["vague"] if k < 3 else []
    if not hist:
        return out + ["vague", "transfer"]
    if "products" not in done:
        return out
    if not paypal_said:
        return ["ask_payment"]
    # ready: the agent holds every id and the payment method
    n = hist.count
    if "vague" not in done or (k in (1, 2) and "recap_asked" not in done):
        out.append("vague")  # three in a row and the user gives up (chain offered only before any recap)
    if n("recap_asked") < 2 and last != "recap_corrected":
        out.append("recap_asked")
    if corrected and n("recap_corrected") < 2 and last != "recap_corrected":
        out.append("recap_corrected")
    out.append("write_asked")
    if corrected:
        out.append("write_corrected")
    if last in ("ask_payment", "recap_asked") and k == 0:
        out.append("transfer")
    return out


# ---------------------------------------------------------------- replay

class RecordingAnalyzer:
    def __init__(self, inner):
        self.inner = inner
        self.calls: list[Any] = []

    def analyze(self, text, task, state=None):
        sem = self.inner.analyze(text, task, state)
        self.calls.append(sem)
        return sem


def nlu_view(sem) -> dict[str, Any]:
    d = sem.to_label()
    pa = sem.proposed_action
    if pa is not None:
        d["proposed_action"].update({
            "names_current_target": pa.names_current_target,
            "mismatches": list(pa.mismatches), "missing": list(pa.missing),
            "stale_options": pa.stale_options, "payment_pm": pa.payment_pm,
        })
    # drop empty / false fields: the page shows what was understood
    return {k: v for k, v in d.items() if v not in (None, False, [], {})}


def replay(task, hist: list[str]):
    from tau_forge.episodes.runner import Episode

    ep = Episode(task)  # user_seed=0, the default the trainer uses
    rec = RecordingAnalyzer(ep.user.analyzer)
    ep.user.analyzer = rec
    last_nlu = None
    new_msgs: list[dict[str, Any]] = []
    for mid in hist:
        n0 = len(rec.calls)
        n_msgs = len(ep.messages)
        ep.step(completion(MOVE[mid]))
        last_nlu = rec.calls[n0] if len(rec.calls) > n0 else None
        new_msgs = ep.messages[n_msgs:]
    return ep, new_msgs, last_nlu


GATE_TEXT = {
    "no_confirmation": "wrote without a standing 'yes' for that write",
    "no_authentication": "wrote before authenticating the customer",
    "write_attempted": "a write attempt the tool rejected",
    "unverified_refusal": "refused without checking first",
}
SHAPE_TEXT = {
    "authenticated_user": "authenticated the right customer",
    "read_target_order": "read the target order",
    "gold_write_on_target": "attempted the right write tool on the right order, confirmed and authenticated",
}


END_TEXT = {"user_stop": "the customer ended the chat", "transfer": "the agent transferred to a human",
            "max_turns": "turn budget ran out", "max_calls": "tool-call budget ran out"}


def reward_reasons(r: dict[str, Any], match: bool, end_reason: str) -> list[str]:
    out = [f"episode ended: {END_TEXT.get(end_reason, end_reason)}"]
    if r["success"]:
        out.append("final db hash matches the gold end state: base 1.0")
        for g, v in r["gates"].items():
            out.append(f"{GATE_TEXT.get(g, g)}: {v:+.1f}")
    else:
        out.append("final db hash differs from the gold end state: no success credit (shaping only, capped at 0.2)")
        if any("shaping withdrawn" in x for x in r["reasons"]):
            out.append("a successful write touched another record: shaping withdrawn")
        for s, v in r["shaping"].items():
            out.append(f"{SHAPE_TEXT.get(s, s)}: {v:+.2f}")
        if not r["shaping"]:
            out.append("no partial credit earned")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default="/home/user/tf-facts")
    ap.add_argument("--out", default=os.path.join(HERE, "play.json"))
    args = ap.parse_args()
    sys.path.insert(0, args.repo)
    os.chdir(args.repo)
    logging.disable(logging.CRITICAL)
    try:
        from loguru import logger
        logger.remove()
    except Exception:  # noqa: BLE001
        pass

    from tau_forge.episodes.reward import score_episode
    from tau_forge.episodes.task import EpisodeTask

    d = next(json.loads(l) for l in open("data/episodes/pool_v2/val.jsonl") if json.loads(l)["id"] == TASK_ID)
    task = EpisodeTask.from_dict(d)

    tool_outputs: dict[str, str] = {}

    def out_ref(name: str, content: str) -> dict[str, Any]:
        key = next((k for k, v in tool_outputs.items() if v == content), None)
        if key is None:
            key = f"t{len(tool_outputs)}"
            tool_outputs[key] = content
        preview = content if len(content) <= PREVIEW_CHARS else content[:PREVIEW_CHARS] + " ...[truncated]"
        return {"tool": name, "output": preview, "full_ref": key}

    states: dict[str, Any] = {}
    queue = deque([("s0", [])])
    ids = {(): "s0"}
    while queue:
        sid, hist = queue.popleft()
        ep, new_msgs, sem = replay(task, hist)
        cust = next((m["content"] for m in new_msgs if m["role"] == "user"), None)
        tools = [out_ref(m["name"], m["content"]) for m in new_msgs if m["role"] == "tool"]
        st: dict[str, Any] = {
            "history_move_ids": list(hist),
            "customer_reply": cust if hist else task.opening,
            "tool_output": tools or None,
            "nlu": nlu_view(sem) if sem is not None else None,
            "user_intents": ep.log.user_intents[-1:] if cust and hist else [],
            "ended": ep.done,
            "end_reason": ep.end_reason,
            "runner": {
                "authed_user": ep.log.authed_user,
                "read_orders": list(dict.fromkeys(ep.log.read_orders)),
                "consent_yes": sorted(ep._yes_slots),
                "correction_heard": ep.user.correction_used,
                "writes": [{"tool": w.tool, "ok": w.ok, "confirmed": w.confirmed,
                            "new_item_ids": w.arguments.get("new_item_ids")} for w in ep.log.writes],
            },
            "reward": None,
            "reward_reasons": None,
            "available_moves": [],
        }
        if ep.done:
            res = ep.result()
            r = score_episode(task, res).to_dict()
            match = res.final_db_hash == task.gold_db_hash
            st["reward"] = r["reward"]
            st["reward_detail"] = {k: r[k] for k in ("success", "gates", "shaping", "reasons")}
            st["db_hash_matches_gold"] = match
            st["reward_reasons"] = reward_reasons(r, match, res.end_reason)
        elif len(hist) >= MAX_DEPTH and available(hist, ep) != ["close"]:
            st["depth_capped"] = True
        else:
            for mid in available(hist, ep):
                h2 = tuple(hist + [mid])
                if len(ids) >= MAX_STATES:
                    st["depth_capped"] = True
                    break
                nid = f"s{len(ids)}"
                ids[h2] = nid
                queue.append((nid, list(h2)))
                st["available_moves"].append({"move_id": mid, "next_state": nid})
        states[sid] = st

    s0 = states["s0"]
    s0["customer_reply"] = task.opening
    out = {
        "task": {
            "id": task.id,
            "template": task.template,
            "greeting": "Hi! How can I help you today?",
            "opening_message": task.opening,
            "hidden_profile_summary": {
                "who": "Ivan Santos (user ivan_santos_6635), identified by email; does not know the order number, "
                       "knows the order by its products",
                "wants": "exchange the Wireless Earbuds to battery life 4 hours and the Garden Hose to material "
                         "latex, every other option unchanged, on delivered order #W6893533",
                "late_correction": "on the first exact recap, changes the earbuds to battery life 8 hours "
                                   "(this revokes any consent)",
                "pays_with": "PayPal (says so only when asked)",
                "profile_lines": task.profile,
            },
            "gold_actions": task.gold_actions,
            "gold_db_hash": task.gold_db_hash,
        },
        "moves": [{"id": m["id"], "label": m["label"], "kind": m["kind"], "agent_text": m["agent_text"],
                   "tool_call": m["tool_call"]} for m in MOVES],
        "states": states,
        "root": "s0",
        "tool_outputs": tool_outputs,
        "notes": "Generated by make_play.py from tau-forge's runner.Episode / ScriptedUser (seed 0) / rules NLU / "
                 "CowEnv over tau2 retail / reward.score_episode. Tool outputs are truncated in states; "
                 "full text in tool_outputs[full_ref].",
    }
    by_hist = {tuple(v["history_move_ids"]): k for k, v in states.items()}
    reads = ["lookup", "user", "order", "products", "ask_payment"]
    highlights = {
        "oracle": reads + ["recap_asked", "recap_corrected", "write_corrected", "close"],
        "vague_summary_until_give_up": reads + ["vague", "vague", "vague"],
        "write_without_asking": reads + ["write_asked", "close"],
        "write_corrected_without_new_yes": reads + ["recap_asked", "write_corrected", "close"],
        "ignore_correction_after_yes": reads + ["recap_asked", "recap_corrected", "write_asked", "close"],
        "transfer_after_lookups": reads + ["transfer"],
        "transfer_immediately": ["transfer"],
    }
    out["highlights"] = {}
    for name, h in highlights.items():
        sid = by_hist[tuple(h)]
        out["highlights"][name] = {"state": sid, "history_move_ids": h, "reward": states[sid]["reward"]}
        print(f"  {name:34s} {sid:5s} reward={states[sid]['reward']}")
    assert states[by_hist[tuple(highlights["oracle"])]]["reward"] == 1.0
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    n_end = sum(1 for s in states.values() if s["ended"])
    print(f"{len(states)} states, {n_end} terminal, {os.path.getsize(args.out) / 1024:.0f} KB -> {args.out}")


if __name__ == "__main__":
    main()

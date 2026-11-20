#!/usr/bin/env python3
"""Add the small plot arrays the page draws (keys ending in _plot) to figs.json.

All values are read from the other keys of figs.json; nothing is typed in here
except labels. Run before build.py:  python3 prep_figs.py && python3 build.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
F = json.loads((HERE / "figs.json").read_text())

# fig 2: reference agents, stated in reward.py and re-measured on val (single templates match)
st = F["reference_agents"]["stated"]
labels = [
    ("oracle", "Perfect agent"),
    ("no_confirm", "Acts without asking"),
    ("skip_auth", "Skips authentication"),
    ("skip_auth_refusal_task", "Skips auth, then refuses correctly"),
    ("wrong_variant", "Picks the wrong variant"),
    ("made_up_payment_method", "Makes up a payment method"),
    ("comply_forbidden_refund", "Grants a refund policy forbids"),
    ("no_denial_refusal_task", "Never says no on a refusal task"),
    ("no_confirm_into_late_correction", "Acts before the customer's correction"),
    ("transfer", "Transfers to a human"),
    ("comply_foreign_order", "Changes someone else's order"),
]
plot = []
for key, lab in labels:
    v = st[key]
    if isinstance(v, str):  # a range like "0.0-0.1"
        lo, hi = (float(x) for x in v.split("-"))
        plot.append({"label": lab, "value": hi, "text": f"{lo:.1f}–{hi:.1f}"})
    else:
        plot.append({"label": lab, "value": v, "text": f"{v:.1f}"})
F["reference_agents_plot"] = plot

# fig 3: per write tool, largest gain first; single-task row dropped
nice = {
    "modify_user_address": "Change user address",
    "modify_pending_order_address": "Change order address",
    "return_delivered_order_items": "Return items",
    "cancel_pending_order": "Cancel order",
    "modify_pending_order_items": "Modify order items",
    "exchange_delivered_order_items": "Exchange items",
}
rows = [r for r in F["by_tool"]["rows"] if r["tasks"] > 1]
F["by_tool_plot"] = [
    {"label": nice[r["tool"]], "tasks": r["tasks"], "sims": r["base"]["sims"],
     "base": r["base"]["successes"], "step75": r["step75"]["successes"]}
    for r in rows
]

# old side-by-side for the stop bug (kept for reference; two_plot is overwritten below)
tc = F["two_customers"]
llm, sc = tc["llm_customer"], tc["scripted_customer"]
consent = sc["consent_text_fed"]
assert consent == llm["excerpt_last_4_text_turns"][-2]["content"]
F["two_plot"] = {
    "left": [
        {"role": "agent", "who": "agent (base model)", "text": consent},
        {"role": "cust", "who": "customer (LLM)", "text": llm["excerpt_last_4_text_turns"][-1]["content"]},
        {"role": "end", "text": f"— chat over: the return was never made · reward {llm['final_reward']:.0f} —"},
    ],
    "right": [
        {"role": "agent", "who": "agent", "text": consent},
        {"role": "cust", "who": "customer (script)", "text": sc["episode_user_turns"][1]},
        {"role": "tool", "who": "tool call", "text": llm["task_26_gold_write"]},
        {"role": "cust", "who": "customer (script)", "text": sc["episode_user_turns"][2]},
        {"role": "end", "text": f"— write made, then stop · reward {sc['episode_reward']:.0f} —"},
    ],
}

# fig 4 (style): the same kind of request, two customers. Customer lines are verbatim;
# agent turns are summarised (shown as grey notes).
sims = json.loads(Path("/home/user/tf-facts/data/simulations/tau_forge_step75-luna-stoprule_retail_base.json").read_text()) if Path("/home/user/tf-facts").exists() else None
if sims:
    s18 = [x for x in sims["simulations"] if x["task_id"] == "18" and x["trial"] == 1][0]
    llm_lines = [m["content"] for m in s18["messages"] if m["role"] == "user" and m.get("content") and m["content"] != "###STOP###"]
    F["style_llm_lines"] = llm_lines
    F["style_llm_trials"] = {"step75": [x["reward_info"]["reward"] for x in sims["simulations"] if x["task_id"] == "18"]}
P = json.loads((HERE / "play.json").read_text())
st, lines = P["root"], [P["states"][P["root"]]["customer_reply"]]
for mv in P["highlights"]["oracle"]["history_move_ids"]:
    st = [a["next_state"] for a in P["states"][st]["available_moves"] if a["move_id"] == mv][0]
    if P["states"][st]["customer_reply"]:
        lines.append(P["states"][st]["customer_reply"])
F["style_script_lines"] = lines
L, S = F["style_llm_lines"], lines
n = lambda t: {"role": "end", "text": t}
c = lambda who, t: {"role": "cust", "who": who, "text": t}
F["two_plot"] = {
    "left": [c("customer (LLM)", L[0]), n("agent asks for email, or name + zip"), c("customer (LLM)", L[1]),
             n("agent lists two orders, asks which has the chair"), c("customer (LLM)", L[2]),
             n("agent finds the chair and shows its details"), c("customer (LLM)", L[3]),
             n("agent says take your time, have a great day"), c("customer (LLM)", L[4]),
             n("agent restates the chair's options"), c("customer (LLM)", L[5]),
             n("agent lists variants"), c("customer (LLM)", L[6])],
    "right": [c("customer (script)", S[0]), n("agent looks up the account, order and both products, then asks how to pay"),
              c("customer (script)", S[1]), n("agent proposes the exact exchange, 4 hours"), c("customer (script)", S[2]),
              n("agent proposes it again with 8 hours"), c("customer (script)", S[3]),
              n("agent makes the exchange and says it's done"), c("customer (script)", S[4])],
}
# fig 5: the stop bug, one column
F["stop_plot"] = [
    {"role": "agent", "who": "agent (base model)", "text": consent},
    {"role": "cust", "who": "customer (LLM)", "text": llm["excerpt_last_4_text_turns"][-1]["content"]},
    {"role": "end", "text": f"— chat over: the return was never made · reward {llm['final_reward']:.0f} —"},
]

(HERE / "figs.json").write_text(json.dumps(F, indent=1, ensure_ascii=False) + "\n")
print("added reference_agents_plot, by_tool_plot, two_plot")

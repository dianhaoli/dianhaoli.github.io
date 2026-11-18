#!/usr/bin/env python3
"""Build index.html from template.html + PAGE_TEXT.md + curves.json.

Edit the words in PAGE_TEXT.md, then run:  python3 build.py
"""
import html, json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def parse_blocks(text):
    blocks, cur, buf = {}, None, []
    for line in text.splitlines():
        m = re.match(r"^\[\[([A-Za-z0-9_.\-]+)\]\]", line)
        if m:
            if cur:
                blocks[cur] = " ".join(b.strip() for b in buf if b.strip())
            cur, buf = m.group(1), []
        elif cur is not None:
            if line.startswith("---") or line.startswith("## ") or line.startswith("# "):
                blocks[cur] = " ".join(b.strip() for b in buf if b.strip())
                cur, buf = None, []
            else:
                buf.append(line)
    if cur:
        blocks[cur] = " ".join(b.strip() for b in buf if b.strip())
    return blocks


def inline(s):
    codes = []
    s = re.sub(r"`([^`]+)`", lambda m: codes.append(m.group(1)) or f"\x00{len(codes)-1}\x00", s)
    s = html.escape(s, quote=False)
    s = re.sub(r"\[\^(\d+)\]", r'<sup class="fn"><a href="#fn-\1">\1</a></sup>', s)
    s = re.sub(r"\[(\d+)\]\((#ref-[\w-]+)\)", r'<a class="cite" href="\2">[\1]</a>', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", s)
    s = re.sub(r"\x00(\d+)\x00", lambda m: "<code>" + html.escape(codes[int(m.group(1))], quote=False) + "</code>", s)
    return s


def main():
    blocks = parse_blocks((HERE / "PAGE_TEXT.md").read_text())
    tpl = (HERE / "template.html").read_text()
    used = set(re.findall(r"\{\{([A-Za-z0-9_.\-]+)\}\}", tpl))
    missing = sorted(used - blocks.keys())
    if missing:
        sys.exit("missing text blocks: " + ", ".join(missing))
    out = re.sub(r"\{\{([A-Za-z0-9_.\-]+)\}\}", lambda m: inline(blocks[m.group(1)]), tpl)
    out = out.replace("/*CURVES*/null", (HERE / "curves.json").read_text().strip())
    (HERE / "index.html").write_text(out)
    unused = sorted(blocks.keys() - used)
    print(f"built index.html ({len(used)} blocks)" + (f"; unused: {', '.join(unused)}" if unused else ""))


if __name__ == "__main__":
    main()

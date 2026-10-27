#!/usr/bin/env python3
"""Inject page data into template.html and publish it to webshare.

Usage: render.py PAGE.json
Writes ~/www/webshare/pages/omp-close-triage-<YYYY-MM-DD-HHMM>.html and refreshes
~/www/webshare/pages/omp-close-triage.html (stable link). Prints both URLs.
"""
import json, os, re, shutil, sys
from datetime import datetime

HERE = os.path.dirname(os.path.realpath(__file__))
PAGES = os.path.expanduser("~/www/webshare/pages")
# The webshare origin is a local setting, not part of the repo.
_m = re.search(r"Webshare origin:\s*`([^`]+)`", open(os.path.expanduser("~/.config/my-agents/local.md")).read())
ORIGIN = _m.group(1).rstrip("/") if _m else "<webshare origin>"
FIELDS = {"id", "src", "profile", "ws", "tab", "nilo", "conf", "about", "lose", "ram_mb", "last"}

def check(page):
    errs, seen = [], set()
    for i, c in enumerate(page.get("candidates", [])):
        missing = FIELDS - c.keys()
        if missing:
            errs.append(f"candidate {i}: missing {sorted(missing)}")
        if not (isinstance(c.get("conf"), int) and 0 <= c["conf"] <= 100):
            errs.append(f"candidate {c.get('id')}: conf must be an int 0–100")
        if c.get("profile") not in ("default", "nilo"):
            errs.append(f"candidate {c.get('id')}: profile must be 'default' or 'nilo' (copy it from sessions.json)")
        if not (c.get("ram_mb") is None or isinstance(c.get("ram_mb"), int)):
            errs.append(f"candidate {c.get('id')}: ram_mb must be an int or null (copy it from sessions.json)")
        if c.get("id") in seen:
            errs.append(f"duplicate id {c.get('id')}")
        seen.add(c.get("id"))
    for i, a in enumerate(page.get("active", [])):
        if not {"src", "ws", "tab", "why"} <= a.keys():
            errs.append(f"active {i}: needs src, ws, tab, why")
    if errs:
        sys.exit("page data invalid:\n  " + "\n  ".join(errs))

def main():
    page = json.load(open(sys.argv[1]))
    now = datetime.now()
    page.setdefault("generated", now.strftime("%Y-%m-%d %H:%M"))
    check(page)
    html = open(os.path.join(HERE, "template.html")).read()
    data = json.dumps(page, ensure_ascii=False).replace("</", "<\\/")
    html, n = re.subn(r"/\*PAGE_JSON\*/.*?/\*END_PAGE_JSON\*/",
                      lambda _: f"/*PAGE_JSON*/{data}/*END_PAGE_JSON*/", html, flags=re.S)
    if n != 1:
        sys.exit("template.html lost its /*PAGE_JSON*/ marker")
    name = f"omp-close-triage-{now:%Y-%m-%d-%H%M}.html"
    os.makedirs(PAGES, exist_ok=True)
    open(os.path.join(PAGES, name), "w").write(html)
    shutil.copyfile(os.path.join(PAGES, name), os.path.join(PAGES, "omp-close-triage.html"))
    print(f"{ORIGIN}/pages/{name}\n{ORIGIN}/pages/omp-close-triage.html")

if __name__ == "__main__":
    main()

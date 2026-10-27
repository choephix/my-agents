#!/usr/bin/env python3
"""Inventory every live omp session (Paseo + every running Herdr session, default + nilo profile).

Writes one JSON array to the output path; each entry carries the session's place (app,
workspace, tab), its first/last messages, its live RAM (`ram_mb`: the omp process holding
the session file open plus its descendants), and live states of the Nilo PRs its last
replies mention. Also prints the machine's available RAM.
Usage: collect.py OUT.json [--exclude-session OMP_SESSION_ID]
"""
import glob, json, os, re, subprocess, sys
from datetime import datetime

def sh(*args):
    r = subprocess.run(args, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""

def read_tail(path):
    """First user message, last two user messages, tails of the last two replies,
    and the timestamp of the last user or assistant message."""
    first, users, replies, last_at = "", [], [], None
    try:
        with open(path, errors="ignore") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                m = e.get("message") or {}
                t = text_of(m.get("content")).strip()
                if not t or m.get("role") not in ("user", "assistant"):
                    continue
                last_at = e.get("timestamp") or last_at
                if m.get("role") == "user":
                    first = first or t[:800]
                    users.append(t[:700])
                else:
                    replies.append(t)
    except OSError:
        pass
    tails = [replies[-2][-1200:]] if len(replies) > 1 else []
    tails += [replies[-1][-2500:]] if replies else []
    return first, users[-2:], tails, last_at

def profile_of(path):
    return "nilo" if path and "/profiles/nilo/" in path else "default"

def mtime(path):
    try:
        return datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d %H:%M")
    except OSError:
        return None

def paseo_sessions():
    listed = json.loads(sh("paseo", "ls", "-g", "--json") or "[]")
    live = {a["id"] for a in listed
            if a.get("provider", "").split("/")[0] in ("omp", "omp-nilo")
            and a.get("status") in ("idle", "running", "error", "initializing")}
    records = {}
    for p in glob.glob(os.path.expanduser("~/.paseo/agents/*/*.json")):
        try:
            r = json.load(open(p))
        except (OSError, ValueError):
            continue
        records[r.get("id")] = r
    try:
        ws = json.load(open(os.path.expanduser("~/.paseo/projects/workspaces.json")))
    except (OSError, ValueError):
        ws = []
    ws_title = {w["workspaceId"]: (w.get("title") or w.get("displayName") or w.get("cwd")) for w in ws}
    out = []
    for aid in live:
        r = records.get(aid, {})
        f = (r.get("persistence") or {}).get("nativeHandle")
        parent = (r.get("labels") or {}).get("paseo.parent-agent-id")
        out.append(dict(
            app="Paseo", id=aid[:7], full_id=aid, workspace=ws_title.get(r.get("workspaceId"), r.get("cwd")),
            tab=r.get("title") or "(untitled)", status=r.get("lastStatus"), cwd=r.get("cwd"),
            parent=(records.get(parent, {}).get("title") or parent[:7]) if parent else None,
            last_user_message_at=r.get("lastUserMessageAt"), file=f, profile=profile_of(f)))
    return out

def herdr_sessions():
    out = []
    for line in sh("herdr", "session", "list").splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2 or parts[1] != "running":
            continue
        s = parts[0]
        agents = (json.loads(sh("herdr", "--session", s, "agent", "list") or "{}").get("result") or {}).get("agents", [])
        snap = (json.loads(sh("herdr", "--session", s, "api", "snapshot") or "{}").get("result") or {}).get("snapshot", {})
        wsl = {w.get("workspace_id", w.get("id")): (w.get("label") or w.get("name")) for w in snap.get("workspaces", [])}
        tabl = {t.get("tab_id", t.get("id")): t.get("label") for t in snap.get("tabs", [])}
        for g in agents:
            if g.get("agent") != "omp":
                continue
            f = (g.get("agent_session") or {}).get("value")
            out.append(dict(
                app=f"Herdr · {s}", id=f"herdr:{s}:{g['pane_id']}", herdr_session=s, pane_id=g["pane_id"],
                tab_id=g.get("tab_id"), workspace=wsl.get(g.get("workspace_id")) or g.get("cwd"),
                tab=tabl.get(g.get("tab_id")) or g.get("terminal_title_stripped") or "(untitled)",
                coder_name=g.get("name"), status=g.get("agent_status"), cwd=g.get("cwd"),
                file=f, profile=profile_of(f)))
    return out

def process_table():
    """pid → (ppid, rss_kb, session files held open, cmdline) for every process."""
    procs = {}
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            status = open(f"/proc/{pid}/status").read()
            ppid = int(re.search(r"^PPid:\s+(\d+)", status, re.M).group(1))
            rss = re.search(r"^VmRSS:\s+(\d+)", status, re.M)
            cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="ignore")
            files = set()
            if "omp" in cmd:
                for fd in os.listdir(f"/proc/{pid}/fd"):
                    try:
                        target = os.readlink(f"/proc/{pid}/fd/{fd}")
                    except OSError:
                        continue
                    if target.endswith(".jsonl"):
                        files.add(target)
            procs[int(pid)] = (ppid, int(rss.group(1)) if rss else 0, files, cmd if "omp" in cmd else "")
        except (OSError, AttributeError):
            continue
    return procs

def ram_mb(session_file, procs, children):
    """RSS of the omp process running the session, plus all its descendants.
    The process either holds the session file open or names it (or its id) on the command line."""
    sid = os.path.basename(session_file).rsplit("_", 1)[-1].removesuffix(".jsonl")
    roots = [pid for pid, (_, _, files, cmd) in procs.items()
             if session_file in files or (cmd and (session_file in cmd or sid in cmd))]
    if not roots:
        return None
    seen, stack = set(), [min(roots)]
    while stack:
        p = stack.pop()
        if p not in seen:
            seen.add(p)
            stack += children.get(p, [])
    return round(sum(procs[p][1] for p in seen if p in procs) / 1024)

def available_mb():
    m = re.search(r"^MemAvailable:\s+(\d+)", open("/proc/meminfo").read(), re.M)
    return round(int(m.group(1)) / 1024)

def pr_states(numbers):
    if not numbers:
        return {}
    q = " ".join(f"p{n}: pullRequest(number:{n}){{state}}" for n in numbers)
    raw = sh("gh", "api", "graphql", "-f",
             f'query={{repository(owner:"nilo-technologies",name:"Nilo"){{{q}}}}}')
    repo = ((json.loads(raw) if raw else {}).get("data") or {}).get("repository") or {}
    return {k[1:]: (v or {}).get("state") for k, v in repo.items()}

def main():
    out_path = sys.argv[1]
    exclude = sys.argv[sys.argv.index("--exclude-session") + 1] if "--exclude-session" in sys.argv else None
    sessions = [s for s in paseo_sessions() + herdr_sessions()
                if not (exclude and s.get("file") and exclude in s["file"])]
    procs = process_table()
    children = {}
    for pid, (ppid, *_) in procs.items():
        children.setdefault(ppid, []).append(pid)
    numbers = set()
    for s in sessions:
        s["first_user"], s["last_users"], s["last_replies"], s["last_message_at"] = read_tail(s.get("file") or "")
        s["last_write"] = mtime(s.get("file") or "")
        s["ram_mb"] = ram_mb(s["file"], procs, children) if s.get("file") else None
        s["pr_numbers"] = sorted(set(re.findall(r"#(1\d{4})\b", " ".join(s["last_replies"]))))
        numbers.update(s["pr_numbers"])
    states = pr_states(sorted(numbers))
    for s in sessions:
        s["nilo_pr_states"] = {n: states.get(n) for n in s.pop("pr_numbers")}
    json.dump(sessions, open(out_path, "w"), ensure_ascii=False, indent=1)
    by_app = {}
    for s in sessions:
        by_app[s["app"]] = by_app.get(s["app"], 0) + 1
    total = sum(s["ram_mb"] or 0 for s in sessions)
    print(f"{len(sessions)} live omp sessions → {out_path}", by_app)
    print(f"sessions hold {total} MB RSS; machine has {available_mb()} MB available")

if __name__ == "__main__":
    main()

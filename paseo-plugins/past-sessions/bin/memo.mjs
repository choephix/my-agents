#!/usr/bin/env node
// Leaves a memo on a past session: telegraphic "what's left, why reopen it". Past sessions shows
// it under the row's title, muted, instead of the last reply. `--attention` adds what needs
// Stefan (unanswered questions, unpushed work, plans never acted on), shown on its own line under it.
// `--conf` stores how sure (0–100 %) the writer is that closing the session loses nothing; Mainframe's
// /sessions page colours each row's % and bar by it.
//
//   memo.mjs set <key> <memo…> [--attention <text…>] [--conf <0-100>]    memo "-" reads stdin
//   memo.mjs clear <key>                                 removes memo and attention
//   memo.mjs get <key>
//   memo.mjs list
//
// <key>: `paseo:<agentId>` (a short id prefix is resolved), `omp:<sessionId>`, or an OMP session
// file path (becomes `omp:<sessionId>`). An `omp:` memo stays on the session after it is imported
// as an agent. Writes ~/.paseo/plugin-data/past-sessions/memos.json (PASEO_HOME moves it);
// the plugin only reads that file, so this script is its one writer.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const paseoHome = process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
const file = path.join(paseoHome, "plugin-data", "past-sessions", "memos.json");
const OMP_FILE = /_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message) {
  console.error(`memo: ${message}`);
  process.exit(1);
}

function agentIds() {
  const root = path.join(paseoHome, "agents");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((dir) => dir.isDirectory())
    .flatMap((dir) => readdirSync(path.join(root, dir.name)))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length));
}

function normalize(raw) {
  if (!raw) fail("missing <key>");
  if (raw.endsWith(".jsonl")) {
    const match = raw.match(OMP_FILE);
    if (!match) fail(`not an OMP session file name: ${raw}`);
    return `omp:${match[1]}`;
  }
  if (raw.startsWith("omp:") || raw.startsWith("ext:")) return raw;
  if (raw.startsWith("paseo:")) {
    const id = raw.slice("paseo:".length);
    if (UUID.test(id)) return raw;
    const matches = agentIds().filter((candidate) => candidate.startsWith(id));
    if (matches.length !== 1) fail(`paseo:${id} matches ${matches.length} agents; give more of the id`);
    return `paseo:${matches[0]}`;
  }
  fail(`key must start with paseo:, omp: or ext:, or be a .jsonl path: ${raw}`);
}

function load() {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (parsed.version !== 1 || typeof parsed.memos !== "object") fail(`unexpected format in ${file}`);
  return parsed.memos;
}

function save(memos) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, memos }, null, 2)}\n`);
  renameSync(temporary, file);
}

const [command, rawKey, ...rest] = process.argv.slice(2);
switch (command) {
  case "set": {
    const key = normalize(rawKey);
    const confAt = rest.indexOf("--conf");
    let conf;
    if (confAt !== -1) {
      conf = Number(rest[confAt + 1]);
      if (!/^\d+$/.test(rest[confAt + 1] ?? "") || conf > 100) fail("--conf needs a whole number 0–100");
      rest.splice(confAt, 2);
    }
    const flag = rest.indexOf("--attention");
    const memoWords = flag === -1 ? rest : rest.slice(0, flag);
    const attention = flag === -1 ? "" : rest.slice(flag + 1).join(" ").trim();
    if (flag !== -1 && !attention) fail("--attention needs text");
    const memo = (memoWords.length === 1 && memoWords[0] === "-" ? readFileSync(0, "utf8") : memoWords.join(" ")).trim();
    if (!memo) fail("empty memo; use `clear` to remove one");
    const memos = load();
    memos[key] = { memo, ...(attention ? { attention } : {}), ...(conf === undefined ? {} : { conf }), at: new Date().toISOString() };
    save(memos);
    console.log(`${key}\t${conf === undefined ? "" : `${conf}% `}${attention ? `[${attention}] ` : ""}${memo}`);
    break;
  }
  case "clear": {
    const key = normalize(rawKey);
    const memos = load();
    if (key in memos) {
      delete memos[key];
      save(memos);
    }
    console.log(`${key}\tcleared`);
    break;
  }
  case "get": {
    const entry = load()[normalize(rawKey)];
    if (entry) console.log(`${entry.conf === undefined ? "" : `conf: ${entry.conf}\n`}${entry.attention ? `attention: ${entry.attention}\nmemo: ${entry.memo}` : entry.memo}`);
    break;
  }
  case "list":
    for (const [key, entry] of Object.entries(load())) {
      console.log(`${key}\t${entry.at}\t${entry.conf === undefined ? "" : `${entry.conf}% `}${entry.attention ? `[${entry.attention}] ` : ""}${entry.memo}`);
    }
    break;
  default:
    fail("usage: memo.mjs set <key> <memo…> [--attention <text…>] [--conf <0-100>] | clear <key> | get <key> | list");
}

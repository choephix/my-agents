import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/**
 * An inbox for the running session: other programs on this machine (Stefan's desk) can send it a message as if he
 * typed it.
 *
 * While this omp runs a session it listens at `~/.omp/run/inbox/<session id>.sock`, in a folder only this user can
 * enter, and writes `~/.omp/run/inbox/<pid>.pid` holding that id ("this omp has an inbox"). The protocol is one JSON
 * line in, one JSON line out:
 *
 *   in:  {"text": "...", "key": "..."}   text: the message; key: delivered once, a retry with the same key is not a
 *                                        second turn. No text: only asks "open? busy? called what?".
 *   out: {"ok": true, "sessionId", "title", "idle"}
 *        {"ok": false, "moved": "<id>"}  this omp now runs another session (/new, /resume, a fork, or omp moved the
 *                                        session to a copy); it listens under the new id from now on.
 *
 * Idle, the message starts a turn. Busy, it waits behind the current turn (followUp): it never steers, which would
 * close an open question form and deny pending approvals. The composer's draft is never touched.
 *
 * Only the main agent listens; a subagent's memos belong to its parent. No timers: it sits on a listening socket.
 */

const DIR = `${homedir()}/.omp/run/inbox`;
const PID_FILE = `${DIR}/${process.pid}.pid`;
const MAX_LINE = 1 << 20;

interface Request {
	text?: unknown;
	key?: unknown;
}

export default function inbox(pi: ExtensionAPI): void {
	let bound = "";
	let server: Server | null = null;
	let latest: ExtensionContext | null = null;
	const seen = new Set<string>();

	const close = () => {
		server?.close();
		server = null;
		if (bound) rmSync(`${DIR}/${bound}.sock`, { force: true });
		rmSync(PID_FILE, { force: true });
		bound = "";
	};

	const listen = (ctx: ExtensionContext) => {
		latest = ctx;
		const id = ctx.sessionManager.getSessionId();
		if (!id || id === bound) return;
		close();
		mkdirSync(DIR, { recursive: true, mode: 0o700 });
		const path = `${DIR}/${id}.sock`;
		rmSync(path, { force: true }); // a killed omp leaves its socket file behind
		const next = createServer((conn) => serve(conn));
		next.on("error", () => {
			if (server === next) close();
		});
		next.listen(path);
		server = next;
		writeFileSync(PID_FILE, id);
		bound = id;
	};

	const handle = (msg: Request) => {
		const ctx = latest!;
		const id = ctx.sessionManager.getSessionId();
		if (id !== bound) {
			listen(ctx);
			return { ok: false, moved: id };
		}
		const idle = ctx.isIdle();
		const info = { ok: true, sessionId: id, title: ctx.sessionManager.getSessionName() ?? "", idle };
		const text = typeof msg.text === "string" ? msg.text : "";
		const key = typeof msg.key === "string" ? msg.key : "";
		if (!text || (key && seen.has(key))) return info;
		if (key) seen.add(key);
		const sent = idle ? pi.sendUserMessage(text) : pi.sendUserMessage(text, { deliverAs: "followUp" });
		void Promise.resolve(sent).catch(() => {});
		return info;
	};

	const serve = (conn: Socket) => {
		let buffer = "";
		conn.setEncoding("utf8");
		conn.on("error", () => conn.destroy());
		conn.on("data", (chunk: string) => {
			buffer += chunk;
			const end = buffer.indexOf("\n");
			if (end < 0) {
				if (buffer.length > MAX_LINE) conn.destroy();
				return;
			}
			let reply: object;
			try {
				reply = handle(JSON.parse(buffer.slice(0, end)) as Request);
			} catch (error) {
				reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
			}
			conn.end(`${JSON.stringify(reply)}\n`);
		});
	};

	const onSession = (_event: unknown, ctx: ExtensionContext) => {
		if (ctx.agent.kind === "main") listen(ctx);
	};
	pi.on("session_start", onSession);
	pi.on("session_switch", onSession);
	pi.on("session_branch", onSession);
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.agent.kind === "main") close();
	});
}

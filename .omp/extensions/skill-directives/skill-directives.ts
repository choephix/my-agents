/**
 * skill-directives — opt-in Claude-Code-style directives for skills.
 *
 * SKILL.md frontmatter flags (kebab-case, boolean):
 *   expand-imports: true      -> expand `@path/to/file` references (same engine
 *                                and semantics omp uses for AGENTS.md/CLAUDE.md:
 *                                relative to the skill dir, ~ expansion, 5-hop
 *                                recursion, cycle-safe, code-fence protected).
 *   shell-substitution: true  -> replace full lines of the form  !`command`
 *                                with the command's output. Additionally gated
 *                                by location: the skill must live under a
 *                                dot-directory skills root in $HOME
 *                                (~/.agents/skills, ~/.claude/skills,
 *                                ~/.omp/…/skills, …) or inside the current
 *                                project (a `skills` path segment under cwd).
 *
 * Covered injection paths:
 *   1. `read` tool on `skill://<name>`            (tool_result patch, persists)
 *   2. `/skill:<name>` custom-message injection   (context-event rewrite, cached
 *                                                  per invocation so commands run
 *                                                  once, not once per LLM call)
 *
 * Safety invariants:
 *   - `!` lines are only executed when authored in SKILL.md itself; content
 *     pulled in via `@` imports is never shell-executed, and command output is
 *     never re-scanned for `@` imports.
 *   - Reading with a selector (e.g. `skill://name:raw`) bypasses expansion.
 */
import { readFile, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { expandAtImports } from "@oh-my-pi/pi-coding-agent/discovery/at-imports";

const SHELL_LINE = /^[ \t]*!`(.+)`[ \t]*$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SKILL_URL = /^skill:\/\/[^/:?#]+(\/SKILL\.md)?$/;
const SHELL_TIMEOUT_MS = 30_000;
const MAX_SHELL_OUTPUT = 32_768;

interface SkillFlags {
	mtimeMs: number;
	raw: string;
	imports: boolean;
	shell: boolean;
}

interface TextBlockLike {
	type: string;
	text?: string;
}

/** Structural view of a skill-prompt CustomMessage (see session/messages.ts). */
interface SkillPromptMessageLike {
	role?: string;
	customType?: string;
	timestamp?: number;
	details?: { path?: unknown };
	content?: string | TextBlockLike[];
}

export default function skillDirectives(pi: ExtensionAPI) {
	pi.setLabel("Skill directives (@imports, !`shell`)");

	const flagCache = new Map<string, SkillFlags>();
	/** Stable expansion per /skill: invocation (keyed by message identity). */
	const invocationCache = new Map<string, string>();
	const warnedPaths = new Set<string>();

	async function flagsFor(skillPath: string): Promise<SkillFlags | undefined> {
		let mtimeMs: number;
		try {
			mtimeMs = (await stat(skillPath)).mtimeMs;
		} catch {
			return undefined;
		}
		const cached = flagCache.get(skillPath);
		if (cached && cached.mtimeMs === mtimeMs) return cached;
		const raw = await readFile(skillPath, "utf8");
		const yaml = raw.match(FRONTMATTER)?.[1] ?? "";
		const entry: SkillFlags = {
			mtimeMs,
			raw,
			imports: /^expand-imports:\s*(true|yes)\s*$/m.test(yaml),
			shell: /^shell-substitution:\s*(true|yes)\s*$/m.test(yaml),
		};
		flagCache.set(skillPath, entry);
		return entry;
	}

	/** `!` execution gate: a skills dir under a dot-dir in $HOME, or inside the project. */
	function shellAllowed(skillPath: string, cwd: string): boolean {
		const abs = path.resolve(skillPath);
		const relCwd = path.relative(path.resolve(cwd), abs);
		const relHome = path.relative(os.homedir(), abs);
		if (relHome && !relHome.startsWith("..") && !path.isAbsolute(relHome)) {
			const segs = relHome.split(path.sep);
			if (segs[0]?.startsWith(".") && segs.slice(1, -1).includes("skills")) return true;
		}
		if (relCwd && !relCwd.startsWith("..") && !path.isAbsolute(relCwd) && relCwd.split(path.sep).slice(0, -1).includes("skills")) {
			return true;
		}
		return false;
	}

	async function runShell(command: string, cwd: string): Promise<string> {
		let result: { stdout: string; stderr: string; code: number; killed: boolean };
		try {
			result = await pi.exec("bash", ["-c", command], { timeout: SHELL_TIMEOUT_MS, cwd });
		} catch (err) {
			return `[shell substitution failed: ${err instanceof Error ? err.message : String(err)}]`;
		}
		let out = result.stdout;
		if (result.stderr.trim()) out += (out && !out.endsWith("\n") ? "\n" : "") + result.stderr;
		out = out.trimEnd();
		if (result.killed) out += `${out ? "\n" : ""}[shell substitution timed out after ${SHELL_TIMEOUT_MS / 1000}s]`;
		else if (result.code !== 0) out += `${out ? "\n" : ""}[exit ${result.code}]`;
		if (out.length > MAX_SHELL_OUTPUT) out = `${out.slice(0, MAX_SHELL_OUTPUT)}\n[output truncated]`;
		return out;
	}

	/**
	 * Replace authored !`cmd` lines with placeholder tokens (code-fence aware),
	 * so `@` expansion can run in between without executing imported content or
	 * re-scanning command output.
	 */
	function extractShellLines(body: string): { body: string; pending: Array<{ token: string; command: string }> } {
		const pending: Array<{ token: string; command: string }> = [];
		const lines = body.split("\n");
		let fence: { char: string; len: number } | null = null;
		for (let i = 0; i < lines.length; i++) {
			const fenceMatch = lines[i].match(/^\s*(`{3,}|~{3,})/);
			if (fenceMatch) {
				const char = fenceMatch[1][0];
				const len = fenceMatch[1].length;
				if (!fence) fence = { char, len };
				else if (char === fence.char && len >= fence.len) fence = null;
				continue;
			}
			if (fence) continue;
			const m = lines[i].match(SHELL_LINE);
			if (!m) continue;
			const token = `\u0000omp-skill-shell-${i}-${pending.length}\u0000`;
			pending.push({ token, command: m[1] });
			lines[i] = token;
		}
		return { body: lines.join("\n"), pending };
	}

	interface ExpandOptions {
		cwd: string;
		notify?: (message: string) => void;
	}

	/** Full pipeline for one skill body. Returns the input unchanged when nothing applies. */
	async function expandBody(body: string, skillPath: string, flags: SkillFlags, options: ExpandOptions): Promise<string> {
		let text = body;
		let pending: Array<{ token: string; command: string }> = [];
		if (flags.shell) {
			if (shellAllowed(skillPath, options.cwd)) {
				({ body: text, pending } = extractShellLines(text));
			} else if (!warnedPaths.has(skillPath)) {
				warnedPaths.add(skillPath);
				const msg = `skill-directives: ${skillPath} requests shell-substitution but is outside a trusted skills dir; !\`...\` left literal`;
				pi.logger.warn(msg);
				options.notify?.(msg);
			}
		}
		if (flags.imports) {
			text = await expandAtImports(text, skillPath);
		}
		const baseDir = path.dirname(skillPath);
		for (const { token, command } of pending) {
			const output = await runShell(command, baseDir);
			text = text.replace(token, () => output);
		}
		return text;
	}

	// Path 1: `read` on skill://<name> — patch the tool result (persists in session).
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "read" || event.isError) return;
		const inputPath = typeof event.input.path === "string" ? event.input.path : undefined;
		if (!inputPath || !SKILL_URL.test(inputPath)) return;
		const resolved = event.details?.resolvedPath;
		if (!resolved) return;
		try {
			const flags = await flagsFor(resolved);
			if (!flags || (!flags.imports && !flags.shell)) return;
			const fmMatch = flags.raw.match(FRONTMATTER);
			const fmLength = fmMatch ? fmMatch[0].length : 0;
			const body = flags.raw.slice(fmLength);
			const expanded = await expandBody(body, resolved, flags, {
				cwd: ctx.cwd,
				notify: msg => ctx.ui.notify(msg, "warning"),
			});
			if (expanded === body) return;
			return { content: [{ type: "text", text: flags.raw.slice(0, fmLength) + expanded }] };
		} catch (err) {
			pi.logger.warn(`skill-directives: read patch failed for ${resolved}: ${err instanceof Error ? err.message : String(err)}`);
		}
	});

	// Path 2: /skill:<name> custom-message injection — rewrite the LLM-bound copy.
	pi.on("context", async (event, ctx) => {
		let changed = false;
		// AgentMessage is a broad provider union; skill-prompt custom messages are
		// identified structurally, so narrow through a minimal shape instead.
		const messages = event.messages as unknown as SkillPromptMessageLike[];
		for (const message of messages) {
			if (message.role !== "custom" || message.customType !== "skill-prompt") continue;
			const skillPath = message.details && typeof message.details === "object" && "path" in message.details
				? message.details.path
				: undefined;
			if (typeof skillPath !== "string") continue;
			const textBlock = Array.isArray(message.content)
				? message.content.find(block => block.type === "text")
				: undefined;
			const text = typeof message.content === "string" ? message.content : textBlock?.text;
			if (!text) continue;
			try {
				const cacheKey = `${skillPath}\u0000${message.timestamp ?? ""}\u0000${Bun.hash(text)}`;
				let expanded = invocationCache.get(cacheKey);
				if (expanded === undefined) {
					const flags = await flagsFor(skillPath);
					if (!flags || (!flags.imports && !flags.shell)) continue;
					expanded = await expandBody(text, skillPath, flags, {
						cwd: ctx.cwd,
						notify: msg => ctx.ui.notify(msg, "warning"),
					});
					invocationCache.set(cacheKey, expanded);
				}
				if (expanded === text) continue;
				if (typeof message.content === "string") message.content = expanded;
				else if (textBlock) textBlock.text = expanded;
				changed = true;
			} catch (err) {
				pi.logger.warn(`skill-directives: context rewrite failed for ${skillPath}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		if (changed) return { messages: event.messages };
	});
}

import path from "node:path";

export type ShadowJob = {
	name: string;
	model: string;
	instruction: string;
	workdir?: string;
	tools: string[];
	quiesceSecs: number;
	catchupCap: number;
	maxCostUsd: number;
	/** If set, only sessions whose cwd contains any of these substrings. */
	matchCwd?: string[];
};

const DEFAULT_TOOLS = ["read", "grep", "glob", "write", "edit", "bash"];

/**
 * Load a job file. Supports a constrained TOML subset: `key = value` with
 * strings, triple-quoted strings, numbers, booleans, and string arrays.
 */
export async function loadJob(jobPath: string): Promise<ShadowJob> {
	const resolved = path.resolve(jobPath);
	const text = await Bun.file(resolved).text();
	const raw = parseJobToml(text);
	const inlineInstruction = stringField(raw, "instruction");
	const instructionFile = stringField(raw, "instruction_file");
	if (inlineInstruction && instructionFile) {
		throw new Error(`${jobPath}: use either "instruction" or "instruction_file", not both`);
	}
	let instruction = inlineInstruction;
	if (instructionFile) {
		const resolvedInstruction = path.resolve(path.dirname(resolved), instructionFile);
		const file = Bun.file(resolvedInstruction);
		if (!(await file.exists())) {
			throw new Error(`${jobPath}: instruction file not found: ${resolvedInstruction}`);
		}
		instruction = await file.text();
	}
	if (!instruction || instruction.trim().length === 0) {
		throw new Error(`${jobPath}: "instruction" or "instruction_file" is required`);
	}
	const name = stringField(raw, "name") || path.basename(resolved, path.extname(resolved));
	if (!/^[A-Za-z0-9._-]+$/.test(name)) {
		throw new Error(`${jobPath}: "name" must be a filesystem-safe token, got ${JSON.stringify(name)}`);
	}
	return {
		name,
		model: stringField(raw, "model") || "openai-codex/gpt-5.6-luna",
		instruction,
		workdir: resolveOptionalPath(raw, "workdir", path.dirname(resolved)),
		tools: stringArray(raw, "tools") ?? DEFAULT_TOOLS,
		quiesceSecs: numberField(raw, "quiesce_secs") ?? 0,
		catchupCap: numberField(raw, "catchup_cap") ?? 100,
		maxCostUsd: numberField(raw, "max_cost_usd") ?? 50,
		matchCwd: stringArray(raw, "match_cwd"),
	};
}

type TomlValue = string | number | boolean | string[];
type TomlTable = Record<string, TomlValue>;

function stringField(table: TomlTable, key: string): string | undefined {
	const value = table[key];
	return typeof value === "string" ? value : undefined;
}

function resolveOptionalPath(table: TomlTable, key: string, base: string): string | undefined {
	const value = stringField(table, key);
	return value ? path.resolve(base, value) : undefined;
}

function numberField(table: TomlTable, key: string): number | undefined {
	const value = table[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(table: TomlTable, key: string): string[] | undefined {
	const value = table[key];
	return Array.isArray(value) ? value : undefined;
}

export function parseJobToml(text: string): TomlTable {
	const table: TomlTable = {};
	let index = 0;
	while (index < text.length) {
		index = skipWsAndComments(text, index);
		if (index >= text.length) break;
		const keyStart = index;
		while (index < text.length && /[A-Za-z0-9_]/.test(text[index] ?? "")) index++;
		const key = text.slice(keyStart, index);
		if (!key) throw new Error(`toml: expected key at ${index}`);
		index = skipWs(text, index);
		if (text[index] !== "=") throw new Error(`toml: expected '=' after ${key}`);
		index = skipWs(text, index + 1);
		const parsed = parseValue(text, index);
		table[key] = parsed.value;
		index = parsed.next;
	}
	return table;
}

function parseValue(text: string, start: number): { value: TomlValue; next: number } {
	if (text.startsWith('"""', start)) {
		const end = text.indexOf('"""', start + 3);
		if (end < 0) throw new Error("toml: unterminated triple-quoted string");
		return { value: text.slice(start + 3, end).replace(/^\n/, ""), next: end + 3 };
	}
	if (text[start] === '"') {
		let index = start + 1;
		let out = "";
		while (index < text.length) {
			const ch = text[index];
			if (ch === '"') return { value: out, next: index + 1 };
			if (ch === "\\" && index + 1 < text.length) {
				const next = text[index + 1];
				out += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
				index += 2;
				continue;
			}
			out += ch;
			index++;
		}
		throw new Error("toml: unterminated string");
	}
	if (text[start] === "[") {
		const items: string[] = [];
		let index = skipWsAndComments(text, start + 1);
		while (index < text.length && text[index] !== "]") {
			const parsed = parseValue(text, index);
			if (typeof parsed.value !== "string") throw new Error("toml: arrays may only contain strings");
			items.push(parsed.value);
			index = skipWsAndComments(text, parsed.next);
			if (text[index] === ",") index = skipWsAndComments(text, index + 1);
		}
		if (text[index] !== "]") throw new Error("toml: unterminated array");
		return { value: items, next: index + 1 };
	}
	if (text.startsWith("true", start) && !isIdent(text[start + 4])) return { value: true, next: start + 4 };
	if (text.startsWith("false", start) && !isIdent(text[start + 5])) return { value: false, next: start + 5 };
	const numMatch = text.slice(start).match(/^-?\d+(\.\d+)?/);
	if (numMatch) return { value: Number(numMatch[0]), next: start + numMatch[0].length };
	throw new Error(`toml: unsupported value at ${start}`);
}

function isIdent(ch: string | undefined): boolean {
	return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function skipWs(text: string, index: number): number {
	while (index < text.length && /[ \t]/.test(text[index] ?? "")) index++;
	return index;
}

function skipWsAndComments(text: string, index: number): number {
	while (index < text.length) {
		const ch = text[index];
		if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
			index++;
			continue;
		}
		if (ch === "#") {
			while (index < text.length && text[index] !== "\n") index++;
			continue;
		}
		break;
	}
	return index;
}

/** One finished main-session turn, as written by the capture extension. */
export type LedgerPointer = {
	ts: string;
	session: string;
	cwd: string;
	/** Session id, when the manager had one. */
	id?: string;
	/** Assistant entry that closed the turn, when known. */
	leaf?: string;
};

export function isLedgerPointer(value: unknown): value is LedgerPointer {
	if (!value || typeof value !== "object") return false;
	const rec = value as Record<string, unknown>;
	return typeof rec.ts === "string" && typeof rec.session === "string" && typeof rec.cwd === "string";
}

export function parseCursor(raw: string): number {
	const offset = Number.parseInt(raw.trim(), 10);
	return Number.isFinite(offset) && offset >= 0 ? offset : 0;
}

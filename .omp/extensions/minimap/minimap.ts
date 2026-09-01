/**
 * minimap — a keyboard-driven conversation outline for long omp sessions.
 *
 * `/minimap` opens a focused two-pane overlay:
 *   left  — the full text of the selected message, scrollable;
 *   right — one line per user/assistant message, newest at the bottom.
 *
 * Up/Down moves through messages, PgUp/PgDn scrolls the selected message,
 * Home/End jumps to the ends, Esc (or Enter) closes and restores the editor.
 *
 * Deliberately absent from the outline: thinking blocks, tool calls, tool
 * results, hook/custom/system messages, and assistant turns that produced no
 * visible text — that traffic is exactly what makes a long session hard to
 * navigate.
 *
 * The outline is built when the command runs and discarded when it closes:
 * no timers, listeners, caches, or background work exist between invocations.
 *
 * Uninstall: delete this file.
 */
import type { ExtensionAPI, SessionEntry } from "@oh-my-pi/pi-coding-agent";
import {
	type Component,
	matchesKey,
	padding,
	ScrollView,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@oh-my-pi/pi-tui";

export interface MinimapItem {
	/** Session entry id — stable across renders, used to invalidate the preview. */
	id: string;
	role: "user" | "assistant";
	/** Visible text only; tool and thinking content is never included. */
	text: string;
}

/** The subset of the omp theme this overlay needs; the real `Theme` satisfies it. */
export interface MinimapTheme {
	fg(color: "accent" | "border" | "dim" | "muted" | "success", text: string): string;
	bold(text: string): string;
	readonly boxRound: {
		topLeft: string;
		topRight: string;
		bottomLeft: string;
		bottomRight: string;
		horizontal: string;
		vertical: string;
		teeRight: string;
		teeLeft: string;
		teeDown: string;
		teeUp: string;
	};
}

export interface MinimapViewDeps {
	items: readonly MinimapItem[];
	theme: MinimapTheme;
	/** Repaint after a state change. */
	requestRender(): void;
	/** Dismiss the overlay. */
	close(): void;
	/** Terminal height source; defaults to the real stdout. */
	terminalRows?(): number;
}

const ROLE_LABEL: Record<MinimapItem["role"], string> = { user: "You", assistant: "Agent" };
/** Width of the widest role label, so outline text starts at one column. */
const ROLE_WIDTH = 5;
/** Top border, heading row, divider, footer, bottom border. */
const CHROME_ROWS = 5;
const MIN_BODY_ROWS = 3;
const MIN_TOTAL_WIDTH = 40;
const MIN_OUTLINE_WIDTH = 24;
const MAX_OUTLINE_WIDTH = 52;
const MIN_PREVIEW_WIDTH = 24;
/** Columns consumed by borders and insets in a two-pane row. */
const SPLIT_CHROME_COLS = 7;

/** Text of a message's visible content blocks; "" when it has none. */
function textFromContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const { type, text } = block as { type?: unknown; text?: unknown };
		if (type !== "text" || typeof text !== "string") continue;
		const trimmed = text.trim();
		if (trimmed) parts.push(trimmed);
	}
	return parts.join("\n\n");
}

/**
 * The human conversation outline for a session branch, oldest first.
 *
 * Agent-attributed user messages (steering envelopes, auto-continue prompts)
 * are omitted along with every non-message entry: the outline answers "what
 * did we say to each other", not "what happened".
 */
export function buildMinimapItems(entries: readonly SessionEntry[]): MinimapItem[] {
	const items: MinimapItem[] = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;
		if (message.role === "user" && message.attribution === "agent") continue;
		const text = textFromContent(message.content);
		if (!text) continue;
		items.push({ id: entry.id, role: message.role, text });
	}
	return items;
}

/**
 * The overlay itself: a pure function of `items` plus a selection index.
 *
 * Selection drives the preview pane rather than the underlying transcript —
 * omp's transcript is committed to native terminal scrollback, which no
 * portable escape sequence can reposition.
 */
export class MinimapView implements Component {
	#selected: number;
	#preview: ScrollView;
	#previewItemId: string | undefined;
	#previewWidth = -1;
	#bodyRows = MIN_BODY_ROWS;
	#outlineStart = 0;

	constructor(private readonly deps: MinimapViewDeps) {
		this.#selected = Math.max(0, deps.items.length - 1);
		this.#preview = new ScrollView([], {
			height: MIN_BODY_ROWS,
			scrollbar: "auto",
			theme: {
				track: text => deps.theme.fg("dim", text),
				thumb: text => deps.theme.fg("accent", text),
			},
		});
	}

	/** Index of the message shown in the preview pane. */
	get selectedIndex(): number {
		return this.#selected;
	}

	invalidate(): void {
		this.#previewItemId = undefined;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "return")) {
			this.deps.close();
			return;
		}
		if (matchesKey(data, "up")) {
			this.#select(this.#selected - 1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.#select(this.#selected + 1);
			return;
		}
		if (matchesKey(data, "home")) {
			this.#select(0);
			return;
		}
		if (matchesKey(data, "end")) {
			this.#select(this.deps.items.length - 1);
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.#preview.page(-1);
			this.deps.requestRender();
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.#preview.page(1);
			this.deps.requestRender();
		}
	}

	#select(index: number): void {
		const next = Math.max(0, Math.min(this.deps.items.length - 1, index));
		if (next === this.#selected) return;
		this.#selected = next;
		// A new message always starts at its first line, never mid-scroll.
		this.#previewItemId = undefined;
		this.#preview.scrollToTop();
		this.deps.requestRender();
	}

	render(width: number): readonly string[] {
		const { items, theme } = this.deps;
		const totalWidth = Math.max(MIN_TOTAL_WIDTH, Math.trunc(width));
		const terminalRows = this.deps.terminalRows?.() ?? process.stdout.rows ?? 40;
		const height = Math.max(CHROME_ROWS + MIN_BODY_ROWS, terminalRows - 2);
		this.#bodyRows = height - CHROME_ROWS;

		// The outline takes a third of the frame, bounded; the preview takes the
		// rest. Widths must sum exactly, or the box borders drift apart.
		let outlineWidth = Math.max(MIN_OUTLINE_WIDTH, Math.min(MAX_OUTLINE_WIDTH, Math.floor(totalWidth * 0.34)));
		let previewWidth = totalWidth - outlineWidth - SPLIT_CHROME_COLS;
		if (previewWidth < MIN_PREVIEW_WIDTH) {
			outlineWidth = Math.max(8, totalWidth - MIN_PREVIEW_WIDTH - SPLIT_CHROME_COLS);
			previewWidth = totalWidth - outlineWidth - SPLIT_CHROME_COLS;
		}

		const item = items[this.#selected] ?? items[items.length - 1];
		if (item && (this.#previewItemId !== item.id || this.#previewWidth !== previewWidth)) {
			this.#previewItemId = item.id;
			this.#previewWidth = previewWidth;
			// One column is reserved for the scrollbar, so wrap short of the pane.
			this.#preview.setLines(wrapTextWithAnsi(item.text, Math.max(1, previewWidth - 1)));
		}
		this.#preview.setHeight(this.#bodyRows);
		const previewRows = this.#preview.render(previewWidth);

		this.#outlineStart = Math.max(
			0,
			Math.min(this.#selected - Math.floor(this.#bodyRows / 2), Math.max(0, items.length - this.#bodyRows)),
		);

		const position = item
			? `${ROLE_LABEL[item.role]} ${theme.fg("dim", "·")} message ${this.#selected + 1}/${items.length}`
			: "";
		const footer = [
			`${theme.fg("accent", "↑↓")} message`,
			`${theme.fg("accent", "PgUp/PgDn")} scroll`,
			`${theme.fg("accent", "Home/End")} ends`,
			`${theme.fg("accent", "Esc")} close`,
		].join(theme.fg("dim", " · "));

		const lines: string[] = [];
		lines.push(this.#topBorder(totalWidth, previewWidth, "Conversation Minimap"));
		lines.push(
			this.#splitRow(
				theme.fg("dim", position),
				theme.fg("dim", `${items.length} message${items.length === 1 ? "" : "s"}`),
				totalWidth,
				previewWidth,
			),
		);
		for (let row = 0; row < this.#bodyRows; row++) {
			lines.push(
				this.#splitRow(
					previewRows[row] ?? "",
					this.#outlineRow(this.#outlineStart + row, outlineWidth),
					totalWidth,
					previewWidth,
				),
			);
		}
		lines.push(this.#dividerSplit(totalWidth, previewWidth));
		lines.push(this.#row(footer, totalWidth));
		lines.push(this.#bottomBorder(totalWidth));
		return lines;
	}

	#outlineRow(index: number, width: number): string {
		const item = this.deps.items[index];
		if (!item) return "";
		const theme = this.deps.theme;
		const selected = index === this.#selected;
		const cursor = selected ? theme.fg("accent", "❯ ") : "  ";
		const label = ROLE_LABEL[item.role].padEnd(ROLE_WIDTH);
		const role = item.role === "user" ? theme.fg("accent", label) : theme.fg("success", label);
		const summary = truncateToWidth(
			item.text.replace(/\s+/g, " ").trim(),
			Math.max(1, width - ROLE_WIDTH - 3),
		);
		return `${cursor}${role} ${selected ? theme.bold(summary) : theme.fg("muted", summary)}`;
	}

	// ========================================================================
	// Box chrome (kept local so the whole feature is one deletable file)
	// ========================================================================

	#paint(text: string): string {
		return this.deps.theme.fg("border", text);
	}

	/** Pad or truncate styled text to exactly `width` columns. */
	#fit(text: string, width: number): string {
		if (width <= 0) return "";
		const current = visibleWidth(text);
		if (current === width) return text;
		if (current < width) return text + padding(width - current);
		const cut = truncateToWidth(text, width);
		const cutWidth = visibleWidth(cut);
		return cutWidth < width ? cut + padding(width - cutWidth) : cut;
	}

	#topBorder(width: number, leftWidth: number, title: string): string {
		const box = this.deps.theme.boxRound;
		// The pane divider sits one inset column past the left pane.
		const dividerCol = leftWidth + 3;
		const leftLen = Math.max(0, dividerCol - 1);
		const rightLen = Math.max(0, width - 2 - dividerCol);
		const shown = truncateToWidth(` ${title} `, Math.max(0, leftLen - 1));
		const fill = Math.max(0, leftLen - 1 - visibleWidth(shown));
		return (
			this.#paint(box.topLeft + box.horizontal) +
			this.deps.theme.bold(this.deps.theme.fg("accent", shown)) +
			this.#paint(box.horizontal.repeat(fill) + box.teeDown + box.horizontal.repeat(rightLen) + box.topRight)
		);
	}

	#dividerSplit(width: number, leftWidth: number): string {
		const box = this.deps.theme.boxRound;
		const dividerCol = leftWidth + 3;
		const leftLen = Math.max(0, dividerCol - 1);
		const rightLen = Math.max(0, width - 2 - dividerCol);
		return this.#paint(
			box.teeRight + box.horizontal.repeat(leftLen) + box.teeUp + box.horizontal.repeat(rightLen) + box.teeLeft,
		);
	}

	#bottomBorder(width: number): string {
		const box = this.deps.theme.boxRound;
		return this.#paint(box.bottomLeft + box.horizontal.repeat(Math.max(0, width - 2)) + box.bottomRight);
	}

	#row(content: string, width: number): string {
		const bar = this.#paint(this.deps.theme.boxRound.vertical);
		return `${bar} ${this.#fit(content, Math.max(0, width - 4))} ${bar}`;
	}

	#splitRow(left: string, right: string, width: number, leftWidth: number): string {
		const bar = this.#paint(this.deps.theme.boxRound.vertical);
		const rightWidth = Math.max(0, width - leftWidth - SPLIT_CHROME_COLS);
		return `${bar} ${this.#fit(left, leftWidth)} ${bar} ${this.#fit(right, rightWidth)} ${bar}`;
	}
}

export default function minimap(pi: ExtensionAPI): void {
	pi.setLabel("Conversation Minimap");

	pi.registerCommand("minimap", {
		description: "Navigate this session's user and assistant messages",
		async handler(_args, ctx) {
			if (!ctx.hasUI) {
				ctx.ui.notify("/minimap needs the interactive UI.", "warning");
				return;
			}

			const items = buildMinimapItems(ctx.sessionManager.getBranch());
			if (items.length === 0) {
				ctx.ui.notify("No user or assistant messages yet.", "info");
				return;
			}

			await ctx.ui.custom<undefined>(
				(tui, theme, _keybindings, done) =>
					new MinimapView({
						items,
						theme,
						requestRender: () => tui.requestRender(),
						close: () => done(undefined),
					}),
				{ overlay: true },
			);
		},
	});
}

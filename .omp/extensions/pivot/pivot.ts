/**
 * /pivot — fold everything BEFORE a chosen message into one summary block and
 * keep that message verbatim as the entire kept tail. Defaults to the last
 * assistant message.
 *
 * Use it when the last thing the agent said is the artifact you care about (a
 * plan, a handoff, a decision) and the research that produced it is dead weight:
 * instead of copy-pasting that message into a fresh session and re-explaining
 * how you got there, `/pivot` leaves you with [summary of everything before] +
 * [that message, untouched] on the same branch — the pre-pivot turns stay
 * reachable through /tree.
 *
 * Usage:
 *   /pivot              pin the last assistant message
 *   /pivot <focus>      ...and steer the summary with <focus>
 *   /pivot ? [focus]    pick the pin from a list of recent messages
 *   /pivot ^N [focus]   pin the Nth message from the end (^ and ^1 are the default)
 *
 * Mechanism: `session_before_compact` receives the live CompactionPreparation
 * that SessionMaintenance.compact() keeps using after the handler returns, so
 * re-pointing `firstKeptEntryId` and the three message buckets moves the cut and
 * core does the summarization. The handler never summarizes anything itself —
 * extension handlers are capped at ~30s and a real compaction call exceeds that.
 */
import type {
	ExtensionAPI,
	ExtensionUIContext,
	ReadonlySessionManager,
	SessionEntry,
} from "@oh-my-pi/pi-coding-agent";
import type { AutocompleteItem } from "@oh-my-pi/pi-tui";
// Pure helper, safe to import directly: a bare host-package import resolves to
// the package SOURCE, which under a bundled omp (`dist/cli.js`) is a SECOND
// copy of that module — fine for a stateless function, fatal for anything
// holding state. Live singletons must come through `pi.pi`, the host's own
// module namespace, which is why the keep-budget override below uses it.
import { extractFileOpsFromMessage } from "@oh-my-pi/pi-agent-core/compaction";

const KEEP_RECENT = "compaction.keepRecentTokens";
const PICKER_LIMIT = 30;
/** Ghost text after `/pivot `, mirroring how builtins advertise their arguments. */
const PIVOT_HINT = "[^N|?] [focus instructions]";

const PIVOT_FOCUS = [
	"Summarize everything that happened BEFORE the final assistant message.",
	"That message is kept verbatim at the end of the compacted context — do not restate, quote, or re-plan it.",
	"Write the summary as the background that produced it: the task as it evolved, what was investigated,",
	"what was decided and why, the facts and constraints discovered, files and symbols touched, what is",
	"already done versus still pending, and any dead ends worth not repeating.",
	"Prefer paths, identifiers, commands and numbers over narration.",
].join(" ");

/** First ~70 characters of a message's text, for a one-line picker entry. */
function previewOf(content: unknown): string {
	const parts: string[] = [];
	if (typeof content === "string") {
		parts.push(content);
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (typeof block === "string") parts.push(block);
			else if (block && typeof block === "object" && "text" in block && typeof block.text === "string")
				parts.push(block.text);
		}
	}
	const flat = parts.join(" ").replace(/\s+/g, " ").trim();
	if (!flat) return "(no text)";
	return flat.length > 70 ? `${flat.slice(0, 69)}…` : flat;
}

/**
 * Messages a pivot may keep as the head of the tail, newest first, stopping at
 * the latest compaction boundary — anything older is outside the window this
 * compaction may cut in. toolResult entries are excluded: keeping one without
 * the assistant turn that called it would orphan the tool call. Retry-recovered
 * assistant turns are excluded because the context rebuild drops them, so
 * pinning one would leave the summary alone in context.
 */
function pivotCandidates(entries: readonly SessionEntry[]): { id: string; who: string; preview: string }[] {
	const candidates: { id: string; who: string; preview: string }[] = [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "compaction") break;
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			candidates.push({ id: entry.id, who: "you", preview: previewOf(message.content) });
		} else if (message.role === "assistant" && message.retryRecovery?.status !== "recovered") {
			candidates.push({ id: entry.id, who: "agent", preview: previewOf(message.content) });
		}
	}
	return candidates;
}

export default function pivotExtension(pi: ExtensionAPI) {
	// One-shot arm. Extensions run in-process and the hook fires synchronously
	// inside the awaited ctx.compact(), so a module-level boolean cannot leak
	// into an unrelated (automatic) compaction.
	let armed = false;
	// Entry id the armed pivot expects to become firstKeptEntryId. Consumed by
	// the session_compact verification below.
	let expectPinned: string | undefined;
	// Entry the operator picked with `?` or `^N`, overriding the default pin.
	let requestedPin: string | undefined;
	// The editor asks for argument completions before any command has run, and
	// `getArgumentCompletions` receives no context — so hold on to the session
	// manager handed out by the last lifecycle event. /resume swaps it, hence
	// session_switch as well as session_start.
	let branchSource: ReadonlySessionManager | undefined;
	let autocompleteWrapped = false;

	const adopt = (ctx: { sessionManager: ReadonlySessionManager; ui: ExtensionUIContext }) => {
		branchSource = ctx.sessionManager;
		if (autocompleteWrapped) return;
		autocompleteWrapped = true;
		// Extension commands cannot declare `inlineHint` the way builtins do —
		// interactive-mode maps only name/description/getArgumentCompletions onto
		// the TUI's SlashCommand — so the ghost text has to come from wrapping the
		// editor's provider. Delegate through bound methods: the real provider is
		// a class instance whose methods touch private fields, so neither a spread
		// nor Object.create() would survive being called.
		ctx.ui.addAutocompleteProvider(current => ({
			getSuggestions: current.getSuggestions.bind(current),
			applyCompletion: current.applyCompletion.bind(current),
			trySyncSlashCompletion: current.trySyncSlashCompletion?.bind(current),
			trySyncInlineReplace: current.trySyncInlineReplace?.bind(current),
			getForceFileSuggestions: current.getForceFileSuggestions?.bind(current),
			shouldTriggerFileCompletion: current.shouldTriggerFileCompletion?.bind(current),
			getInlineHint: (lines, cursorLine, cursorCol) => {
				const typed = /^\s*\/pivot\s+(.*)$/.exec((lines[cursorLine] ?? "").slice(0, cursorCol));
				if (!typed) return current.getInlineHint?.(lines, cursorLine, cursorCol) ?? null;
				return typed[1].length === 0 ? PIVOT_HINT : null;
			},
		}));
	};

	pi.on("session_start", (_event, ctx) => adopt(ctx));
	pi.on("session_switch", (_event, ctx) => adopt(ctx));

	pi.registerCommand("pivot", {
		description: "[^N|?] [focus] — pin a message verbatim, summarize everything before it",
		// Offered only once the selector token itself is being typed. An empty
		// argument deliberately yields nothing: an open dropdown suppresses the
		// editor's inline hint (it prefers the selected item's own `hint`), and
		// the hint is what advertises this syntax in the first place.
		getArgumentCompletions: (argumentPrefix: string): AutocompleteItem[] | null => {
			if (!argumentPrefix.startsWith("^") && !argumentPrefix.startsWith("?")) return null;
			if (/\s/.test(argumentPrefix)) return null;
			const entries = branchSource?.getBranch();
			const candidates = entries ? pivotCandidates(entries).slice(0, PICKER_LIMIT) : [];
			// Nothing to pin means nothing to offer — not even the picker, which
			// would only open to report that there is nothing to pivot onto.
			if (candidates.length === 0) return null;
			const items: AutocompleteItem[] = [
				{ value: "?", label: "?", description: "pick from a list" },
				...candidates.map((candidate, i) => ({
					value: `^${i + 1}`,
					label: `^${i + 1} · ${candidate.who}`,
					description: candidate.preview,
				})),
			];
			const matches = items.filter(item => item.value.startsWith(argumentPrefix));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Pivot needs an idle agent.", "warning");
				return;
			}

			// A leading `?` or `^N` chooses the pin; everything after it is focus
			// text. Neither marker is a plausible opening for real prose, so an
			// unprefixed argument stays exactly what it was — a focus prompt.
			const raw = args.trim();
			const marker = /^(\?|\^\d*)\s*/.exec(raw);
			const operatorFocus = (marker ? raw.slice(marker[0].length) : raw).trim();
			const focus = operatorFocus ? `${PIVOT_FOCUS}\n\nOperator focus: ${operatorFocus}` : PIVOT_FOCUS;

			if (marker) {
				const candidates = pivotCandidates(ctx.sessionManager.getBranch());
				if (candidates.length === 0) {
					ctx.ui.notify("Nothing to pivot onto: no messages since the last compaction.", "warning");
					return;
				}
				if (marker[1] === "?") {
					if (!ctx.hasUI) {
						ctx.ui.notify("No interactive UI here — use `/pivot ^N` to pin the Nth message back.", "error");
						return;
					}
					// Labels carry the equivalent `^N` so the picker teaches the
					// headless syntax; the ordinal also keeps every label unique,
					// which is what makes the label-to-index lookup sound.
					const labels = candidates
						.slice(0, PICKER_LIMIT)
						.map((candidate, i) => `^${i + 1} · ${candidate.who} · ${candidate.preview}`);
					const picked = await ctx.ui.select("Keep from which message onward?", labels);
					const index = picked === undefined ? -1 : labels.indexOf(picked);
					if (index < 0) return;
					requestedPin = candidates[index].id;
				} else {
					const nth = marker[1].length > 1 ? Number(marker[1].slice(1)) : 1;
					const target = nth >= 1 ? candidates[nth - 1] : undefined;
					if (!target) {
						ctx.ui.notify(`^${nth} is out of range: only ${candidates.length} message(s) to pivot onto.`, "warning");
						return;
					}
					requestedPin = target.id;
				}
			}

			// compact() runs prepareCompaction and throws "Nothing to compact
			// (session too small)" BEFORE emitting session_before_compact, so on any
			// branch that fits inside keepRecentTokens (default 20k) the budget walk
			// keeps everything, the summarize set is empty, and the hook never fires.
			// Shrinking the keep budget to one token forces the walk to cut at the
			// newest valid cut point — the last assistant message — which is the pin
			// we want anyway; the hook then normalizes the split and pins by id.
			// `override` is runtime-only and never persisted, unlike `set`. It must
			// go through `pi.pi` — the host's live module namespace — because a bare
			// import would hand back an uninitialized duplicate of the settings
			// singleton under a bundled omp.
			const settings = pi.pi.settings;
			const previousKeep = settings.get(KEEP_RECENT);
			settings.override(KEEP_RECENT, 1);
			armed = true;
			try {
				// Non-empty instructions are load-bearing, not decoration: they are
				// what keeps compact() off the snapcompact path for users who have
				// compaction.strategy = snapcompact configured.
				await ctx.compact(focus);
			} catch (err) {
				ctx.ui.notify(`Pivot failed: ${err instanceof Error ? err.message : String(err)}`, "error");
			} finally {
				armed = false;
				requestedPin = undefined;
				expectPinned = undefined;
				// Drop our override first; only re-assert one if the underlying
				// config disagrees, i.e. the user genuinely had a prior override.
				settings.clearOverride(KEEP_RECENT);
				if (settings.get(KEEP_RECENT) !== previousKeep) settings.override(KEEP_RECENT, previousKeep);
			}
		},
	});

	pi.on("session_before_compact", (event, ctx) => {
		if (!armed) return;
		armed = false;

		const prep = event.preparation;

		// The pin: the operator's pick, else the newest assistant entry. Either
		// way the scan stops at the latest compaction boundary — anything older is
		// outside the window this compaction may cut in.
		let pinnedId: string | undefined;
		let pinnedMessage: (typeof prep.recentMessages)[number] | undefined;
		for (let i = event.branchEntries.length - 1; i >= 0; i--) {
			const entry = event.branchEntries[i];
			if (entry.type === "compaction") break;
			if (entry.type !== "message") continue;
			if (requestedPin) {
				if (entry.id !== requestedPin) continue;
			} else {
				// Retry-recovered turns are dropped by the context rebuild, so
				// pinning one would leave the summary alone in context.
				if (entry.message.role !== "assistant") continue;
				if (entry.message.retryRecovery?.status === "recovered") continue;
			}
			pinnedId = entry.id;
			pinnedMessage = entry.message;
			break;
		}
		if (!pinnedId || !pinnedMessage) {
			ctx.ui.notify(
				requestedPin
					? "Nothing to pivot onto: the chosen message is no longer on this branch."
					: "Nothing to pivot onto: no assistant message since the last compaction.",
				"warning",
			);
			return { cancel: true };
		}

		// The three buckets concatenated ARE the window's messages in order, and
		// message entries hand out their `message` by reference — so identity
		// locates the cut without re-deriving the window's boundary index.
		const window = [...prep.messagesToSummarize, ...prep.turnPrefixMessages, ...prep.recentMessages];
		const cut = window.indexOf(pinnedMessage);
		if (cut < 0) {
			ctx.ui.notify("Nothing to pivot: the last assistant message is outside the compaction window.", "warning");
			return { cancel: true };
		}
		if (cut === 0) {
			ctx.ui.notify("Nothing to pivot: no history before the last assistant message.", "warning");
			return { cancel: true };
		}

		// fileOps was extracted from the ORIGINAL (narrower) summarize set. The
		// messages between it and the cut are newly summarized, so their reads and
		// writes must be folded in or the <files> block under-reports.
		for (let i = prep.messagesToSummarize.length; i < cut; i++) {
			extractFileOpsFromMessage(window[i], prep.fileOps);
		}

		prep.firstKeptEntryId = pinnedId;
		prep.messagesToSummarize = window.slice(0, cut);
		prep.recentMessages = window.slice(cut);
		// One summary block, not two: a split turn emits a second turn-prefix
		// summary and breaks the "exactly one block" contract.
		prep.turnPrefixMessages = [];
		prep.isSplitTurn = false;
		// Provider-native compaction returns an opaque replacementHistory and the
		// context rebuild then stops emitting kept entries — the pinned message
		// would vanish into the blob. `settings` here is a per-invocation object
		// built by Settings.getGroup(), so this cannot leak into user settings.
		prep.settings.remoteEnabled = false;

		expectPinned = pinnedId;
	});

	// The mutation above depends on session_before_compact handing out the live
	// CompactionPreparation (the runner passes `event` straight to the handler,
	// no clone). That is observed behavior, not a documented contract: if a
	// future omp clones the payload, the pivot silently degrades into an ordinary
	// compaction that summarizes away the very message it was meant to keep.
	// Verify against the entry that actually got written.
	pi.on("session_compact", (event, ctx) => {
		const expected = expectPinned;
		expectPinned = undefined;
		if (!expected || event.compactionEntry.firstKeptEntryId === expected) return;
		ctx.ui.notify(
			"Pivot did NOT take — omp used its own cut point, so the last assistant message was summarized away instead of kept. pivot.ts needs updating for this omp version.",
			"error",
		);
	});
}

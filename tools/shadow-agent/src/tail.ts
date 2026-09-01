import { type FSWatcher, watch } from "node:fs";

export type TailHandle = { stop: () => void };

export type TailSpan = { start: number; end: number };

export type TailOptions = {
	/** Start at end of file, ignoring existing history. Ignored when `fromOffset` is set. */
	fromEnd: boolean;
	/** Resume from this byte offset. */
	fromOffset?: number;
	/** Poll interval backing up fs.watch. Default 500ms. */
	pollMs?: number;
};

export type TailListener = (entry: unknown, span: TailSpan) => void;

/**
 * Follow an append-only JSONL file, emitting one parsed object per complete line.
 *
 * Session files are appended incrementally but can also be atomically rewritten
 * (migrations, rename, move/fork) — a rename-over swaps the inode out from under
 * `fs.watch`, so a path-reopening poll backs it up and a shrunken file resets the
 * read offset. Unparseable lines are skipped, matching the lenient session loader.
 */
export function tailJsonl(file: string, options: TailOptions, onEntry: TailListener): TailHandle {
	let offset = options.fromOffset ?? (options.fromEnd ? Number(Bun.file(file).size) : 0);
	let remainder = "";
	let remainderStart = offset;
	let reading = false;
	let pending = false;
	let stopped = false;

	async function pump(): Promise<void> {
		if (stopped) return;
		if (reading) {
			pending = true;
			return;
		}
		reading = true;
		try {
			const handle = Bun.file(file);
			const size = Number(handle.size);
			if (size < offset) {
				// Truncated or rewritten underneath us: restart from the top.
				offset = 0;
				remainder = "";
				remainderStart = 0;
			}
			if (size > offset) {
				const chunk = await handle.slice(offset, size).text();
				const chunkStart = offset;
				offset = size;
				const lines = (remainder + chunk).split("\n");
				// Last element is either "" or a partial line still being written.
				const nextRemainder = lines.pop() ?? "";
				let lineStart = remainderStart;
				for (const line of lines) {
					const bytes = Buffer.byteLength(line, "utf8") + 1;
					const trimmed = line.trim();
					if (trimmed) {
						try {
							onEntry(JSON.parse(trimmed), { start: lineStart, end: lineStart + bytes });
						} catch {
							// skip unparseable, matching the lenient session loader
						}
					}
					lineStart += bytes;
				}
				remainder = nextRemainder;
				remainderStart = chunkStart + Buffer.byteLength(chunk, "utf8") - Buffer.byteLength(remainder, "utf8");
			}
		} finally {
			reading = false;
			if (pending) {
				pending = false;
				void pump();
			}
		}
	}

	let watcher: FSWatcher | undefined;
	try {
		watcher = watch(file, () => void pump());
	} catch {
		// File may not exist yet; the poll below picks it up.
	}
	const timer = setInterval(() => void pump(), options.pollMs ?? 500);
	void pump();

	return {
		stop: () => {
			stopped = true;
			watcher?.close();
			clearInterval(timer);
		},
	};
}

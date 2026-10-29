import { stat, open } from "node:fs/promises";

interface FileState<T> {
  ino: number;
  /** Bytes folded so far; always just past a `\n`. */
  offset: number;
  acc: T;
}

/**
 * A fold over a JSONL file's complete lines that reads only the bytes appended since the last
 * call. A shrunk or replaced file (other inode) starts over. Reads of one file run one at a time.
 */
export class TailFold<T> {
  private readonly files = new Map<string, FileState<T>>();
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly create: () => T,
    private readonly chunkBytes = 4 * 1024 * 1024,
  ) {}

  /** Rejects when the file can't be read (ENOENT included). */
  read(file: string, fold: (acc: T, line: string) => void): Promise<T> {
    const run = (this.queues.get(file) ?? Promise.resolve()).then(() => this.advance(file, fold));
    const settled = run.catch(() => undefined);
    this.queues.set(file, settled);
    void settled.then(() => {
      if (this.queues.get(file) === settled) this.queues.delete(file);
    });
    return run;
  }

  private async advance(file: string, fold: (acc: T, line: string) => void): Promise<T> {
    const info = await stat(file);
    let state = this.files.get(file);
    if (!state || state.ino !== info.ino || info.size < state.offset) {
      state = { ino: info.ino, offset: 0, acc: this.create() };
      this.files.set(file, state);
    }
    if (info.size === state.offset) return state.acc;
    const handle = await open(file, "r");
    try {
      let position = state.offset;
      // A line longer than a chunk collects here until its `\n` arrives.
      let carry: Buffer[] = [];
      let carryBytes = 0;
      while (position < info.size) {
        const length = Math.min(this.chunkBytes, info.size - position);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        if (bytesRead === 0) break;
        position += bytesRead;
        const chunk = buffer.subarray(0, bytesRead);
        const newline = chunk.lastIndexOf(0x0a);
        if (newline < 0) {
          carry.push(chunk);
          carryBytes += bytesRead;
          continue;
        }
        const complete = carry.length ? Buffer.concat([...carry, chunk.subarray(0, newline)]) : chunk.subarray(0, newline);
        for (const line of complete.toString("utf8").split("\n")) if (line) fold(state.acc, line);
        state.offset += carryBytes + newline + 1;
        const rest = chunk.subarray(newline + 1);
        carry = rest.length ? [rest] : [];
        carryBytes = rest.length;
      }
    } finally {
      await handle.close();
    }
    return state.acc;
  }
}

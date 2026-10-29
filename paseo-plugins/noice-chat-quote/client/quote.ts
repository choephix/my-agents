/**
 * The selected text as a Markdown block quote: each line `> line`, an empty line `>`. Blank lines
 * around the selection and trailing spaces on its lines are dropped. Null when only whitespace was
 * selected.
 */
export function blockQuote(selection: string): string | null {
  const lines = selection.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (!lines.length) return null;
  return lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
}

export interface QuotedDraft {
  text: string;
  /** Where the caret goes: after the blank line that follows the quote. */
  caret: number;
}

/**
 * The message box after quoting `selection` into `draft`. The quote goes at the end, one blank line
 * after the draft's text (an empty or whitespace-only draft is replaced), and is followed by a blank
 * line for the reply.
 */
export function appendQuote(draft: string, selection: string): QuotedDraft | null {
  const quote = blockQuote(selection);
  if (quote === null) return null;
  const head = draft.trimEnd();
  const text = head ? `${head}\n\n${quote}\n\n` : `${quote}\n\n`;
  return { text, caret: text.length };
}

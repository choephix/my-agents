// Pure rules for choice links: what a link's prompt is, how a pick changes the message box, and
// which state each choice is in. No DOM here; web.ts reads the page and applies the result.

export type ChoiceState = "open" | "picked" | "passed-over" | "accepted" | "stale";

/** One question: the choices of one paragraph or one list in a reply, and the user messages sent after that reply. */
export interface Question {
  readonly prompts: readonly string[];
  readonly laterMessages: readonly string[];
}

/**
 * The prompt a choice carries: its href after `@`. A bare `@` uses the label. A prompt written with
 * spaces is taken as written; one without spaces may be URL-encoded and is decoded when it can be.
 */
export function choicePrompt(href: string, label: string): string {
  const raw = href.slice(1).trim();
  if (!raw) return label.trim();
  if (/\s/.test(raw) || !raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw;
  }
}

const sameLine = (line: string, prompt: string) => line.trim() === prompt.trim();

export const hasWholeLine = (text: string, prompt: string) => text.split(/\r?\n/).some((line) => sameLine(line, prompt));

/**
 * The message box after a pick. A first pick from a question goes on its own line at the end. While
 * that line is still in the box unedited, a pick of another choice from the same question replaces
 * it in place, and a second pick of the same choice takes it out again. Text the user typed stays.
 */
export function fillChoiceText(text: string, prompt: string, questionPrompts: readonly string[], pickedPrompt?: string): string {
  const append = () => (text.trim() ? `${text.replace(/\s+$/, "")}\n${prompt}` : prompt);
  if (pickedPrompt === undefined) return append();
  const lines = text.split("\n");
  const index = lines.findIndex((line) => sameLine(line, pickedPrompt));
  if (index === -1 || !questionPrompts.some((choice) => sameLine(lines[index], choice))) return append();
  if (sameLine(prompt, pickedPrompt)) {
    lines.splice(index, 1);
    return lines.join("\n").replace(/\n+$/, "");
  }
  lines[index] = prompt;
  return lines.join("\n");
}

/**
 * Every choice's state, per question in page order. A choice is picked while its prompt is a whole
 * line of the message box; when the same prompt is offered more than once, the newest offer owns
 * the line. A question with a pick shows its other choices as passed over. Once any user message
 * follows the reply, the question is settled: the choice that message carried (as a whole line) is
 * accepted, the rest are stale.
 */
export function deriveStates(questions: readonly Question[], boxText: string): ChoiceState[][] {
  const states = questions.map((question) => question.prompts.map((): ChoiceState => "open"));
  const owned = new Set<string>();
  const picked = new Map<number, number>();
  for (let q = questions.length - 1; q >= 0; q -= 1) {
    const prompts = questions[q].prompts;
    for (let c = prompts.length - 1; c >= 0; c -= 1) {
      const prompt = prompts[c].trim();
      if (owned.has(prompt) || !hasWholeLine(boxText, prompt)) continue;
      owned.add(prompt);
      picked.set(q, c);
      states[q][c] = "picked";
      break;
    }
  }
  questions.forEach((question, q) => {
    const pick = picked.get(q);
    const settled = question.laterMessages.length > 0;
    const accepted = settled
      ? question.prompts.findIndex((prompt) => question.laterMessages.some((message) => hasWholeLine(message, prompt)))
      : -1;
    question.prompts.forEach((_, c) => {
      if (c === pick) return;
      if (c === accepted) states[q][c] = "accepted";
      else if (pick !== undefined) states[q][c] = "passed-over";
      else if (settled) states[q][c] = "stale";
    });
  });
  return states;
}

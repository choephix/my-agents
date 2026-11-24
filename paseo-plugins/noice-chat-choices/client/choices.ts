// Pure rules for choice links: what a link's prompt is, how a click toggles it in the message box,
// and which state each choice is in. No DOM here; web.ts reads the page and applies the result.

export type ChoiceState = "open" | "picked" | "accepted" | "stale";

/** One choice in a reply, with the user messages sent after it. */
export interface ChoiceOffer {
  readonly prompt: string;
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

export const hasWholeLine = (text: string, prompt: string) =>
  Boolean(prompt.trim()) && text.split(/\r?\n/).some((line) => sameLine(line, prompt));

/**
 * The message box after a click. If the prompt is not yet a whole line in the box, append it on
 * its own line at the end. If it is already there unedited, remove that line. Other text stays.
 */
export function toggleChoiceText(text: string, prompt: string): string {
  if (!prompt.trim()) return text;
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => sameLine(line, prompt));
  if (index !== -1) {
    lines.splice(index, 1);
    return lines.join("\n").replace(/\n+$/, "");
  }
  return text.trim() ? `${text.replace(/\s+$/, "")}\n${prompt}` : prompt;
}

/**
 * Every choice's state in page order. A choice is picked while its prompt is a whole line of the
 * message box; when the same prompt is offered more than once, the newest offer owns the line.
 * Once any user message follows the choice, it is settled: accepted if a later message carried its
 * prompt as a whole line, stale otherwise.
 */
export function deriveStates(offers: readonly ChoiceOffer[], boxText: string): ChoiceState[] {
  const states: ChoiceState[] = offers.map(() => "open");
  const owned = new Set<string>();
  for (let i = offers.length - 1; i >= 0; i -= 1) {
    const prompt = offers[i].prompt.trim();
    if (!prompt || owned.has(prompt) || !hasWholeLine(boxText, prompt)) continue;
    owned.add(prompt);
    states[i] = "picked";
  }
  offers.forEach((offer, i) => {
    if (states[i] === "picked" || offer.laterMessages.length === 0) return;
    const accepted = offer.laterMessages.some((message) => hasWholeLine(message, offer.prompt));
    states[i] = accepted ? "accepted" : "stale";
  });
  return states;
}

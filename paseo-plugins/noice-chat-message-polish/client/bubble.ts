// Paseo 0.14 components/message.tsx: user-message > column > bubble > MessagePreview's two Views >
// text. The column also holds the "Sent by" button and the time/rewind/copy row, so the bubble is
// the column's child that holds the text, not the text's parent.
export const BUBBLE = '[data-testid="user-message"] > * > *';

export const bubbleOf = (text: HTMLElement) => text.closest<HTMLElement>(BUBBLE);

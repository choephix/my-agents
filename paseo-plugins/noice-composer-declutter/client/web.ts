import { Platform } from "react-native";
import type { Preferences } from "../shared/preferences";

// Sanctioned web-only globals: no DOM library in the rest of the plugin.
interface StyleElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
declare const document: {
  head: { appendChild(element: StyleElement): void };
  createElement(tag: "style"): StyleElement;
};
declare const window: {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
};

const ROOT = '[data-testid="message-input-root"]';

// The idle dictation and Voice mode buttons have no test IDs, only Paseo's translated
// accessibility labels (i18n keys composer.voice.startDictation / enableVoiceMode), so
// list every shipped locale. Busy states (stop, cancel, mute...) use other labels and are
// never matched.
const START_DICTATION = [
  "Start dictation", "Iniciar dictado", "Démarrer la dictée", "Iniciar ditado",
  "Начать диктовку", "音声入力を開始", "받아쓰기 시작", "开始听写", "بدء الإملاء",
];
const ENABLE_VOICE = [
  "Enable Voice mode", "Habilitar el modo de voz", "Activer le mode vocal", "Ativar modo de voz",
  "Включить голосовой режим", "音声モードを有効にする", "음성 모드 켜기", "启用语音模式", "تمكين الوضع الصوتي",
];
const labelled = (labels: readonly string[]) =>
  `:is(${labels.map((label) => `[aria-label="${label}"]`).join(", ")})`;

const RULES: Record<keyof Preferences, string> = {
  // 0.12 compact layouts fold the thinking readout into the model button's second text node.
  hideThinking: ':is([data-testid="agent-thinking-selector"], [data-testid="combined-model-selector"] > div > div:nth-child(2) > [dir="auto"]:nth-child(2))',
  hideMode: '[data-testid="mode-control"]',
  hideFastMode: '[data-testid="agent-feature-fast_mode"]',
  hideOtherFeatures: '[data-testid^="agent-feature-"]:not([data-testid="agent-feature-fast_mode"])',
  hideDictation: labelled(START_DICTATION),
  // The Voice button sits alone in a wrapper; hiding the wrapper also drops its flex gap,
  // so the remaining right-hand controls keep their usual right edge.
  hideVoice: `div:has(> ${labelled(ENABLE_VOICE)})`,
};

/** One rule per control, so a selector a browser rejects cannot void the others. */
function stylesheet(values: Preferences): string {
  return (Object.keys(RULES) as (keyof Preferences)[])
    .filter((key) => values[key])
    .map((key) => `${ROOT} ${RULES[key]} { display: none !important; }`)
    .join("\n");
}

/**
 * Keeps one removable stylesheet in sync with the host settings. `load` is re-run whenever
 * the window regains focus, so changes saved in another window arrive without a refresh.
 * Fails open: until settings load, every control stays visible.
 */
export function startDecluttering(load: () => Promise<Preferences | undefined>) {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return { apply(_values: Preferences) {}, dispose() {} };
  }
  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-composer-declutter");
  document.head.appendChild(style);
  let edits = 0;
  let disposed = false;
  const render = (values: Preferences) => { style.textContent = stylesheet(values); };
  const refresh = () => {
    const editsAtStart = edits;
    load().then((values) => {
      // A save made while this read was in flight is newer than what the read returned.
      if (values && !disposed && edits === editsAtStart) render(values);
    }, () => {});
  };
  refresh();
  window.addEventListener("focus", refresh);
  return {
    apply(values: Preferences) {
      edits += 1;
      if (!disposed) render(values);
    },
    dispose() {
      disposed = true;
      window.removeEventListener("focus", refresh);
      style.remove();
    },
  };
}

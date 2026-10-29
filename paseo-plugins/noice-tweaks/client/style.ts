// Paseo's plugin types need not include the DOM library.
interface StyleElement {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}
declare const document: {
  createElement(tag: "style"): StyleElement;
  head: { appendChild(element: StyleElement): void };
};

/** Adds `<style data-plugin="noice-tweaks-<name>">` to the page; the returned function removes it. */
export function injectStyle(name: string, css: string): () => void {
  const style = document.createElement("style");
  style.setAttribute("data-plugin", `noice-tweaks-${name}`);
  style.textContent = css;
  document.head.appendChild(style);
  return () => style.remove();
}

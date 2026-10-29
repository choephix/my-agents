import { Platform } from "react-native";
import type { Preferences } from "../shared/preferences";
import { MAX_IMAGE_BYTES, resolveMapping, validateImage } from "../shared/images";
import { hostFromPath, hostFromScopes, ownerFromTestId, providerFromScopes, type Directory, type IconScope } from "../shared/identity";

// Web-only DOM interop, deliberately outside the shared/native modules.
declare const location: { pathname: string };
interface WebNode {
  style: { display: string; setProperty(name: string, value: string): void; removeProperty(name: string): void };
  textContent: string | null;
  type: string;
  accept: string;
  files?: ArrayLike<{ size: number; name: string }>;
  oncancel: (() => void) | null;
  onchange: (() => void) | null;
  appendChild(node: WebNode): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  closest(selector: string): WebNode | null;
  remove(): void;
  click(): void;
}
interface Fiber { memoizedProps: IconScope | null; type: unknown; return: Fiber | null }
declare const document: {
  head: WebNode; body: WebNode; visibilityState: string;
  createElement(tag: string): WebNode;
  querySelectorAll(selector: string): Iterable<WebNode>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
declare const window: {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
declare const FileReader: new () => {
  result: unknown;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  readAsDataURL(file: { size: number; name: string }): void;
};
declare const Image: new () => {
  naturalWidth: number; naturalHeight: number; src: string;
  onerror: (() => void) | null; onload: (() => void) | null;
};
declare const MutationObserver: new (callback: () => void) => {
  observe(node: WebNode, options: { subtree: boolean; childList: boolean; attributes: boolean; attributeFilter: string[] }): void;
  disconnect(): void;
};
declare const requestAnimationFrame: (callback: () => void) => number;
declare const cancelAnimationFrame: (id: number) => void;

const isWeb = Platform.OS === "web" && typeof document !== "undefined";

export async function pickImage(): Promise<{ image: string; name: string } | null> {
  if (!isWeb) throw new Error("Choose images from the web or desktop app.");
  const { promise, resolve, reject } = Promise.withResolvers<{ image: string; name: string } | null>();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".svg,.png,.webp,.jpg,.jpeg,image/svg+xml,image/png,image/webp,image/jpeg";
  input.setAttribute("aria-label", "Choose provider icon image");
  input.style.display = "none";
  document.body.appendChild(input);
  input.oncancel = () => { input.remove(); resolve(null); };
  input.onchange = () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) { resolve(null); return; }
    if (file.size > MAX_IMAGE_BYTES) { reject(new Error(`${file.name} is larger than 128 KiB.`)); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const image = String(reader.result);
      const error = validateImage(image);
      if (error) { reject(new Error(error)); return; }
      const preview = new Image();
      preview.onerror = () => reject(new Error(`The browser could not decode ${file.name}.`));
      preview.onload = () => {
        if (!preview.naturalWidth || !preview.naturalHeight || preview.naturalWidth > 4096 || preview.naturalHeight > 4096) {
          reject(new Error("Use an image no larger than 4096 × 4096 pixels."));
        } else resolve({ image, name: file.name });
      };
      preview.src = image;
    };
    reader.readAsDataURL(file);
  };
  input.click();
  return promise;
}

/** Runs `callback` whenever this window regains focus (fallback for missed settings announcements). */
export function onWindowFocus(callback: () => void): () => void {
  if (!isWeb) return () => {};
  const visible = () => { if (document.visibilityState === "visible") callback(); };
  window.addEventListener("focus", callback);
  document.addEventListener("visibilitychange", visible);
  return () => {
    window.removeEventListener("focus", callback);
    document.removeEventListener("visibilitychange", visible);
  };
}

const MARK = "data-provider-icons";
const MARK_HOST = "data-provider-icons-host";
const TINT = "--provider-icons-tint";

export function startIcons(missing?: (agentId: string) => void) {
  const agents = new Map<string, string>();
  const providers = new Set<string>();
  const labels = new Map<string, string>();
  const directory: Directory = { agents, providers, labels, missing };
  let values: Preferences = { mappings: [] };
  let hostId: string | undefined;
  let css = "";
  let frame = 0;
  let disposed = false;
  if (!isWeb) {
    return { update(_values: Preferences, _host?: string) {}, agent(_id: string, _provider: string) {}, provider(_id: string, _label: string) {}, dispose() {} };
  }
  const style = document.createElement("style");
  style.setAttribute("data-plugin", "noice-provider-icons");
  document.head.appendChild(style);

  /** Provider glyphs: Paseo's own provider marks (no Lucide class) and its Bot/PackagePlus fallbacks. */
  function isGlyph(svg: WebNode) {
    const cssClass = svg.getAttribute("class") ?? "";
    const width = Number(svg.getAttribute("width"));
    return width > 0 && width <= 64 && width === Number(svg.getAttribute("height")) &&
      (!/\blucide\b/.test(cssClass) || /\blucide-(?:bot|package-plus)\b/.test(cssClass));
  }

  function ownerOf(svg: WebNode): { provider?: string; host?: string } {
    const tagged = svg.closest("[data-testid]");
    const tier1 = tagged ? ownerFromTestId(tagged.getAttribute("data-testid") ?? "", directory, tagged.getAttribute("aria-label")) : undefined;
    if (tier1?.host) return tier1;
    // A test id that names an unmapped provider decides the result; skip the fiber walk.
    if (tier1?.provider && !resolveMapping(values.mappings, tier1.provider)) return tier1;
    // React keeps each host node's owner chain under `__reactFiber$<random>`; read it, never write it.
    const key = Object.keys(svg).find((name) => name.startsWith("__reactFiber$"));
    let fiber: Fiber | null | undefined = key ? (svg as unknown as Record<string, Fiber | undefined>)[key] : undefined;
    const scopes: IconScope[] = [];
    for (let depth = 0; fiber && depth < 70; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (!props || typeof fiber.type === "string") continue;
      scopes.push(props);
      if (props.serverId || props.agent?.serverId) break;
    }
    return {
      provider: tier1?.provider ?? providerFromScopes(scopes, directory),
      host: hostFromScopes(scopes) ?? hostFromPath(location.pathname),
    };
  }

  function scan() {
    frame = 0;
    if (disposed) return;
    const ownHost = encodeURIComponent(hostId ?? "");
    for (const svg of document.querySelectorAll("svg")) {
      let mapping;
      if (values.mappings.length && hostId && isGlyph(svg)) {
        const owner = ownerOf(svg);
        if (owner.host === hostId && owner.provider) mapping = resolveMapping(values.mappings, owner.provider);
      }
      if (mapping) {
        const token = encodeURIComponent(mapping.provider);
        if (svg.getAttribute(MARK) !== token) svg.setAttribute(MARK, token);
        if (svg.getAttribute(MARK_HOST) !== ownHost) svg.setAttribute(MARK_HOST, ownHost);
        // Lucide strokes and Paseo's marks fill with the theme color Paseo chose for this spot.
        const ink = [svg.getAttribute("stroke"), svg.getAttribute("fill")].find((color) => color && color !== "none");
        if (mapping.style === "monochrome" && ink) svg.style.setProperty(TINT, ink);
      } else if (svg.getAttribute(MARK_HOST) === ownHost) clear(svg);
    }
  }

  function clear(svg: WebNode) {
    svg.removeAttribute(MARK);
    svg.removeAttribute(MARK_HOST);
    svg.style.removeProperty(TINT);
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(scan);
  }
  // Streaming chat adds nodes constantly; a scan is one querySelectorAll plus owner lookups for the
  // handful of glyph-shaped SVGs, coalesced to at most one per animation frame.
  const observer = new MutationObserver(() => { if (values.mappings.length) schedule(); });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label", "data-testid", "width", "height", "class", "stroke", "fill"] });

  return {
    update(next: Preferences, host?: string) {
      values = next;
      const nextHost = host ?? next.hostId ?? hostId;
      const ownHost = encodeURIComponent(nextHost ?? "");
      const nextCss = next.mappings.map((mapping) => {
        const selector = `svg[${MARK_HOST}="${ownHost}"][${MARK}="${encodeURIComponent(mapping.provider)}"]`;
        const image = `url("${mapping.image}") center / contain no-repeat`;
        const paint = mapping.style === "monochrome"
          ? `background:var(${TINT}, currentColor) !important; -webkit-mask:${image}; mask:${image};`
          : `background:${image} !important;`;
        return `${selector} { ${paint} }\n${selector} > * { visibility:hidden !important; }`;
      }).join("\n");
      // The same document arrives on every focus and settings-screen mount; rewriting identical CSS
      // restyles the whole page for nothing.
      if (nextCss === css && nextHost === hostId) return;
      hostId = nextHost;
      css = nextCss;
      style.textContent = css;
      // Restyled mappings need their tint recomputed; a full pass also drops removed mappings.
      for (const svg of document.querySelectorAll(`svg[${MARK_HOST}="${ownHost}"]`)) svg.style.removeProperty(TINT);
      schedule();
    },
    agent(id: string, provider: string) {
      if (agents.get(id) === provider) return;
      agents.set(id, provider);
      schedule();
    },
    provider(id: string, label: string) {
      if (providers.has(id) && labels.get(label) === id) return;
      providers.add(id);
      labels.set(label, labels.has(label) && labels.get(label) !== id ? "" : id);
      schedule();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      style.remove();
      for (const svg of document.querySelectorAll(`svg[${MARK_HOST}="${encodeURIComponent(hostId ?? "")}"]`)) clear(svg);
    },
  };
}

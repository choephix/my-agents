import { expect, test } from "vitest";
import { providerRows } from "../shared/rows";

const nilo = { provider: "omp-nilo", image: "data:image/svg+xml;base64,PHN2Zy8+", name: "favicon.svg", style: "original" as const };
const gone = { provider: "old-provider", image: "data:image/svg+xml;base64,PHN2Zy8+", name: "old.svg", style: "monochrome" as const };
const providers = [{ id: "claude", label: "Claude" }, { id: "codex", label: "Codex" }, { id: "omp-nilo", label: "Oh My Pi (nilo)" }];

test("customized providers come first; the rest keep daemon order", () => {
  const rows = providerRows(providers, [nilo]);
  expect(rows.map((row) => [row.id, row.mapping?.name ?? null])).toEqual([["omp-nilo", "favicon.svg"], ["claude", null], ["codex", null]]);
});

test("keeps icons for providers the daemon no longer has, so they can be removed", () => {
  const rows = providerRows(providers.slice(0, 1), [gone, nilo]);
  expect(rows.map((row) => [row.id, row.configured])).toEqual([["old-provider", false], ["omp-nilo", false], ["claude", true]]);
});

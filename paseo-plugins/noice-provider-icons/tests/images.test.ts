import { describe, expect, test } from "vitest";
import { MAX_IMAGE_BYTES, putMapping, resolveMapping, validateImage } from "../shared/images";

const svg = (text: string) => `data:image/svg+xml;base64,${btoa(text)}`;
const icon = svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path fill="#58f287" d="M0 0h8v8H0z"/></svg>');
// Actual 1×1 canvas exports from Chromium, not fabricated signature-only buffers.
const rasters = [
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGBgAAAAAP//XRcpzQAAAAZJREFUAwAADwADJDd96QAAAABJRU5ErkJggg==",
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJVAA//Z",
  "data:image/webp;base64,UklGRkAAAABXRUJQVlA4WAoAAAAQAAAAAAAAAAAAQUxQSAIAAAAAAFZQOCAYAAAAMAEAnQEqAQABAAFAJiWkAANwAP79NmgA",
];

describe("image input", () => {
  test("accepts standalone SVG and actual PNG, JPEG and WebP exports", () => {
    for (const image of [icon, ...rasters]) expect(validateImage(image)).toBeNull();
  });
  test("rejects MIME spoofing, truncated rasters, unsupported and non-upload input", () => {
    for (const image of [rasters[0].replace("image/png", "image/jpeg"), "data:image/png;base64,aGVsbG8=", "data:image/gif;base64,R0lGODlh", "https://example.com/icon.svg", "<svg/>", "data:image/png;base64,!!!!"]) expect(validateImage(image)).not.toBeNull();
  });
  test("enforces the decoded byte limit", () => {
    expect(validateImage(svg(`<svg>${" ".repeat(MAX_IMAGE_BYTES)}</svg>`))).toContain("128 KiB");
    expect(validateImage(svg(`<svg>${" ".repeat(MAX_IMAGE_BYTES - 11)}</svg>`))).toBeNull();
  });
  test("rejects executable or externally dependent SVG", () => {
    for (const content of ['<script>alert(1)</script>', '<path onload="alert(1)"/>', '<foreignObject/>', '<image href="https://example.com/a.png"/>', '<use href="#x"/>', '<style>path{fill:url(https://example.com/x)}</style>', '<!DOCTYPE svg>', '<animate attributeName="href"/>']) expect(validateImage(svg(`<svg>${content}</svg>`))).not.toBeNull();
    expect(validateImage(svg("not svg"))).toContain("Invalid SVG");
  });
  test("accepts real editor exports: internal url(#id)/href=\"#id\" references and comments", () => {
    const figma = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><g clip-path="url(#a)"><path fill="url( \'#g\' )" d="M0 0h8v8H0z"/></g><defs><clipPath id="a"><path d="M0 0h8v8H0z"/></clipPath><linearGradient id="g" href="#h"/></defs></svg>';
    const illustrator = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Adobe Illustrator 28.0 -->\n<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>\n<!-- trailing -->';
    for (const text of [figma, illustrator]) expect(validateImage(svg(text))).toBeNull();
  });
  test("external references stay rejected, including a stylesheet processing instruction and unclosed comments", () => {
    for (const text of ['<?xml-stylesheet href="https://example.com/x.css"?><svg/>', '<svg><path fill="url(https://example.com/x#a)"/></svg>', '<svg><linearGradient href="https://example.com/g.svg#g"/></svg>', '<svg><!-- unclosed </svg>', '<svg><!-- a --><!DOCTYPE x></svg>']) {
      expect(validateImage(svg(text))).not.toBeNull();
    }
  });
  test("a large malformed SVG is rejected in linear time", () => {
    // The old `<svg\b[^>]*[\s\S]*` pattern backtracked quadratically: 1.5 s for this input.
    const started = performance.now();
    expect(validateImage(svg(`<svg ${"a".repeat(64 * 1024)}`))).toContain("Invalid SVG");
    expect(validateImage(svg(`<svg>${"<!---->".repeat(16 * 1024)}</svg>`))).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("mapping resolution", () => {
  test("uses exact ids, not inherited ids, labels, or prefix matching", () => {
    const entries = [{ provider: "omp-nilo", image: icon, name: "nilo.svg", style: "original" as const }];
    expect(resolveMapping(entries, "omp-nilo")?.image).toBe(icon);
    for (const id of ["omp", "omp-nilo-other", "Oh My Pi (nilo)"]) expect(resolveMapping(entries, id)).toBeUndefined();
  });
  test("upserts a built-in provider without duplicates or mutating the previous document", () => {
    const before = [{ provider: "omp-nilo", image: icon, name: "nilo.svg", style: "original" as const }, { provider: "claude", image: rasters[0], name: "old.png", style: "original" as const }];
    const after = putMapping(before, { provider: "claude", image: rasters[2], name: "new.webp", style: "monochrome" });
    expect(after).toHaveLength(2);
    expect(resolveMapping(after, "claude")?.name).toBe("new.webp");
    expect(resolveMapping(before, "claude")?.name).toBe("old.png");
    expect(resolveMapping(after.filter((entry) => entry.provider !== "omp-nilo"), "omp-nilo")).toBeUndefined();
  });
});

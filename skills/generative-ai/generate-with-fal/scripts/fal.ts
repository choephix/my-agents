#!/usr/bin/env bun

import { appendFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const REGISTRY_URL = new URL("../assets/endpoints.yaml", import.meta.url);
const EPOCH_OFFSET = new Date("2025-01-01T00:00:00Z").getTime();
const FOUR_MIB = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_POLL_SECONDS = 1;
const MAX_COUNT = 20;
const reservedOutputPaths = new Set<string>();

const USAGE = "Usage: fal.ts <list|describe|run|upload> ...";
const USAGES = {
  list: "Usage: fal.ts list [category] [--json]",
  describe: "Usage: fal.ts describe <ref> [--schema] [--json]",
  run: "Usage: fal.ts run <ref> --json <object|@file|@-> [--count N] [--dry-run] [--timeout SECS] [--poll SECS]",
  upload: "Usage: fal.ts upload <path>",
} as const;

type JsonObject = Record<string, unknown>;

interface EndpointInput {
  required: string[];
  batch: string | null;
  params: Record<string, string>;
}

interface Endpoint {
  id: string;
  aliases: string[];
  category: string;
  description: string;
  notes?: string;
  input: EndpointInput;
}

interface Registry {
  version: number;
  updated?: string;
  preferences?: string;
  endpoints: Endpoint[];
}

interface OutputCandidate {
  url: string;
  contentType?: string;
  width?: number;
  height?: number;
}

interface SavedOutput {
  url: string;
  localPath: string;
  contentType?: string;
}

interface RunResult {
  success: boolean;
  requestId?: string;
  seed?: number;
  durationMs: number;
  outputs: SavedOutput[];
  error?: string;
}

class CliError extends Error {}

class RequestError extends Error {
  response: unknown;

  constructor(message: string, response: unknown) {
    super(message);
    this.response = response;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failUsage(message: string, usage: string): never {
  throw new CliError(`${message}. ${usage}`);
}

function printError(error: unknown): void {
  console.error(JSON.stringify({ success: false, error: errorMessage(error) }));
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function outputBaseDir(): string {
  return resolve(expandHome(process.env.FAL_OUTPUT_DIR || join(homedir(), "Generations")));
}

function journalBaseDir(): string {
  const configured = process.env.FAL_JOURNAL_DIR;
  return resolve(expandHome(configured || join(outputBaseDir(), ".journal")));
}

function requireFalKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) throw new CliError("FAL_KEY not found in environment variables");
  return key;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadRegistry(): Promise<Registry> {
  let parsed: unknown;
  try {
    const text = await Bun.file(REGISTRY_URL).text();
    parsed = Bun.YAML.parse(text);
  } catch (error) {
    throw new CliError(`Unable to load endpoint registry: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed) || parsed.version !== 2 || !Array.isArray(parsed.endpoints)) {
    throw new CliError("Unable to load endpoint registry: expected registry version 2 with an endpoints array");
  }

  const endpoints: Endpoint[] = [];
  const ids = new Set<string>();
  const normalizedAliases = new Map<string, string>();

  for (const raw of parsed.endpoints) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !Array.isArray(raw.aliases) ||
        !raw.aliases.every((alias) => typeof alias === "string") || typeof raw.category !== "string" ||
        typeof raw.description !== "string" || !isRecord(raw.input) ||
        !Array.isArray(raw.input.required) || !raw.input.required.every((field) => typeof field === "string") ||
        !(raw.input.batch === null || typeof raw.input.batch === "string") || !isRecord(raw.input.params) ||
        !Object.values(raw.input.params).every((value) => typeof value === "string")) {
      throw new CliError("Unable to load endpoint registry: invalid endpoint entry");
    }

    const idKey = raw.id.toLowerCase();
    if (ids.has(idKey)) throw new CliError(`Unable to load endpoint registry: duplicate endpoint id "${raw.id}"`);
    ids.add(idKey);

    const aliases = raw.aliases as string[];
    for (const alias of aliases) {
      const key = normalizeRef(alias);
      const previous = normalizedAliases.get(key);
      if (previous !== undefined) {
        throw new CliError(`Unable to load endpoint registry: aliases "${previous}" and "${alias}" are not globally unique after normalization`);
      }
      normalizedAliases.set(key, alias);
    }

    endpoints.push({
      id: raw.id,
      aliases,
      category: raw.category,
      description: raw.description,
      ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
      input: {
        required: raw.input.required as string[],
        batch: raw.input.batch as string | null,
        params: raw.input.params as Record<string, string>,
      },
    });
  }

  return {
    version: 2,
    ...(typeof parsed.updated === "string" ? { updated: parsed.updated } : {}),
    ...(typeof parsed.preferences === "string" ? { preferences: parsed.preferences } : {}),
    endpoints,
  };
}

function normalizeRef(value: string): string {
  return value.toLowerCase().replace(/[\s-]/g, "");
}

function resolveEndpoint(registry: Registry, reference: string): Endpoint {
  const lower = reference.toLowerCase();
  const exactId = registry.endpoints.find((entry) => entry.id.toLowerCase() === lower);
  if (exactId) return exactId;

  const exactAliases = registry.endpoints.filter((entry) => entry.aliases.some((alias) => alias.toLowerCase() === lower));
  if (exactAliases.length === 1) return exactAliases[0];
  if (exactAliases.length > 1) throw ambiguousReference(reference, exactAliases);

  const normalized = normalizeRef(reference);
  const matches = registry.endpoints.filter((entry) =>
    normalizeRef(entry.id) === normalized || entry.aliases.some((alias) => normalizeRef(alias) === normalized),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw ambiguousReference(reference, matches);

  const suggestions = registry.endpoints
    .filter((entry) => {
      const values = [entry.id, ...entry.aliases].map(normalizeRef);
      return values.some((value) => value.includes(normalized) || normalized.includes(value));
    })
    .sort((a, b) => suggestionDistance(a, normalized) - suggestionDistance(b, normalized) || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((entry) => entry.id);
  const suffix = suggestions.length ? ` Suggestions: ${suggestions.join(", ")}` : "";
  throw new CliError(`Unknown endpoint or alias "${reference}".${suffix}`);
}

function suggestionDistance(entry: Endpoint, normalized: string): number {
  return Math.min(...[entry.id, ...entry.aliases].map((value) => Math.abs(normalizeRef(value).length - normalized.length)));
}

function ambiguousReference(reference: string, entries: Endpoint[]): CliError {
  const candidates = [...new Set(entries.map((entry) => entry.id))].sort();
  return new CliError(`Ambiguous endpoint reference "${reference}". Candidates: ${candidates.join(", ")}`);
}

function generateUID(): string {
  return toBase26(Date.now() - EPOCH_OFFSET);
}

function toBase26(num: number): string {
  if (num === 0) return "a";
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  while (num > 0) {
    result = chars[num % 26] + result;
    num = Math.floor(num / 26);
  }
  return result;
}

function slugifyEndpoint(endpointId: string): string {
  const parts = endpointId.split("/");
  return parts.slice(-3).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function extractPromptWords(prompt: string, maxWords = 5): string {
  if (!prompt) return "";
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, maxWords)
    .join("-");
}

function getDateFolder(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/tiff": "tiff",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "model/gltf-binary": "glb",
  "model/gltf+json": "gltf",
  "model/obj": "obj",
  "application/pdf": "pdf",
  "application/zip": "zip",
};

function getExtension(url: string, contentType?: string): string {
  if (contentType) {
    const normalized = contentType.toLowerCase().split(";", 1)[0].trim();
    const mapped = CONTENT_TYPE_EXTENSIONS[normalized];
    if (mapped) return mapped;
  }

  try {
    const extension = extname(new URL(url).pathname).slice(1).toLowerCase();
    if (extension && extension.length <= 5 && /^[a-z0-9]+$/.test(extension)) return extension;
  } catch {
    // The URL was already validated by output harvesting; fall through defensively.
  }
  return "bin";
}

const EXTENSION_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  obj: "model/obj",
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
};

function mimeTypeForPath(path: string): string {
  return EXTENSION_MIME_TYPES[extname(path).slice(1).toLowerCase()] || "application/octet-stream";
}

async function imageToDataUrl(path: string): Promise<string> {
  const file = Bun.file(path);
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  return `data:${mimeTypeForPath(path)};base64,${base64}`;
}

async function uploadFile(localPath: string, falKey: string): Promise<string> {
  const filename = basename(localPath) || "file";
  const target = `${generateUID()}-${filename}`;
  const formData = new FormData();
  formData.append("file_upload", Bun.file(localPath));

  const response = await fetch(`https://api.fal.ai/v1/serverless/files/file/local/uploads/${encodeURIComponent(target)}`, {
    method: "POST",
    headers: { Authorization: `Key ${falKey}` },
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new RequestError(`Upload failed (${response.status}): ${text}`, text);
  }
  return `https://fal.media/files/uploads/${encodeURIComponent(target)}`;
}

function looksLikeLocalPath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("~/");
}

async function existingLocalFile(value: string): Promise<string | null> {
  if (!looksLikeLocalPath(value)) return null;
  const path = resolve(expandHome(value));
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function inspectLocalFiles(value: unknown, paths: string[]): Promise<void> {
  if (typeof value === "string") {
    if (await existingLocalFile(value)) paths.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) await inspectLocalFiles(item, paths);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) await inspectLocalFiles(item, paths);
  }
}

async function substituteLocalFiles(value: unknown, falKey: string): Promise<unknown> {
  if (typeof value === "string") {
    const localPath = await existingLocalFile(value);
    if (!localPath) return value;
    const info = await stat(localPath);
    return info.size <= FOUR_MIB ? await imageToDataUrl(localPath) : await uploadFile(localPath, falKey);
  }
  if (Array.isArray(value)) return await Promise.all(value.map((item) => substituteLocalFiles(item, falKey)));
  if (isRecord(value)) {
    const output: JsonObject = Object.create(null);
    await Promise.all(Object.entries(value).map(async ([key, item]) => {
      output[key] = await substituteLocalFiles(item, falKey);
    }));
    return output;
  }
  return value;
}

function sanitizeForJournal(value: unknown): unknown {
  if (typeof value === "string" && value.length > 2048 && value.startsWith("data:")) {
    const mimeEnd = value.search(/[;,]/);
    const mime = mimeEnd > 5 ? value.slice(5, mimeEnd) : "application/octet-stream";
    const comma = value.indexOf(",");
    const omitted = comma >= 0 ? value.length - comma - 1 : value.length;
    return `data:${mime};base64,<omitted ${omitted} chars>`;
  }
  if (Array.isArray(value)) return value.map(sanitizeForJournal);
  if (isRecord(value)) {
    const output: JsonObject = Object.create(null);
    for (const [key, item] of Object.entries(value)) output[key] = sanitizeForJournal(item);
    return output;
  }
  return value;
}

function journalPathForToday(): string {
  return join(journalBaseDir(), `${getDateFolder()}.jsonl`);
}

async function appendJournal(
  journalPath: string,
  endpoint: string,
  requestId: string | undefined,
  input: JsonObject,
  response: unknown,
  outputs: SavedOutput[],
  durationMs: number,
  success: boolean,
  error?: string,
): Promise<void> {
  await mkdir(journalBaseDir(), { recursive: true });
  const errorSuffix = error && error.length > 2048 ? ` <truncated, ${error.length} chars total>` : "";
  const entry = {
    ts: new Date().toISOString(),
    endpoint,
    ...(requestId ? { requestId } : {}),
    input: sanitizeForJournal(input),
    response: sanitizeForJournal(response),
    outputs: outputs.map(({ url, localPath }) => ({ url, localPath })),
    durationMs,
    success,
    ...(error ? { error: errorSuffix ? `${error.slice(0, 2048 - errorSuffix.length)}${errorSuffix}` : error } : {}),
  };
  await appendFile(journalPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function parsePositiveNumber(value: string, flag: string, usage: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) failUsage(`${flag} must be a positive number`, usage);
  return parsed;
}

function parseCount(value: string, usage: string): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    failUsage(`--count must be an integer from 1 to ${MAX_COUNT}`, usage);
  }
  return count;
}

function requireOptionValue(args: string[], index: number, flag: string, usage: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) failUsage(`${flag} requires a value`, usage);
  return value;
}

async function readJsonInput(source: string): Promise<JsonObject> {
  let text: string;
  try {
    if (source === "@-") text = await Bun.stdin.text();
    else if (source.startsWith("@")) text = await Bun.file(resolve(expandHome(source.slice(1)))).text();
    else text = source;
  } catch (error) {
    throw new CliError(`Unable to read JSON input: ${errorMessage(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError(`Invalid JSON input: ${errorMessage(error)}`);
  }
  if (!isRecord(parsed)) throw new CliError("JSON input must be an object");
  return parsed;
}

function validateAndPinInput(entry: Endpoint, input: JsonObject): JsonObject {
  const missing = entry.input.required.filter((field) => !Object.prototype.hasOwnProperty.call(input, field));
  if (missing.length) throw new CliError(`Missing required fields: ${missing.join(", ")}`);

  const batch = entry.input.batch;
  if (batch) {
    if (Object.prototype.hasOwnProperty.call(input, batch) && input[batch] !== 1) {
      throw new CliError(`${batch}: use --count N; batch fields are pinned to 1`);
    }
    return { ...input, [batch]: 1 };
  }
  return input;
}

async function commandList(args: string[]): Promise<void> {
  let category: string | undefined;
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      if (json) failUsage("--json may only be specified once", USAGES.list);
      json = true;
    } else if (arg.startsWith("--")) {
      failUsage(`Unknown option ${arg}`, USAGES.list);
    } else if (category === undefined) {
      category = arg;
    } else {
      failUsage("Too many positional arguments", USAGES.list);
    }
  }

  const registry = await loadRegistry();
  const entries = category
    ? registry.endpoints.filter((entry) => entry.category.toLowerCase() === category.toLowerCase())
    : registry.endpoints;
  if (json) {
    console.log(JSON.stringify(entries));
    return;
  }
  for (const entry of entries) {
    console.log(`${entry.id}  [${entry.category}]  aliases: ${entry.aliases.join(", ")} — ${entry.description}`);
  }
}

function printEndpoint(entry: Endpoint): void {
  console.log(`id: ${entry.id}`);
  console.log(`aliases: ${entry.aliases.join(", ")}`);
  console.log(`category: ${entry.category}`);
  console.log(`description: ${entry.description}`);
  console.log(`notes: ${entry.notes || ""}`);
  console.log(`required: ${entry.input.required.join(", ")}`);
  console.log(`batch: ${entry.input.batch ?? "null"}`);
  console.log("params:");
  for (const [name, description] of Object.entries(entry.input.params)) {
    console.log(`  ${name}: ${description}`);
  }
}

async function commandDescribe(args: string[]): Promise<void> {
  let reference: string | undefined;
  let includeSchema = false;
  let json = false;
  for (const arg of args) {
    if (arg === "--schema") {
      if (includeSchema) failUsage("--schema may only be specified once", USAGES.describe);
      includeSchema = true;
    } else if (arg === "--json") {
      if (json) failUsage("--json may only be specified once", USAGES.describe);
      json = true;
    } else if (arg.startsWith("--")) {
      failUsage(`Unknown option ${arg}`, USAGES.describe);
    } else if (reference === undefined) {
      reference = arg;
    } else {
      failUsage("Too many positional arguments", USAGES.describe);
    }
  }
  if (!reference) failUsage("describe requires an endpoint id or alias", USAGES.describe);

  const registry = await loadRegistry();
  const entry = resolveEndpoint(registry, reference);
  const schema = includeSchema ? await fetchCondensedSchema(entry.id) : undefined;
  if (json) {
    console.log(JSON.stringify(includeSchema ? { endpoint: entry, schema } : entry));
    return;
  }
  printEndpoint(entry);
  if (includeSchema) {
    console.log("schema:");
    console.log(JSON.stringify(schema, null, 2));
  }
}

async function fetchCondensedSchema(endpointId: string): Promise<unknown> {
  const cacheDir = join(homedir(), ".cache", "fal-skill", "schemas");
  const cachePath = join(cacheDir, `${slugifyEndpoint(endpointId)}.json`);
  let document: unknown;
  const cache = Bun.file(cachePath);
  if (await cache.exists()) {
    try {
      document = JSON.parse(await cache.text());
    } catch (error) {
      throw new CliError(`Unable to read cached schema: ${errorMessage(error)}`);
    }
  } else {
    const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpointId)}`;
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      throw new CliError(`Unable to fetch schema: ${errorMessage(error)}`);
    }
    const text = await response.text();
    if (!response.ok) throw new CliError(`Unable to fetch schema (${response.status}): ${text}`);
    try {
      document = JSON.parse(text);
    } catch (error) {
      throw new CliError(`Unable to parse schema response: ${errorMessage(error)}`);
    }
    await mkdir(cacheDir, { recursive: true });
    await Bun.write(cachePath, text);
  }
  return condenseOpenApiSchema(document);
}

function resolveJsonPointer(document: unknown, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  let current: unknown = document;
  for (const rawPart of reference.slice(2).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveSchema(document: unknown, value: unknown, seen = new Set<string>()): unknown {
  if (!isRecord(value)) return value;
  if (typeof value.$ref === "string") {
    if (seen.has(value.$ref)) return value;
    const target = resolveJsonPointer(document, value.$ref);
    if (target === undefined) return value;
    const nextSeen = new Set(seen);
    nextSeen.add(value.$ref);
    const resolved = resolveSchema(document, target, nextSeen);
    return isRecord(resolved) ? { ...resolved, ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref")) } : resolved;
  }
  if (Array.isArray(value.allOf)) {
    const merged: JsonObject = {};
    const mergePart = (part: JsonObject): void => {
      for (const [key, item] of Object.entries(part)) {
        if (key === "properties" && isRecord(item)) {
          merged.properties = { ...(isRecord(merged.properties) ? merged.properties : {}), ...item };
        } else if (key === "required" && Array.isArray(item)) {
          merged.required = [...new Set([...(Array.isArray(merged.required) ? merged.required : []), ...item])];
        } else {
          merged[key] = item;
        }
      }
    };
    for (const part of value.allOf) {
      const resolved = resolveSchema(document, part, new Set(seen));
      if (isRecord(resolved)) mergePart(resolved);
    }
    mergePart(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "allOf")));
    return merged;
  }
  const resolvedUnions = Object.fromEntries(
    (["oneOf", "anyOf"] as const)
      .filter((key) => Array.isArray(value[key]))
      .map((key) => [key, (value[key] as unknown[]).map((variant) => resolveSchema(document, variant, new Set(seen)))]),
  );
  return { ...value, ...resolvedUnions };
}

function condenseOpenApiSchema(document: unknown): unknown {
  if (!isRecord(document)) return { componentSchemas: [] };
  const components = isRecord(document.components) && isRecord(document.components.schemas)
    ? document.components.schemas
    : {};
  const fallback = { componentSchemas: Object.keys(components).sort() };
  if (!isRecord(document.paths)) return fallback;

  const posts = Object.entries(document.paths)
    .map(([path, item]) => ({ path, post: isRecord(item) && isRecord(item.post) ? item.post : undefined }))
    .filter((item): item is { path: string; post: JsonObject } => item.post !== undefined)
    .sort((a, b) => Number(b.path.includes("fal-ai")) - Number(a.path.includes("fal-ai")));

  for (const { post } of posts) {
    const requestBody = resolveSchema(document, post.requestBody);
    if (!isRecord(requestBody) || !isRecord(requestBody.content)) continue;
    const media = requestBody.content["application/json"] || Object.entries(requestBody.content)
      .find(([type]) => type.includes("json"))?.[1];
    if (!isRecord(media)) continue;
    const schema = resolveSchema(document, media.schema);
    if (!isRecord(schema) || !isRecord(schema.properties)) continue;

    const properties: Record<string, JsonObject> = {};
    for (const [name, rawProperty] of Object.entries(schema.properties)) {
      const property = resolveSchema(document, rawProperty);
      if (!isRecord(property)) continue;
      const members = schemaSummaryMembers(property);
      const condensed: JsonObject = { type: schemaType(property) };
      const enumValues = members.flatMap((member) => Array.isArray(member.enum) ? member.enum : []);
      if (enumValues.length) condensed.enum = [...new Set(enumValues)];
      const defaultMember = members.find((member) => Object.prototype.hasOwnProperty.call(member, "default"));
      if (defaultMember) condensed.default = defaultMember.default;
      const descriptions = [...new Set(
        members.map((member) => member.description).filter((description): description is string => typeof description === "string"),
      )];
      if (descriptions.length) condensed.description = descriptions.join(" | ");
      properties[name] = condensed;
    }
    return {
      required: Array.isArray(schema.required) ? schema.required.filter((field) => typeof field === "string") : [],
      properties,
    };
  }
  return fallback;
}

function schemaSummaryMembers(schema: JsonObject): JsonObject[] {
  const members = [schema];
  for (const unionKey of ["oneOf", "anyOf"] as const) {
    const variants = schema[unionKey];
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        if (isRecord(variant)) members.push(...schemaSummaryMembers(variant));
      }
    }
  }
  return members;
}

function schemaType(schema: JsonObject): string {
  const types: string[] = [];
  if (Array.isArray(schema.type)) {
    types.push(...schema.type.map(String));
  } else if (schema.type !== undefined) {
    types.push(String(schema.type));
  } else if (isRecord(schema.properties)) {
    types.push("object");
  } else if (Array.isArray(schema.enum) && schema.enum.length) {
    types.push(typeof schema.enum[0]);
  }
  for (const unionKey of ["oneOf", "anyOf"] as const) {
    const variants = schema[unionKey];
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        if (isRecord(variant)) types.push(...schemaType(variant).split(" | "));
      }
    }
  }
  return [...new Set(types)].filter((type) => type !== "unknown").join(" | ") || "unknown";
}

async function commandRun(args: string[]): Promise<void> {
  let reference: string | undefined;
  let jsonSource: string | undefined;
  let count = 1;
  let dryRun = false;
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  let pollSeconds = DEFAULT_POLL_SECONDS;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--json", "--count", "--timeout", "--poll"].includes(arg)) {
      if (seen.has(arg)) failUsage(`${arg} may only be specified once`, USAGES.run);
      seen.add(arg);
      const value = requireOptionValue(args, index, arg, USAGES.run);
      index++;
      if (arg === "--json") jsonSource = value;
      else if (arg === "--count") count = parseCount(value, USAGES.run);
      else if (arg === "--timeout") timeoutSeconds = parsePositiveNumber(value, arg, USAGES.run);
      else pollSeconds = parsePositiveNumber(value, arg, USAGES.run);
    } else if (arg === "--dry-run") {
      if (dryRun) failUsage("--dry-run may only be specified once", USAGES.run);
      dryRun = true;
    } else if (arg.startsWith("--")) {
      failUsage(`Unknown option ${arg}`, USAGES.run);
    } else if (reference === undefined) {
      reference = arg;
    } else {
      failUsage("Too many positional arguments", USAGES.run);
    }
  }

  if (!reference) failUsage("run requires an endpoint id or alias", USAGES.run);
  if (jsonSource === undefined) failUsage("run requires --json", USAGES.run);

  const registry = await loadRegistry();
  const entry = resolveEndpoint(registry, reference);
  const input = validateAndPinInput(entry, await readJsonInput(jsonSource));

  if (dryRun) {
    const wouldEncode: string[] = [];
    await inspectLocalFiles(input, wouldEncode);
    console.log(JSON.stringify({ success: true, dryRun: true, endpoint: entry.id, input, wouldEncode }));
    return;
  }

  const falKey = requireFalKey();
  const journalPath = journalPathForToday();
  const preparedInputPromise = substituteLocalFiles(input, falKey).then((value) => value as JsonObject);
  const results = await Promise.all(Array.from({ length: count }, () =>
    executeGeneration(entry, input, preparedInputPromise, falKey, timeoutSeconds, pollSeconds, journalPath),
  ));
  const success = results.every((result) => result.success);
  console.log(JSON.stringify({ success, endpoint: entry.id, count, results, journal: journalPath }));
  if (!success) process.exitCode = 1;
}

async function executeGeneration(
  entry: Endpoint,
  originalInput: JsonObject,
  preparedInputPromise: Promise<JsonObject>,
  falKey: string,
  timeoutSeconds: number,
  pollSeconds: number,
  journalPath: string,
): Promise<RunResult> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;
  let requestId: string | undefined;
  let response: unknown = null;
  let journalInput = originalInput;
  const outputs: SavedOutput[] = [];
  let seed: number | undefined;
  let error: string | undefined;

  try {
    const input = await preparedInputPromise;
    journalInput = input;
    const queued = await submitQueue(entry.id, input, falKey, deadline, timeoutSeconds);
    requestId = queued.requestId;
    response = await pollQueue(queued, falKey, deadline, timeoutSeconds, pollSeconds);
    if (isRecord(response) && typeof response.seed === "number") seed = response.seed;
    const candidates = harvestOutputs(response);
    await mkdir(join(outputBaseDir(), getDateFolder()), { recursive: true });
    for (let index = 0; index < candidates.length; index++) {
      outputs.push(await downloadOutput(
        candidates[index],
        entry.id,
        input.prompt,
        index,
        candidates.length,
        deadline,
        timeoutSeconds,
      ));
    }
  } catch (caught) {
    error = errorMessage(caught);
    if (caught instanceof RequestError && caught.response !== null && caught.response !== undefined) {
      response = caught.response;
      if (typeof response === "string") {
        try {
          response = JSON.parse(response);
        } catch {
          // Preserve non-JSON response text; journal sanitization still handles a raw data URL.
        }
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  let success = error === undefined;
  try {
    await appendJournal(journalPath, entry.id, requestId, journalInput, response, outputs, durationMs, success, error);
  } catch (journalError) {
    const message = `Unable to append journal: ${errorMessage(journalError)}`;
    error = error ? `${error}; ${message}` : message;
    success = false;
  }

  return {
    success,
    ...(requestId ? { requestId } : {}),
    ...(seed !== undefined ? { seed } : {}),
    durationMs,
    outputs,
    ...(error ? { error } : {}),
  };
}

interface QueueReceipt {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

async function submitQueue(
  endpointId: string,
  input: JsonObject,
  falKey: string,
  deadline: number,
  timeoutSeconds: number,
): Promise<QueueReceipt> {
  const { data } = await authenticatedJsonFetch(
    `https://queue.fal.run/${endpointId}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    falKey,
    deadline,
    timeoutSeconds,
    "Queue submission",
  );
  if (!isRecord(data) || typeof data.request_id !== "string" || typeof data.status_url !== "string" ||
      typeof data.response_url !== "string") {
    throw new RequestError("Queue submission returned an unexpected response", data);
  }
  return { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

async function pollQueue(
  receipt: QueueReceipt,
  falKey: string,
  deadline: number,
  timeoutSeconds: number,
  initialPollSeconds: number,
): Promise<unknown> {
  let delaySeconds = Math.min(initialPollSeconds, 5);
  while (true) {
    await sleepUntilPoll(delaySeconds, deadline, timeoutSeconds);
    const { data, text } = await authenticatedJsonFetch(
      receipt.statusUrl,
      { method: "GET" },
      falKey,
      deadline,
      timeoutSeconds,
      "Queue status",
    );
    if (!isRecord(data) || typeof data.status !== "string") {
      throw new RequestError("Queue status returned an unexpected response", data);
    }
    const status = data.status.toUpperCase();
    if (status === "COMPLETED") {
      return (await authenticatedJsonFetch(
        receipt.responseUrl,
        { method: "GET" },
        falKey,
        deadline,
        timeoutSeconds,
        "Queue response",
      )).data;
    }
    if (status !== "IN_QUEUE" && status !== "IN_PROGRESS") {
      throw new RequestError(`Queue status ${status}: ${text}`, data);
    }
    delaySeconds = Math.min(delaySeconds + 0.5, 5);
  }
}

async function authenticatedJsonFetch(
  url: string,
  init: RequestInit,
  falKey: string,
  deadline: number,
  timeoutSeconds: number,
  label: string,
): Promise<{ data: unknown; text: string }> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RequestError(`Timed out after ${timeoutSeconds} seconds`, null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Key ${falKey}` },
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    if (Date.now() >= deadline || controller.signal.aborted) {
      throw new RequestError(`Timed out after ${timeoutSeconds} seconds`, null);
    }
    throw new RequestError(`${label} failed: ${errorMessage(error)}`, null);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new RequestError(`${label} failed (${response.status}): ${text}`, text);
  try {
    return { data: JSON.parse(text), text };
  } catch (error) {
    throw new RequestError(`${label} returned invalid JSON: ${text}`, text);
  }
}

async function sleepUntilPoll(seconds: number, deadline: number, timeoutSeconds: number): Promise<void> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RequestError(`Timed out after ${timeoutSeconds} seconds`, null);
  await Bun.sleep(Math.min(seconds * 1000, remaining));
  if (Date.now() >= deadline) throw new RequestError(`Timed out after ${timeoutSeconds} seconds`, null);
}

function harvestOutputs(value: unknown, outputs: OutputCandidate[] = []): OutputCandidate[] {
  if (Array.isArray(value)) {
    for (const item of value) harvestOutputs(item, outputs);
    return outputs;
  }
  if (!isRecord(value)) return outputs;
  if (typeof value.url === "string" && value.url.startsWith("http")) {
    outputs.push({
      url: value.url,
      ...(typeof value.content_type === "string" ? { contentType: value.content_type } : {}),
      ...(typeof value.width === "number" ? { width: value.width } : {}),
      ...(typeof value.height === "number" ? { height: value.height } : {}),
    });
  }
  for (const item of Object.values(value)) harvestOutputs(item, outputs);
  return outputs;
}

async function downloadOutput(
  output: OutputCandidate,
  endpointId: string,
  prompt: unknown,
  index: number,
  total: number,
  deadline: number,
  timeoutSeconds: number,
): Promise<SavedOutput> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new RequestError(`Timed out after ${timeoutSeconds} seconds`, null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);
  let response: Response;
  let body: ArrayBuffer;
  try {
    response = await fetch(output.url, { signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new RequestError(`Output download failed (${response.status}): ${text}`, null);
    }
    body = await response.arrayBuffer();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (Date.now() >= deadline || controller.signal.aborted) {
      throw new RequestError(`Timed out after ${timeoutSeconds} seconds`, null);
    }
    throw new RequestError(`Output download failed: ${errorMessage(error)}`, null);
  } finally {
    clearTimeout(timer);
  }
  const extension = getExtension(output.url, output.contentType);
  const promptWords = typeof prompt === "string" ? extractPromptWords(prompt) : "";
  const suffix = total > 1 ? `-${index + 1}` : "";
  const directory = join(outputBaseDir(), getDateFolder());
  await mkdir(directory, { recursive: true });
  let localPath: string;
  while (true) {
    const filename = `${generateUID()}-${slugifyEndpoint(endpointId)}${promptWords ? `-${promptWords}` : ""}${suffix}.${extension}`;
    localPath = join(directory, filename);
    if (!reservedOutputPaths.has(localPath) && !(await Bun.file(localPath).exists())) break;
    await Bun.sleep(1);
  }
  reservedOutputPaths.add(localPath);
  await Bun.write(localPath, body);
  return {
    url: output.url,
    localPath,
    ...(output.contentType ? { contentType: output.contentType } : {}),
  };
}
async function commandUpload(args: string[]): Promise<void> {
  if (args.length !== 1 || args[0].startsWith("--")) failUsage("upload requires exactly one local path", USAGES.upload);
  const falKey = requireFalKey();
  const localPath = resolve(expandHome(args[0]));
  let info;
  try {
    info = await stat(localPath);
  } catch {
    throw new CliError(`File not found: ${args[0]}`);
  }
  if (!info.isFile()) throw new CliError(`Not a file: ${args[0]}`);
  const url = await uploadFile(localPath, falKey);
  console.log(JSON.stringify({ success: true, url }));
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  if (!command) throw new CliError(USAGE);
  if (command === "list") return await commandList(args);
  if (command === "describe") return await commandDescribe(args);
  if (command === "run") return await commandRun(args);
  if (command === "upload") return await commandUpload(args);
  throw new CliError(`Unknown command "${command}". ${USAGE}`);
}

main().catch((error) => {
  printError(error);
  process.exitCode = 1;
});

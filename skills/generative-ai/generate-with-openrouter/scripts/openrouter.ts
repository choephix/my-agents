#!/usr/bin/env bun

import { appendFile, mkdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";

const REGISTRY_URL = new URL("../assets/models.yaml", import.meta.url);
const CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const EPOCH_OFFSET = new Date("2025-01-01T00:00:00Z").getTime();
const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_COUNT = 20;
const reservedOutputPaths = new Set<string>();

const USAGE = "Usage: openrouter.ts <list|describe|run> ...";
const USAGES = {
  list: "Usage: openrouter.ts list [--json]",
  describe: "Usage: openrouter.ts describe <ref> [--live] [--json]",
  run: "Usage: openrouter.ts run <ref> --json <object|@file|@-> [--count N] [--dry-run] [--timeout SECS]",
} as const;

type JsonObject = Record<string, unknown>;

interface ModelInput {
  required: string[];
  params: Record<string, string>;
}

interface ModelEntry {
  id: string;
  name: string;
  aliases: string[];
  capabilities: string[];
  description: string;
  notes?: string;
  input: ModelInput;
}

interface Registry {
  version: number;
  updated?: string;
  preferences?: string;
  models: ModelEntry[];
}

interface SavedOutput {
  localPath: string;
  contentType: string;
}

interface RunResult {
  success: boolean;
  durationMs: number;
  costUsd?: number;
  text?: string;
  outputs: SavedOutput[];
  error?: string;
}

interface PreparedInput {
  input: JsonObject;
  body: JsonObject;
}

interface DecodedImage {
  contentType: string;
  bytes: Buffer;
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
  console.error(JSON.stringify({ success: false, error: sanitizeTextForOutput(errorMessage(error)) }));
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function outputBaseDir(): string {
  return resolve(expandHome(process.env.OPENROUTER_OUTPUT_DIR || join(homedir(), "Generations")));
}

function journalBaseDir(): string {
  const configured = process.env.OPENROUTER_JOURNAL_DIR;
  return resolve(expandHome(configured || join(outputBaseDir(), ".journal")));
}

function requireOpenRouterKey(): string {
  const key = process.env.OPENROUTER_IMAGE_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) throw new CliError("OPENROUTER_IMAGE_KEY or OPENROUTER_API_KEY not found in environment variables");
  return key;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadRegistry(): Promise<Registry> {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(await Bun.file(REGISTRY_URL).text());
  } catch (error) {
    throw new CliError(`Unable to load model registry: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.models)) {
    throw new CliError("Unable to load model registry: expected registry version 1 with a models array");
  }

  const models: ModelEntry[] = [];
  const ids = new Set<string>();
  const normalizedAliases = new Map<string, string>();

  for (const raw of parsed.models) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string" ||
        !Array.isArray(raw.aliases) || !raw.aliases.every((alias) => typeof alias === "string") ||
        !Array.isArray(raw.capabilities) || !raw.capabilities.every((capability) => typeof capability === "string") ||
        typeof raw.description !== "string" || !isRecord(raw.input) ||
        !Array.isArray(raw.input.required) || !raw.input.required.every((field) => typeof field === "string") ||
        !isRecord(raw.input.params) || !Object.values(raw.input.params).every((value) => typeof value === "string") ||
        !(raw.notes === undefined || typeof raw.notes === "string")) {
      throw new CliError("Unable to load model registry: invalid model entry");
    }

    const idKey = raw.id.toLowerCase();
    if (ids.has(idKey)) throw new CliError(`Unable to load model registry: duplicate model id "${raw.id}"`);
    ids.add(idKey);

    const aliases = raw.aliases as string[];
    for (const alias of aliases) {
      const key = normalizeRef(alias);
      const previous = normalizedAliases.get(key);
      if (previous !== undefined) {
        throw new CliError(`Unable to load model registry: aliases "${previous}" and "${alias}" are not globally unique after normalization`);
      }
      normalizedAliases.set(key, alias);
    }

    models.push({
      id: raw.id,
      name: raw.name,
      aliases,
      capabilities: raw.capabilities as string[],
      description: raw.description,
      ...(typeof raw.notes === "string" ? { notes: raw.notes } : {}),
      input: {
        required: raw.input.required as string[],
        params: raw.input.params as Record<string, string>,
      },
    });
  }

  return {
    version: 1,
    ...(typeof parsed.updated === "string" ? { updated: parsed.updated } : {}),
    ...(typeof parsed.preferences === "string" ? { preferences: parsed.preferences } : {}),
    models,
  };
}

function normalizeRef(value: string): string {
  return value.toLowerCase().replace(/[\s.\-]/g, "");
}

function resolveModel(registry: Registry, reference: string): ModelEntry {
  const lower = reference.toLowerCase();
  const exactId = registry.models.find((entry) => entry.id.toLowerCase() === lower);
  if (exactId) return exactId;

  const exactAliases = registry.models.filter((entry) => entry.aliases.some((alias) => alias.toLowerCase() === lower));
  if (exactAliases.length === 1) return exactAliases[0];
  if (exactAliases.length > 1) throw ambiguousReference(reference, exactAliases);

  const normalized = normalizeRef(reference);
  const matches = registry.models.filter((entry) =>
    normalizeRef(entry.id) === normalized || entry.aliases.some((alias) => normalizeRef(alias) === normalized),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw ambiguousReference(reference, matches);

  const suggestions = registry.models
    .filter((entry) => {
      const values = [entry.id, ...entry.aliases].map(normalizeRef);
      return values.some((value) => value.includes(normalized) || normalized.includes(value));
    })
    .sort((a, b) => suggestionDistance(a, normalized) - suggestionDistance(b, normalized) || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((entry) => entry.id);
  const suffix = suggestions.length ? ` Suggestions: ${suggestions.join(", ")}` : "";
  throw new CliError(`Unknown model or alias "${reference}".${suffix}`);
}

function suggestionDistance(entry: ModelEntry, normalized: string): number {
  return Math.min(...[entry.id, ...entry.aliases].map((value) => Math.abs(normalizeRef(value).length - normalized.length)));
}

function ambiguousReference(reference: string, entries: ModelEntry[]): CliError {
  const candidates = [...new Set(entries.map((entry) => entry.id))].sort();
  return new CliError(`Ambiguous model reference "${reference}". Candidates: ${candidates.join(", ")}`);
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

function slugifyModel(modelId: string): string {
  const parts = modelId.split("/");
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
};

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function mimeTypeForPath(path: string): string {
  return EXTENSION_MIME_TYPES[extname(path).slice(1).toLowerCase()] || "application/octet-stream";
}

function extensionForContentType(contentType: string): string {
  return CONTENT_TYPE_EXTENSIONS[contentType.toLowerCase()] || "bin";
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

async function imageToDataUrl(path: string): Promise<string> {
  const buffer = await Bun.file(path).arrayBuffer();
  return `data:${mimeTypeForPath(path)};base64,${Buffer.from(buffer).toString("base64")}`;
}

async function inspectLocalImages(images: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const image of images) {
    if (await existingLocalFile(image)) paths.push(image);
  }
  return paths;
}

async function encodeLocalImages(images: string[]): Promise<string[]> {
  return await Promise.all(images.map(async (image) => {
    const localPath = await existingLocalFile(image);
    return localPath ? await imageToDataUrl(localPath) : image;
  }));
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

function sanitizeForOutput(value: unknown): unknown {
  if (typeof value === "string") return sanitizeTextForOutput(value);
  if (Array.isArray(value)) return value.map(sanitizeForOutput);
  if (isRecord(value)) {
    const output: JsonObject = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      output[sanitizeTextForOutput(key)] = sanitizeForOutput(item);
    }
    return output;
  }
  return value;
}

function sanitizeTextForOutput(value: string): string {
  return value.replace(/data:([a-z0-9.+/-]+)(?:;[^,\s"'<>]*)?,(?!<omitted \d+ chars>)[^\s"'<>]*/gi, (match, mime: string) => {
    const comma = match.indexOf(",");
    const omitted = comma >= 0 ? match.length - comma - 1 : match.length;
    return `data:${mime};base64,<omitted ${omitted} chars>`;
  });
}

function redactKeyFromText(value: string, key: string): string {
  if (key.length < 8) return value;
  return value
    .split(`Bearer ${key}`).join("<redacted>")
    .split(key).join("<redacted>");
}

function redactKeyFromValue(value: unknown, key: string): unknown {
  if (typeof value === "string") return redactKeyFromText(value, key);
  if (Array.isArray(value)) return value.map((item) => redactKeyFromValue(item, key));
  if (isRecord(value)) {
    const output: JsonObject = Object.create(null);
    for (const [name, item] of Object.entries(value)) {
      output[redactKeyFromText(name, key)] = redactKeyFromValue(item, key);
    }
    return output;
  }
  return value;
}

function redactAndSanitizeText(value: string, key: string): string {
  return sanitizeTextForOutput(redactKeyFromText(value, key));
}

function capJournalError(error: string, key: string): string {
  const sanitized = redactAndSanitizeText(error, key);
  if (sanitized.length <= 2048) return sanitized;
  const suffix = ` <truncated, ${sanitized.length} chars total>`;
  return `${sanitized.slice(0, 2048 - suffix.length)}${suffix}`;
}

function journalPathForToday(): string {
  return join(journalBaseDir(), `${getDateFolder()}.jsonl`);
}

async function appendJournal(
  journalPath: string,
  model: string,
  input: JsonObject,
  response: unknown,
  outputs: SavedOutput[],
  durationMs: number,
  success: boolean,
  key: string,
  costUsd?: number,
  error?: string,
): Promise<void> {
  await mkdir(journalBaseDir(), { recursive: true });
  const entry = {
    ts: new Date().toISOString(),
    model,
    input: redactKeyFromValue(sanitizeForJournal(input), key),
    response: redactKeyFromValue(sanitizeForJournal(response), key),
    outputs: outputs.map(({ localPath }) => ({ localPath })),
    durationMs,
    ...(costUsd !== undefined ? { costUsd } : {}),
    success,
    ...(error ? { error: capJournalError(error, key) } : {}),
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

function validateInput(input: JsonObject): { prompt: string; images: string[]; extras: JsonObject } {
  if (Object.prototype.hasOwnProperty.call(input, "messages")) {
    throw new CliError('Input key "messages" is not allowed; the runner owns messages');
  }
  if (Object.prototype.hasOwnProperty.call(input, "model")) {
    throw new CliError('Input key "model" is not allowed; the runner owns model');
  }
  if (typeof input.prompt !== "string") throw new CliError("prompt is required and must be a string");

  let images: string[] = [];
  if (Object.prototype.hasOwnProperty.call(input, "images")) {
    if (!Array.isArray(input.images) || !input.images.every((image) => typeof image === "string")) {
      throw new CliError("images must be an array of strings");
    }
    images = input.images as string[];
  }

  const extras = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "prompt" && key !== "images"),
  );
  return { prompt: input.prompt, images, extras };
}

function buildRequestBody(model: string, prompt: string, images: string[], extras: JsonObject): JsonObject {
  const content = images.length === 0
    ? prompt
    : [
        { type: "text", text: prompt },
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
      ];
  return {
    model,
    messages: [{ role: "user", content }],
    modalities: ["image", "text"],
    usage: { include: true },
    ...extras,
  };
}

async function commandList(args: string[]): Promise<void> {
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      if (json) failUsage("--json may only be specified once", USAGES.list);
      json = true;
    } else if (arg.startsWith("--")) {
      failUsage(`Unknown option ${arg}`, USAGES.list);
    } else {
      failUsage("Too many positional arguments", USAGES.list);
    }
  }

  const registry = await loadRegistry();
  if (json) {
    console.log(JSON.stringify(registry.models));
    return;
  }
  for (const entry of registry.models) {
    console.log(`${entry.id}  [${entry.capabilities.join(",")}]  aliases: ${entry.aliases.join(", ")} — ${entry.description}`);
  }
}

function printModel(entry: ModelEntry): void {
  console.log(`id: ${entry.id}`);
  console.log(`name: ${entry.name}`);
  console.log(`aliases: ${entry.aliases.join(", ")}`);
  console.log(`capabilities: ${entry.capabilities.join(", ")}`);
  console.log(`description: ${entry.description}`);
  console.log(`notes: ${entry.notes || ""}`);
  console.log(`required: ${entry.input.required.join(", ")}`);
  console.log("params:");
  for (const [name, description] of Object.entries(entry.input.params)) {
    console.log(`  ${name}: ${description}`);
  }
}

async function commandDescribe(args: string[]): Promise<void> {
  let reference: string | undefined;
  let live = false;
  let json = false;
  for (const arg of args) {
    if (arg === "--live") {
      if (live) failUsage("--live may only be specified once", USAGES.describe);
      live = true;
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
  if (!reference) failUsage("describe requires a model id or alias", USAGES.describe);

  const registry = await loadRegistry();
  const entry = resolveModel(registry, reference);
  const liveDetails = live ? await fetchLiveDetails(entry.id) : undefined;
  if (json) {
    console.log(JSON.stringify(live ? { model: entry, live: liveDetails } : entry));
    return;
  }
  printModel(entry);
  if (liveDetails) {
    console.log("live:");
    console.log(`  pricing: ${JSON.stringify(liveDetails.pricing)}`);
    console.log(`  input modalities: ${liveDetails.inputModalities.join(", ")}`);
    console.log(`  output modalities: ${liveDetails.outputModalities.join(", ")}`);
  }
}

async function fetchLiveDetails(modelId: string): Promise<{
  pricing: unknown;
  inputModalities: string[];
  outputModalities: string[];
}> {
  let response: Response;
  try {
    response = await fetch(MODELS_URL);
  } catch (error) {
    throw new CliError(`Unable to fetch OpenRouter model catalog: ${errorMessage(error)}`);
  }
  const text = await response.text();
  if (!response.ok) throw new CliError(`Unable to fetch OpenRouter model catalog (${response.status}): ${sanitizeTextForOutput(text)}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new CliError(`Unable to parse OpenRouter model catalog: ${errorMessage(error)}`);
  }
  const data = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : null;
  if (!data) throw new CliError("Unable to parse OpenRouter model catalog: expected a data array");
  const model = data.find((candidate) => isRecord(candidate) && candidate.id === modelId);
  if (!isRecord(model)) throw new CliError(`Model "${modelId}" has vanished from the OpenRouter catalog`);
  const architecture = isRecord(model.architecture) ? model.architecture : {};
  return {
    pricing: model.pricing ?? null,
    inputModalities: Array.isArray(architecture.input_modalities)
      ? architecture.input_modalities.filter((value): value is string => typeof value === "string")
      : [],
    outputModalities: Array.isArray(architecture.output_modalities)
      ? architecture.output_modalities.filter((value): value is string => typeof value === "string")
      : [],
  };
}

async function commandRun(args: string[]): Promise<void> {
  let reference: string | undefined;
  let jsonSource: string | undefined;
  let count = 1;
  let dryRun = false;
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (["--json", "--count", "--timeout"].includes(arg)) {
      if (seen.has(arg)) failUsage(`${arg} may only be specified once`, USAGES.run);
      seen.add(arg);
      const value = requireOptionValue(args, index, arg, USAGES.run);
      index++;
      if (arg === "--json") jsonSource = value;
      else if (arg === "--count") count = parseCount(value, USAGES.run);
      else timeoutSeconds = parsePositiveNumber(value, arg, USAGES.run);
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

  if (!reference) failUsage("run requires a model id or alias", USAGES.run);
  if (jsonSource === undefined) failUsage("run requires --json", USAGES.run);

  const registry = await loadRegistry();
  const entry = resolveModel(registry, reference);
  const originalInput = await readJsonInput(jsonSource);
  const { prompt, images, extras } = validateInput(originalInput);
  const dryRunBody = buildRequestBody(entry.id, prompt, images, extras);

  if (dryRun) {
    const wouldEncode = await inspectLocalImages(images);
    console.log(JSON.stringify({ success: true, dryRun: true, model: entry.id, body: sanitizeForOutput(dryRunBody), wouldEncode }));
    return;
  }

  const key = requireOpenRouterKey();
  const journalPath = journalPathForToday();
  const preparedInputPromise = prepareInput(entry.id, originalInput, prompt, images, extras);
  const results = await Promise.all(Array.from({ length: count }, () =>
    executeGeneration(entry, originalInput, preparedInputPromise, key, timeoutSeconds, journalPath),
  ));
  const success = results.every((result) => result.success);
  console.log(JSON.stringify({ success, model: entry.id, count, results, journal: journalPath }));
  if (!success) process.exitCode = 1;
}

async function prepareInput(
  model: string,
  originalInput: JsonObject,
  prompt: string,
  images: string[],
  extras: JsonObject,
): Promise<PreparedInput> {
  const encodedImages = await encodeLocalImages(images);
  return {
    input: Object.prototype.hasOwnProperty.call(originalInput, "images")
      ? { ...originalInput, images: encodedImages }
      : originalInput,
    body: buildRequestBody(model, prompt, encodedImages, extras),
  };
}

async function executeGeneration(
  entry: ModelEntry,
  originalInput: JsonObject,
  preparedInputPromise: Promise<PreparedInput>,
  key: string,
  timeoutSeconds: number,
  journalPath: string,
): Promise<RunResult> {
  const startedAt = Date.now();
  let journalInput = originalInput;
  let response: unknown = null;
  const outputs: SavedOutput[] = [];
  let costUsd: number | undefined;
  let text: string | undefined;
  let error: string | undefined;

  try {
    const prepared = await preparedInputPromise;
    journalInput = prepared.input;
    response = await requestGeneration(prepared.body, key, timeoutSeconds);
    if (!isRecord(response)) throw new RequestError("OpenRouter returned an invalid response object", response);

    const usage = isRecord(response.usage) ? response.usage : undefined;
    if (usage && typeof usage.cost === "number" && Number.isFinite(usage.cost)) costUsd = usage.cost;

    const choice = Array.isArray(response.choices) ? response.choices[0] : undefined;
    const choiceError = isRecord(choice) ? choice.error : undefined;
    if (response.error !== undefined) throw new RequestError(formatApiError(response.error, key), response);
    if (choiceError !== undefined) throw new RequestError(formatApiError(choiceError, key), response);

    const message = isRecord(choice) && isRecord(choice.message) ? choice.message : undefined;
    const assistantText = normalizeAssistantText(message?.content);
    if (assistantText !== undefined) text = redactAndSanitizeText(assistantText, key);
    const images = decodeResponseImages(message?.images);
    if (images.length === 0) throw new RequestError("no image in response", response);
    for (let index = 0; index < images.length; index++) {
      outputs.push(await saveImage(images[index], entry.id, prepared.input.prompt, index, images.length));
    }
  } catch (caught) {
    error = redactAndSanitizeText(errorMessage(caught), key);
    if (caught instanceof RequestError && caught.response !== null && caught.response !== undefined) {
      response = caught.response;
    }
  }

  const durationMs = Date.now() - startedAt;
  let success = error === undefined;
  try {
    await appendJournal(journalPath, entry.id, journalInput, response, outputs, durationMs, success, key, costUsd, error);
  } catch (journalError) {
    const message = `Unable to append journal: ${errorMessage(journalError)}`;
    error = redactAndSanitizeText(error ? `${error}; ${message}` : message, key);
    success = false;
  }

  return {
    success,
    durationMs,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(text !== undefined ? { text } : {}),
    outputs,
    ...(error ? { error } : {}),
  };
}

async function requestGeneration(body: JsonObject, key: string, timeoutSeconds: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  let response: Response;
  let text: string;
  try {
    response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted) throw new RequestError(`Timed out after ${timeoutSeconds} seconds`, null);
    throw new RequestError(`OpenRouter request failed: ${redactAndSanitizeText(errorMessage(error), key)}`, null);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new RequestError(
      `OpenRouter request failed (${response.status}): ${redactAndSanitizeText(text, key)}`,
      redactKeyFromValue(parseResponseForJournal(text), key),
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError(`OpenRouter returned invalid JSON: ${redactAndSanitizeText(text, key)}`, redactKeyFromText(text, key));
  }
}

function parseResponseForJournal(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatApiError(value: unknown, key: string): string {
  if (!isRecord(value)) return `OpenRouter error: ${stringifySafely(value, key)}`;
  const message = typeof value.message === "string" ? value.message : "OpenRouter returned an error";
  const metadata = value.metadata;
  return redactAndSanitizeText(
    metadata === undefined
      ? message
      : `${message}; metadata: ${stringifySafely(metadata, key)}`,
    key,
  );
}

function stringifySafely(value: unknown, key: string): string {
  try {
    return redactAndSanitizeText(JSON.stringify(value), key);
  } catch {
    return redactAndSanitizeText(String(value), key);
  }
}

function normalizeAssistantText(value: unknown): string | undefined {
  const text = typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value
          .filter((part): part is JsonObject & { text: string } => isRecord(part) && typeof part.text === "string")
          .map((part) => part.text)
          .filter((partText) => partText.length > 0)
          .join("\n")
      : "";
  return text.length > 0 ? text : undefined;
}

function decodeResponseImages(value: unknown): DecodedImage[] {
  if (!Array.isArray(value)) return [];
  const images: DecodedImage[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || raw.type !== "image_url" || !isRecord(raw.image_url) || typeof raw.image_url.url !== "string") {
      throw new Error("OpenRouter returned an invalid image entry");
    }
    const match = /^data:([^;,]+);base64,(.*)$/.exec(raw.image_url.url);
    if (!match) throw new Error("OpenRouter returned an image that is not a base64 data URL");
    images.push({ contentType: match[1].toLowerCase(), bytes: decodeBase64ImagePayload(match[2]) });
  }
  return images;
}

function decodeBase64ImagePayload(payload: string): Buffer {
  if (payload.length === 0) throw new Error("OpenRouter returned an image with an empty base64 payload");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error("OpenRouter returned an image with invalid base64 data");
  }

  const paddingLength = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const unpadded = paddingLength > 0 ? payload.slice(0, -paddingLength) : payload;
  const remainder = unpadded.length % 4;
  const invalidPadding = paddingLength > 0 && (
    payload.length % 4 !== 0 ||
    (paddingLength === 1 && remainder !== 3) ||
    (paddingLength === 2 && remainder !== 2)
  );
  if (remainder === 1 || invalidPadding) {
    throw new Error("OpenRouter returned an image with invalid base64 length or padding");
  }

  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0) throw new Error("OpenRouter returned an image whose base64 payload decoded to zero bytes");
  if (bytes.toString("base64").replace(/=+$/, "") !== unpadded) {
    throw new Error("OpenRouter returned an image with invalid base64 data");
  }
  return bytes;
}

async function saveImage(
  image: DecodedImage,
  modelId: string,
  prompt: unknown,
  index: number,
  total: number,
): Promise<SavedOutput> {
  const extension = extensionForContentType(image.contentType);
  const promptWords = typeof prompt === "string" ? extractPromptWords(prompt) : "";
  const suffix = total > 1 ? `-${index + 1}` : "";
  const directory = join(outputBaseDir(), getDateFolder());
  await mkdir(directory, { recursive: true });
  let localPath: string;
  while (true) {
    const filename = `${generateUID()}-${slugifyModel(modelId)}${promptWords ? `-${promptWords}` : ""}${suffix}.${extension}`;
    localPath = join(directory, filename);
    if (!reservedOutputPaths.has(localPath) && !(await Bun.file(localPath).exists())) break;
    await Bun.sleep(1);
  }
  reservedOutputPaths.add(localPath);
  await Bun.write(localPath, image.bytes);
  return { localPath, contentType: image.contentType };
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  if (!command) throw new CliError(USAGE);
  if (command === "list") return await commandList(args);
  if (command === "describe") return await commandDescribe(args);
  if (command === "run") return await commandRun(args);
  throw new CliError(`Unknown command "${command}". ${USAGE}`);
}

main().catch((error) => {
  printError(error);
  process.exitCode = 1;
});

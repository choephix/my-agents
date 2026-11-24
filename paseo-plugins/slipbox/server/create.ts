import { mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { formatLocalDate, type SlipKind, slugifySlipTitle } from "../shared/frontmatter";

export interface CreateSlipInput {
  boxFolder: string;
  title: string;
  body?: string;
  kind?: SlipKind;
  emoji?: string;
  about?: string;
  from?: string;
  date?: Date;
  home?: string;
}

export interface CreatedSlip {
  absolutePath: string;
  relativePath: string;
  wikiName: string;
  title: string;
  kind: SlipKind;
  emoji: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function contractHomePath(raw: string, home: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("~/") || trimmed === "~") return trimmed;
  const resolved = path.resolve(trimmed);
  const resolvedHome = path.resolve(home);
  if (resolved === resolvedHome) return "~";
  if (resolved.startsWith(`${resolvedHome}${path.sep}`)) {
    return `~/${toPosix(resolved.slice(resolvedHome.length + 1))}`;
  }
  return trimmed;
}

function yamlValue(value: string): string {
  const singleLine = value.replace(/\r?\n/g, " ").trim();
  if (/[:#[\]{}&*!|>'"%@`]|^\s|\s$/.test(singleLine)) {
    return JSON.stringify(singleLine);
  }
  return singleLine;
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

export async function createSlipFile(input: CreateSlipInput): Promise<CreatedSlip> {
  const title = input.title.trim();
  if (!title) throw new Error("Slip title cannot be empty.");

  const kind: SlipKind = input.kind ?? "note";
  const emoji = (input.emoji ?? "").trim();
  const home = input.home ?? homedir();
  const about = input.about ? contractHomePath(input.about, home) : "";
  const from = (input.from ?? "").trim();
  const body = (input.body ?? "").trim();

  const hasStructuredMemos = await isDirectory(path.join(input.boxFolder, "memos"));
  const subDir = hasStructuredMemos ? (kind === "capture" ? "captures" : "memos") : "";
  const targetDir = subDir ? path.join(input.boxFolder, subDir) : input.boxFolder;
  await mkdir(targetDir, { recursive: true });

  const datePrefix = formatLocalDate(input.date);
  const baseSlug = `${datePrefix}-${slugifySlipTitle(title)}`;

  const fmLines = ["---", `kind: ${kind}`];
  if (emoji) fmLines.push(`emoji: ${yamlValue(emoji)}`);
  if (about) fmLines.push(`about: ${yamlValue(about)}`);
  if (from) fmLines.push(`from: ${yamlValue(from)}`);
  fmLines.push("---");

  const docParts = [fmLines.join("\n"), `# ${title}`];
  if (body) docParts.push(body);
  const content = `${docParts.join("\n\n")}\n`;

  for (let attempt = 1; attempt <= 99; attempt++) {
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const filename = `${slug}.md`;
    const absolutePath = path.join(targetDir, filename);
    try {
      await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
      const relativePath = subDir ? `${subDir}/${filename}` : filename;
      return {
        absolutePath,
        relativePath,
        wikiName: slug,
        title,
        kind,
        emoji,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }

  throw new Error(`Could not allocate a unique filename for ${baseSlug}.`);
}

import { openExternalUrl } from "@getpaseo/plugin/client";
import type { ReactNode } from "react";
import { Text, type TextStyle } from "react-native";
import type { Desk, PrState } from "../shared/desk";
import { MONO, type Palette } from "./palette";

// One line of the desk's Markdown (a title, an answer, a blocks line): `code`, **bold**, [links](…) and PR numbers
// (#13855, PR 13855, a github.com/<repo>/pull/N URL), each PR number coloured by its live state.

const TOKEN = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)\S*|(^|[\s(])(?:#|PR\s?)(\d{4,6})\b/g;

export function prInfo(desk: Desk, n: number): { state: PrState; tip: string } {
  const pr = desk.prs[`${desk.repo}#${n}`];
  return pr ? { state: pr.state, tip: `#${n} · ${pr.words} · ${pr.title}` } : { state: "unknown", tip: `#${n} · not fetched yet` };
}

export function prStyle(c: Palette, state: PrState): TextStyle {
  return {
    color: c.pr(state),
    fontWeight: state === "unknown" || state === "draft" ? "400" : "600",
    textDecorationLine: state === "closed" ? "line-through" : "none",
  };
}

export const prUrl = (desk: Desk, n: number): string => `https://github.com/${desk.repo}/pull/${n}`;

/** PR numbers written in `text`, the way Inline finds them. */
export function prsIn(text: string, found = new Set<number>()): Set<number> {
  for (const m of text.matchAll(TOKEN)) {
    if (m[2] != null) prsIn(m[2], found);
    const n = m[6] ?? m[8] ?? (m[4] && /^#?\d+$/.test(m[3]!) ? /\/pull\/(\d+)/.exec(m[4])?.[1] : undefined);
    if (n) found.add(Number(n));
  }
  return found;
}

function nodes(text: string, desk: Desk, c: Palette, style: TextStyle): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    const lead = m[7] ?? "";
    if (at + lead.length > last) parts.push(text.slice(last, at + lead.length));
    last = at + m[0].length;
    const key = parts.length;
    if (m[1] != null) {
      parts.push(
        <Text key={key} style={{ fontFamily: MONO, fontSize: (style.fontSize ?? 13) - 1, backgroundColor: c.alpha(c.fg, 0.08) }}>
          {m[1]}
        </Text>,
      );
    } else if (m[2] != null) {
      parts.push(
        <Text key={key} style={{ fontWeight: "600" }}>
          {nodes(m[2], desk, c, style)}
        </Text>,
      );
    } else if (m[3] != null) {
      const url = m[4]!;
      const pull = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(url);
      parts.push(
        pull && pull[1] === desk.repo && /^#?\d+$/.test(m[3]) ? (
          <PrRef key={key} desk={desk} c={c} n={Number(pull[2])} />
        ) : (
          <Text key={key} style={{ color: c.ok }} onPress={() => void openExternalUrl(url)} accessibilityRole="link">
            {m[3]}
          </Text>
        ),
      );
    } else {
      const repo = m[5];
      if (repo && repo !== desk.repo) {
        parts.push(m[0]);
        continue;
      }
      parts.push(<PrRef key={key} desk={desk} c={c} n={Number(m[6] ?? m[8])} />);
    }
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function PrRef({ desk, c, n }: { desk: Desk; c: Palette; n: number }) {
  const { state, tip } = prInfo(desk, n);
  return (
    <Text style={prStyle(c, state)} onPress={() => void openExternalUrl(prUrl(desk, n))} accessibilityRole="link" accessibilityLabel={tip}>
      #{n}
    </Text>
  );
}

export function Inline({ text, desk, c, style, lines }: { text: string; desk: Desk; c: Palette; style: TextStyle; lines?: number }) {
  return (
    <Text style={style} numberOfLines={lines}>
      {nodes(text, desk, c, style)}
    </Text>
  );
}

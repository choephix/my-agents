import type { PluginTheme } from "@getpaseo/plugin";
import { useAgent, type PluginButtonContentProps, type PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast, type ToastApi } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { expandCommand } from "../shared/commands";
import { listCommands, sendCommand, type CommandListing as Listing, type CommandView } from "../shared/rpc";
import { extraMuted } from "./colors";
import { focusComposer, insertIntoComposer, isEditable, onWindowKey, pressPill, scrollIntoView } from "./web";

const EMPTY = "No commands yet. Put .md files in .agents/commands/ in this project or in ~/.agents/commands/.";
/** Popover width on wide layouts, as the mock: the host allows 280–420 and adds 12 px padding. */
const WIDTH = 400;
const HOST_PADDING = 12;

/** Last fetched list per chat, so reopening shows it at once while it refreshes. */
const listings = new Map<string, Listing>();

/**
 * Paseo closes its popovers on Escape before any plugin sees the key. A list closed that way with
 * a filter typed is reopened, unfiltered, when that Escape is released: Escape clears the filter.
 */
let closedWhileFiltered: { agentId: string; at: number } | null = null;
export function reopenOnFilterEscape(): () => void {
  return onWindowKey("keyup", (event) => {
    const closed = closedWhileFiltered;
    closedWhileFiltered = null;
    if (event.key === "Escape" && closed && Date.now() - closed.at < 600) pressPill(closed.agentId);
  });
}

function visibleRows(listing: Listing, query: string): CommandView[] {
  const needle = query.trim().toLowerCase();
  const rows = needle ? listing.commands.filter((command) => `${command.name} ${command.description}`.toLowerCase().includes(needle)) : listing.commands;
  return listing.groups ? [...rows.filter((row) => row.scope === "project"), ...rows.filter((row) => row.scope === "user")] : rows;
}

/** `text` with the first match of `query` underlined, as the mock marks filter hits. */
function Marked({ text, query, color }: { text: string; query: string; color: string }) {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return <>
    {text.slice(0, at)}
    <Text style={{ textDecorationLine: "underline", textDecorationColor: color }}>{text.slice(at, at + needle.length)}</Text>
    {text.slice(at + needle.length)}
  </>;
}

interface RowProps {
  command: CommandView;
  theme: PluginTheme;
  query: string;
  active: boolean;
  large: boolean;
  onPress(): void;
  onHover?(): void;
}

/** Name, then the extra-muted description on the same line, wrapping, two lines at most. */
function Row({ command, theme, query, active, large, onPress, onHover }: RowProps) {
  const { colors } = theme;
  const faint = extraMuted(theme);
  const ref = useRef<View>(null);
  useEffect(() => {
    if (active) scrollIntoView(ref.current);
  }, [active]);
  const tail = command.source !== "agents" || command.onClick === "send";
  return (
    <Pressable
      ref={ref}
      focusable={false}
      accessibilityRole="button"
      accessibilityLabel={command.onClick === "send" ? `${command.name}, sends at once` : command.name}
      onPress={onPress}
      onHoverIn={onHover}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        minHeight: large ? 48 : 30,
        paddingVertical: large ? 8 : 5,
        paddingHorizontal: large ? 16 : 12,
        backgroundColor: active ? colors.surface2 : undefined,
      }}
    >
      <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: colors.foreground, fontSize: large ? 15 : 13, lineHeight: large ? 20 : 18 }}>
        <Marked text={command.name} query={query} color={faint} />
        {command.description ? (
          <Text style={{ color: faint, fontSize: large ? 13 : 12.5 }}>
            {"\u2002"}
            <Marked text={command.description} query={query} color={faint} />
          </Text>
        ) : null}
      </Text>
      {tail ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: large ? 3 : 2 }}>
          {command.source !== "agents" ? (
            <Text style={{ fontSize: large ? 12 : 10.5, lineHeight: 15, paddingHorizontal: 5, borderRadius: 4, borderWidth: 1, borderColor: colors.border, color: faint }}>
              {command.source}
            </Text>
          ) : null}
          {command.onClick === "send" ? <Icon name="ArrowUp" size={12} color={colors.foregroundMuted} /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

function Rows(props: { rows: CommandView[]; groups: boolean; theme: PluginTheme; query: string; active: number; large: boolean; onPick(command: CommandView): void; onHover?(index: number): void }) {
  const faint = extraMuted(props.theme);
  return <>
    {props.rows.map((command, index) => {
      const heading = props.groups && (index === 0 || props.rows[index - 1].scope !== command.scope);
      return (
        <View key={command.name}>
          {heading ? (
            <Text style={{ paddingTop: index === 0 ? 4 : props.large ? 12 : 8, paddingBottom: props.large ? 4 : 2, paddingHorizontal: props.large ? 16 : 12, fontSize: props.large ? 12 : 11, lineHeight: 15, color: faint }}>
              {command.scope === "project" ? "Project" : "User"}
            </Text>
          ) : null}
          <Row command={command} theme={props.theme} query={props.query} active={index === props.active} large={props.large}
            onPress={() => props.onPick(command)} onHover={props.onHover ? () => props.onHover?.(index) : undefined} />
        </View>
      );
    })}
  </>;
}

function Note({ theme, large, children }: { theme: PluginTheme; large: boolean; children: ReactNode }) {
  return <Text style={{ paddingVertical: large ? 12 : 10, paddingHorizontal: large ? 16 : 12, fontSize: large ? 14 : 13, lineHeight: large ? 20 : 18, color: theme.colors.foregroundMuted }}>{children}</Text>;
}

/** Wide web layouts: type to filter (a filter line appears), ↑ ↓ to move, ↵ to pick, Esc clears. */
function DesktopList({ agentId, listing, theme, onPick }: { agentId: string; listing: Listing; theme: PluginTheme; onPick(command: CommandView): void }) {
  const { colors } = theme;
  const faint = extraMuted(theme);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rows = visibleRows(listing, query);
  const latest = useRef({ rows, active, query, onPick });
  latest.current = { rows, active, query, onPick };

  useEffect(() => onWindowKey("keydown", (event) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
    const { rows, active, query, onPick } = latest.current;
    const count = rows.length;
    if (event.key === "ArrowDown" && count) setActive((active + 1) % count);
    else if (event.key === "ArrowUp" && count) setActive((active - 1 + count) % count);
    else if (event.key === "Enter" && count) onPick(rows[Math.min(active, count - 1)]);
    else if (event.key === "Backspace" && query) [setQuery(query.slice(0, -1)), setActive(0)];
    else if (event.key === "Escape" && query) [setQuery(""), setActive(0)];
    else if (event.key.length === 1 && (query || event.key !== " ")) [setQuery(query + event.key), setActive(0)];
    else return;
    event.preventDefault();
    event.stopPropagation();
  }), []);
  // Closed by Escape with a filter typed: reopen (see `reopenOnFilterEscape`).
  useEffect(() => () => {
    if (latest.current.query) closedWhileFiltered = { agentId, at: Date.now() };
  }, [agentId]);

  return (
    <View style={{ width: WIDTH, margin: -HOST_PADDING }}>
      {query ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7, height: 30, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Icon name="Search" size={12} color={faint} />
          <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, color: colors.foreground }}>{query}</Text>
            <View style={{ width: 1.5, height: 15, marginLeft: 1, backgroundColor: colors.foreground }} />
          </View>
          <View style={{ flex: 1 }} />
          <Text style={{ fontSize: 10.5, lineHeight: 15, paddingHorizontal: 4, borderRadius: 4, borderWidth: 1, borderColor: colors.border, color: colors.foregroundMuted }}>esc</Text>
          <Text style={{ fontSize: 11, color: faint }}>clear</Text>
        </View>
      ) : null}
      <View style={{ paddingVertical: 4 }}>
        {rows.length ? (
          <Rows rows={rows} groups={listing.groups} theme={theme} query={query} active={active} large={false} onPick={onPick} onHover={setActive} />
        ) : (
          <Note theme={theme} large={false}>{listing.commands.length ? `No command matches “${query}”.` : EMPTY}</Note>
        )}
      </View>
    </View>
  );
}

/** Phones (and native apps): search field, list; a tap opens a small send sheet for the command. */
function SheetFlow({ listing, theme, busy, onSend }: { listing: Listing; theme: PluginTheme; busy: boolean; onSend(command: CommandView, args: string): void }) {
  const { colors } = theme;
  const faint = extraMuted(theme);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<CommandView | null>(null);
  const [args, setArgs] = useState("");
  const field = { fontSize: 16, color: colors.foreground, backgroundColor: colors.surface2, borderRadius: 10 } as const;

  if (picked) {
    const label = { fontSize: 12, color: faint, marginTop: 4 } as const;
    return (
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the list" hitSlop={10} onPress={() => [setPicked(null), setArgs("")]}>
            <Icon name="ChevronLeft" size={18} color={colors.foregroundMuted} />
          </Pressable>
          <Text style={{ fontSize: 15, fontWeight: "500", color: colors.foreground }}>{picked.name}</Text>
        </View>
        {picked.description ? <Text style={{ fontSize: 13, lineHeight: 18, color: colors.foregroundMuted, marginBottom: 4 }}>{picked.description}</Text> : null}
        <Text style={label}>Arguments</Text>
        <TextInput value={args} onChangeText={setArgs} placeholder={picked.argumentHint || "optional"} placeholderTextColor={faint}
          autoCapitalize="none" autoCorrect={false} returnKeyType="send" onSubmitEditing={() => onSend(picked, args)}
          style={{ ...field, height: 44, paddingHorizontal: 12 }} />
        <Text style={label}>Preview</Text>
        <ScrollView style={{ maxHeight: 200, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface0 }} contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 14, lineHeight: 20, color: colors.foregroundMuted }}>{expandCommand(picked.body, args)}</Text>
        </ScrollView>
        <Pressable accessibilityRole="button" onPress={() => onSend(picked, args)}
          style={{ marginTop: 10, height: 44, borderRadius: 10, backgroundColor: colors.foreground, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Icon name="ArrowUp" size={16} color={colors.surface0} />
          <Text style={{ fontSize: 15, fontWeight: "500", color: colors.surface0 }}>{busy ? (listing.queues ? "Send as follow-up" : "Send into the running reply") : "Send"}</Text>
        </Pressable>
      </View>
    );
  }

  const rows = visibleRows(listing, query);
  return (
    <View style={{ marginHorizontal: -HOST_PADDING }}>
      {listing.commands.length ? (
        <View style={{ ...field, flexDirection: "row", alignItems: "center", gap: 8, height: 38, marginHorizontal: 12, marginBottom: 4, paddingHorizontal: 12 }}>
          <Icon name="Search" size={16} color={faint} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search commands" placeholderTextColor={faint}
            autoCapitalize="none" autoCorrect={false} style={{ flex: 1, minWidth: 0, fontSize: 16, color: colors.foreground, padding: 0 }} />
        </View>
      ) : null}
      {rows.length ? (
        <Rows rows={rows} groups={listing.groups} theme={theme} query={query} active={-1} large
          onPick={(command) => (command.onClick === "send" ? onSend(command, "") : setPicked(command))} />
      ) : (
        <Note theme={theme} large>{listing.commands.length ? `No command matches “${query}”.` : EMPTY}</Note>
      )}
    </View>
  );
}

async function send(client: PluginClientContext, toast: ToastApi, agentId: string, command: CommandView, args: string) {
  try {
    const result = await client.rpc(sendCommand, { agentId, name: command.name, args });
    if (!result.sent) toast.error(`${command.name}: the file is gone (${command.path})`);
  } catch (error) {
    toast.error(`Couldn't send ${command.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The `cmds` pill's popover (wide web layouts) or bottom sheet (phones, native apps). `onListed`
 * runs after each fresh read, so the `/` menu picks up files added since.
 */
export function createCommandsPopover(client: PluginClientContext, onListed: () => void) {
  return function CommandsPopover(props: PluginButtonContentProps) {
    const { theme, layout, close } = props;
    const agentId = props.context === "agent" ? props.agentId : "";
    const toast = useToast();
    const busy = useAgent(agentId, (agent) => agent.status === "running") ?? false;
    const [listing, setListing] = useState(() => listings.get(agentId) ?? null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      let live = true;
      client.rpc(listCommands, { agentId }).then(
        (fresh) => {
          listings.set(agentId, fresh);
          onListed();
          if (live) setListing(fresh);
        },
        (failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)),
      );
      return () => {
        live = false;
      };
    }, [agentId]);

    const sheet = layout.compact || Platform.OS !== "web";
    if (!listing) {
      return (
        <View style={sheet ? { marginHorizontal: -HOST_PADDING } : { width: WIDTH, margin: -HOST_PADDING, paddingVertical: 4 }}>
          <Note theme={theme} large={sheet}>{error ? `Couldn't list the commands: ${error}` : "Loading…"}</Note>
        </View>
      );
    }
    const sendNow = (command: CommandView, args: string) => {
      close();
      void send(client, toast, agentId, command, args);
    };
    if (sheet) return <SheetFlow listing={listing} theme={theme} busy={busy} onSend={sendNow} />;

    const pick = (command: CommandView) => {
      if (command.onClick === "send") return sendNow(command, "");
      const caret = insertIntoComposer(agentId, command.body);
      if (caret === null) {
        toast.error("Couldn't find this chat's message box.");
        return;
      }
      close();
      // The closing popover hands focus back to the pill first; take it after that.
      setTimeout(() => focusComposer(agentId, caret), 60);
    };
    return <DesktopList agentId={agentId} listing={listing} theme={theme} onPick={pick} />;
  };
}

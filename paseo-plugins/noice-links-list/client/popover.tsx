import { useAgent, type PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import type { LinkKind } from "../shared/links";
import { LinkRow, listStyles, SubagentsSwitch, TypeTabs, useLinkPress } from "./list-ui";
import { kindCounts, shownKind, subagentChoices, typeChoices, withSubagents, type ChatLinks, type LinksStore } from "./store";

/** While the chat's agent runs, an open popover refetches this often. */
const RUNNING_REFRESH_MS = 3_000;

export function createLinksPopover(store: LinksStore<ChatLinks>) {
  const subscribe = (listener: () => void) => store.subscribe(listener);

  return function LinksPopover(props: PluginButtonContentProps) {
    const { theme, layout, close } = props;
    const agentId = props.context === "agent" ? props.agentId : "";
    const chat = useSyncExternalStore(subscribe, () => store.get(agentId));
    const [choice, setChoice] = useState<LinkKind | undefined>(() => typeChoices.get(agentId));
    const choose = useCallback(
      (kind: LinkKind) => {
        typeChoices.set(agentId, kind);
        setChoice(kind);
      },
      [agentId],
    );
    const [subagentsShown, setSubagentsShown] = useState(() => subagentChoices.has(agentId));
    const toggleSubagents = useCallback(() => {
      if (subagentsShown) subagentChoices.delete(agentId);
      else subagentChoices.add(agentId);
      setSubagentsShown(!subagentsShown);
    }, [agentId, subagentsShown]);
    const status = useAgent(agentId, (agent) => agent.status);
    const { press, open, copied } = useLinkPress(close);

    // Registered before the refresh below, so the popover's own fetch already includes sub-agents.
    useEffect(() => store.watchSubagents(agentId), [agentId]);
    useEffect(() => {
      void store.refresh(agentId);
    }, [agentId]);
    useEffect(() => {
      if (status !== "running") return;
      const timer = setInterval(() => void store.refresh(agentId), RUNNING_REFRESH_MS);
      return () => clearInterval(timer);
    }, [agentId, status]);

    const { compact } = layout;
    const styles = listStyles(theme, compact);
    // The surface is 280–420 px wide and sizes to its content; rows want all of it.
    const list = compact ? {} : { width: 396 };
    const links = chat.data?.links;
    const subagentLinks = chat.data?.subagentLinks ?? null;
    const extra = subagentLinks?.length ?? 0;
    // One width for every state: the surface keeps the width it first measured.
    const message = !links ? (chat.error ? `Couldn't read this chat: ${chat.error}` : "Loading…") : links.length || extra ? null : "No links in this chat yet";
    if (!links || message) {
      return (
        <View style={list}>
          <Text style={styles.line}>{message}</Text>
        </View>
      );
    }

    const all = withSubagents(links, subagentLinks, subagentsShown);
    const kinds = kindCounts(all);
    const shown = shownKind(all, choice);
    const rows = all.filter((link) => link.kind === shown);
    const now = Date.now();
    return (
      <View style={list}>
        {kinds.length > 1 || extra ? (
          <View style={styles.header}>
            <View style={styles.tabs}>
              {kinds.length > 1 ? <TypeTabs theme={theme} compact={compact} kinds={kinds} shown={shown} onChoose={choose} /> : null}
            </View>
            {extra ? <SubagentsSwitch theme={theme} compact={compact} extra={extra} on={subagentsShown} onToggle={toggleSubagents} /> : null}
          </View>
        ) : null}
        {rows.length ? null : <Text style={styles.line}>No links in this chat yet</Text>}
        {rows.map((link) => (
          <LinkRow
            key={link.key}
            theme={theme}
            compact={compact}
            link={link}
            now={now}
            copied={copied === link.key}
            onPress={press}
            onOpen={open}
            foldKey={`${agentId}|${link.key}`}
          />
        ))}
      </View>
    );
  };
}

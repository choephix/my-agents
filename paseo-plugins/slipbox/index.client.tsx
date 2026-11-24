import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CaptureSlipScreen } from "./client/capture-screen";
import { SlipboxSettingsScreen } from "./client/settings";
import { SlipFilePanel } from "./client/slip-panel";
import { createSlipCreatedRenderer } from "./client/timeline-row";
import { slipAttachmentSource } from "./shared/attachments";
import { parseSlipCommandInput } from "./shared/frontmatter";
import {
  createSlipRpc,
  SLIP_CREATED_TIMELINE_KIND,
  slipCreatedTimelineSchema,
} from "./shared/panel";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addAttachmentSource(slipAttachmentSource),
    client.addFilePanel({
      id: "slip",
      title: "Slip",
      icon: "StickyNote",
      files: { extensions: ["md", "markdown"] },
      Component: SlipFilePanel,
    }),
    client.addScreen({
      id: "capture",
      title: "New slip",
      Component: CaptureSlipScreen,
    }),
    client.addTimelineRenderer({
      kind: SLIP_CREATED_TIMELINE_KIND,
      version: 1,
      schema: slipCreatedTimelineSchema,
      Component: createSlipCreatedRenderer(client),
    }),
    client.addSlashCommand({
      name: "slip",
      description: "Save a quick note to the slip-box (or open the editor when empty)",
      argumentHint: "[kind:] <title or note>",
      context: "agent",
      async onSubmit({ args, agent, workspace, rpc, openScreen }) {
        const parsed = parseSlipCommandInput(args);
        if (!parsed) {
          openScreen({
            screenId: "capture",
            params: {
              ...(workspace.directory ? { about: workspace.directory } : {}),
              agentId: agent.id,
            },
          });
          return;
        }
        await rpc(createSlipRpc, {
          title: parsed.title,
          body: parsed.body || undefined,
          kind: parsed.kind,
          about: workspace.directory || undefined,
          from: `session:${agent.id}`,
          agentId: agent.id,
        });
      },
    }),
    client.addCommandCenterItem({
      id: "new-slip",
      title: "New slip",
      icon: "FilePlus2",
      keywords: ["slip", "slipbox", "memo", "note", "capture"],
      context: "workspace",
      onSelect({ workspace, openScreen }) {
        openScreen({
          screenId: "capture",
          params: workspace.directory ? { about: workspace.directory } : {},
        });
      },
    }),
    client.addSettingsScreen({
      id: "settings",
      title: "Slip-box",
      icon: "StickyNote",
      Component: SlipboxSettingsScreen,
    }),
  ];

  return () => {
    for (const remove of cleanups) remove();
  };
}

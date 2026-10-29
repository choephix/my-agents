import type { PluginServerContext } from "@getpaseo/plugin/server";
import { dataDir } from "./server/memos";
import { externalHandler } from "./server/external";
import { listHandler } from "./server/list";
import { markKeys, openMarks } from "./server/marks";
import { reopenHandler } from "./server/reopen";
import {
  listExternalSessions,
  listMarks,
  listPastSessions,
  reopenPastSession,
  setMark,
  starAndArchive,
} from "./shared/rpc";
import { viewSettings } from "./shared/view";

export default function contribute(server: PluginServerContext) {
  const marks = openMarks(dataDir());
  server.registerSettings(viewSettings);
  server.handle(listPastSessions, listHandler);
  server.handle(listExternalSessions, externalHandler);
  server.handle(reopenPastSession, (input, { paseo }) => reopenHandler(input, marks, paseo));
  server.handle(listMarks, () => markKeys(marks));
  server.handle(setMark, async ({ key, mark, on }) => {
    await marks[mark].set(key, on);
    return markKeys(marks);
  });
  server.handle(starAndArchive, async ({ agentId }, { paseo }) => {
    await marks.starred.set(`paseo:${agentId}`, true);
    await paseo.agents.ref(agentId).archive();
    return markKeys(marks);
  });
  return () => {};
}

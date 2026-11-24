import {
  defineAttachmentSource,
  defineRpc,
  PluginAttachmentSearchPayloadSchema,
} from "@getpaseo/plugin";
import { z } from "zod";

export const searchSlipsRpc = defineRpc({
  name: "slips.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const slipAttachmentSource = defineAttachmentSource({
  id: "slips",
  title: "Slip",
  icon: "StickyNote",
  pickerTitle: "Attach slip",
  searchPlaceholder: "Search slips by title, name, kind, or text",
  search: searchSlipsRpc,
});

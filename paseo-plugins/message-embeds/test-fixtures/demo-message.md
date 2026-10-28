Here is the parser implementation from the plugin: ![[paseo-plugins/message-embeds/client/parse.ts#L1-24]]

This long file has enough content to exercise the expanded card: ![[paseo-plugins/message-embeds/package-lock.json]]

This one should show a muted error: ![[paseo-plugins/message-embeds/does-not-exist.ts]]

```diff
--- a/client/parse.ts
+++ b/client/parse.ts
@@ -1,3 +1,3 @@
-export const oldParser = true;
+export const newParser = true;
```

```text
The literal embed in this fenced block must stay text: ![[ignored.ts]]
```

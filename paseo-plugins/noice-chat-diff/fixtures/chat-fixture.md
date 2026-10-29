Fixture for noice-chat-diff. Plain prose with `inline code` and **bold** stays native.

1. A labeled diff with file headers (TypeScript):

```diff
--- a/src/lib/greet.ts
+++ b/src/lib/greet.ts
@@ -1,7 +1,8 @@ export function greet
 import { log } from "./log";
 
-export function greet(name: string) {
-  return "Hello " + name; // old
+export function greet(name: string, excited = false): string {
+  const suffix = excited ? "!" : ".";
+  return `Hello ${name}${suffix}`; // new
 }
 
 const MAX_RETRIES = 3;
```

2. A labeled mock diff without headers:

```diff
- const useMockData = process.env.USE_MODEL_MOCK_DATA === "true" || !isProduction;
+ const useMockData = process.env.USE_MODEL_MOCK_DATA === "true";
```

3. An unlabeled diff with a hunk header (Python):

```
diff --git a/tools/run.py b/tools/run.py
--- a/tools/run.py
+++ b/tools/run.py
@@ -10,4 +10,5 @@ def main():
     args = parse()
-    if args.verbose == True:
+    # verbose flag is a bool
+    if args.verbose:
         print("running", len(args.items))
```

4. An unlabeled +/- block:

```
-    ...baseConfig.transform,
     "^.+\\.rbxmx$": transformer,
+    "^.+\\.md$": markdownTransformer,
```

5. Two files, two hunks, a long line and a missing final newline:

```diff
diff --git a/config/app.yaml b/config/app.yaml
index 3f2a1c0..9b8e7d4 100644
--- a/config/app.yaml
+++ b/config/app.yaml
@@ -3,6 +3,6 @@ server:
   host: 0.0.0.0
-  port: 8080
+  port: 9090
   timeout: 30 # seconds
@@ -21,3 +21,4 @@ logging:
   level: info
+  format: json
-  destination: /var/log/app/application-server-with-a-rather-long-name.log # rotated nightly by logrotate
+  destination: /var/log/app/application-server-with-a-rather-long-name.log # rotated hourly by logrotate, kept 7 days
\ No newline at end of file
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,2 +1,2 @@
-# My App
+# My App (v2)
 Run `npm start` to begin.
```

6. Normal code blocks must stay as they are:

```ts
const total = items.reduce((sum, item) => sum + item.price, 0);
```

```
-skills   [invoked skill: dry-dev]           + your prompt
default   [invoked skill: dry-dev — trimmed] + your prompt
```

- A normal list item
- Another one

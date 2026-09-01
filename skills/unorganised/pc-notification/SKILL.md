---
name: pc-notification
description: Push a notification to Stefan's computers via ntfy.sh. Use ONLY when the user explicitly asks for a PC / Windows / desktop notification — NEVER on your own initiative.
---

The ntfy topic URL is a secret and lives outside the repo. Read it from `/home/cx/workspace/my-agents/.agents-local/pc-notifications.md`, then, once the task is complete, fire the notification as the last action of the turn:

```sh
curl -s -X POST <URL-from-doc> \
  -H "Title: Done" \
  -d "Brief summary"
```

Replace `Title` with what finished and the body with a one-line summary of the outcome. Keep both short — this lands as an OS toast. Optional extras: `-H "Priority: high"` for urgent, `-H "Tags: white_check_mark"` for an emoji prefix. On failure, say so in chat; never retry silently.

Formatting: add `-H "Markdown: yes"` only for basic markdown — bold, italic, links, plain lists. NEVER use code fences or tables: tables render as raw characters, fences render but look bad in a toast. Body over ~4 KB silently becomes a text-file attachment instead of toast text — keep it well under.

To send an image (screenshot, generated art), upload the file directly — no public URL needed; ntfy hosts it for ~3h (15 MB max):

```sh
curl -s -T image.png <URL-from-doc> \
  -H "Filename: image.png" \
  -H "Title: Done" \
  -H "Message: Brief summary"
```

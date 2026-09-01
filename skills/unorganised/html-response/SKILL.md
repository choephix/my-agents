---
name: html-response
description: Publish a response as a styled HTML page on Postplan. Use when the user explicitly asks for an HTML-formatted response or an HTML page of your answer.
---

Write the response as a standalone HTML file, publish it with Postplan, and give the user the URL. The published page IS the deliverable; keep the chat reply to a one-line summary plus the link.

## Steps

1. Write a complete, self-contained HTML file (inline `<style>`, no external assets, `<meta charset>` + viewport, readable typography — e.g. `max-width: 42rem; margin: auto; font: 16px/1.6 system-ui`). Done when the file renders the full response on its own.
2. Publish: `npx -y postplan upload ./<file>.html`. Done when the CLI prints `URL: https://<draft-id>.postplan.dev`.
3. Reply with that URL, clickable, and a one-line description of what's on the page.

## Reference

- Re-uploading the same file path **updates the same draft** — same URL, version bump. Iterate on revisions this way; pass `--new` only when the user wants a separate page.
- `--draft <draft-id>` targets a specific existing draft; `--description <text>` sets a short draft description.
- Raw HTML is served at `https://postplan.dev/d/<draft-id>/raw`.
- Uploads are anonymous; no auth needed.

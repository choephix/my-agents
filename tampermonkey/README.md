# Tampermonkey

Install [Tampermonkey](https://www.tampermonkey.net/), then open a link. The extension catches a `.user.js` address and offers to install. It updates later only if `@version` in that file is higher.

On Chrome, enable [Allow user scripts](https://www.tampermonkey.net/faq.php?locale=en&q=Q209) or the script will not run. A GitHub file page does not install. If the link only downloads, paste it into Dashboard → Utilities → Import from URL.

- [Discord Thread → Markdown](https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/discord-thread-markdown.user.js) — channel or thread as markdown, with permalinks and attachment URLs. Alt+Shift+C copies the view or the selection. Alt+Shift+X, then a click, copies from that message down (max 100).
- [Gmail Attachment Harvester](https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/gmail-attachment-harvester.user.js) — attachments in the current results, renamed `Sender - filename`, into a folder you pick. Chromium only.
- [Full Page Shot](https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/full-page-shot.user.js) — any element or the whole page, top to bottom, as one PNG. Alt+Shift+P picks an element the way DevTools does: hover, ↑ for the parent, ↓ back, click to capture. Press Alt+Shift+P again for the whole page. The Tampermonkey menu also has clipboard options. A scrolling pane (chat, mail) is unrolled to its full length. Pages past the browser's canvas limit (about 32,000 px tall) come out shrunk to fit. Allow the modern-screenshot `@require`, and "always allow" when it asks to fetch images from other domains.
- [X Tweet Shot](https://raw.githubusercontent.com/choephix/my-agents/main/tampermonkey/x-tweet-shot.user.js) — one PNG of a tweet and its own replies, permalinks in the footer, on the clipboard. Alt+Shift+S, or the corner triangle. Allow the html2canvas `@require`.

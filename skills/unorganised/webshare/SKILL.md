---
name: webshare
description: Put generated images, HTML, and markdown where Stefan can open them in a browser.
disable-model-invocation: true
---

`~/tmp/public/` is served at `http://100.97.226.110:8080/`.

1. Save images to `~/tmp/public/images/`. Save HTML and markdown to `~/tmp/public/pages/`.
2. Use an absolute path. Tools such as `agy` send relative paths to a scratch directory.
3. Reply with the URL: `http://100.97.226.110:8080/images/<name>.png`. Give the file path only on request.

If a page does not load, restart the server: `systemctl --user restart webshare`.

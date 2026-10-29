Here's a mock of the session cleanup screen:

```svg
<svg viewBox="0 0 900 420" font-family="sans-serif">
  <style>.label { font-size: 15px; fill: var(--fg); } .muted { font-size: 13px; fill: var(--muted, #888); }</style>
  <text x="24" y="36" font-size="20" font-weight="bold" fill="var(--fg)">Close idle sessions</text>
  <text x="24" y="60" class="muted">7 sessions idle for more than 2 days</text>
  <rect x="24" y="84" width="852" height="64" rx="10" fill="none" stroke="var(--accent)" stroke-width="2"/>
  <circle cx="52" cy="116" r="7" fill="var(--success)"/>
  <text x="72" y="121" class="label">message-embeds review</text>
  <text x="760" y="121" class="muted">keep</text>
  <rect x="24" y="160" width="852" height="64" rx="10" fill="none" stroke="var(--border)"/>
  <circle cx="52" cy="192" r="7" fill="var(--warning)"/>
  <text x="72" y="197" class="label">lockfile bump</text>
  <text x="760" y="197" class="muted">close?</text>
  <rect x="24" y="236" width="852" height="64" rx="10" fill="none" stroke="var(--border)"/>
  <circle cx="52" cy="268" r="7" fill="var(--error)"/>
  <text x="72" y="273" class="label">crashed runner</text>
  <text x="760" y="273" fill="var(--error)" font-size="13">close</text>
  <rect x="24" y="330" width="180" height="44" rx="8" fill="var(--accent)"/>
  <text x="114" y="358" text-anchor="middle" font-size="15" fill="var(--accent-fg, #000)">Close 2 sessions</text>
  <text x="230" y="358" fill="var(--brand-unknown)" font-size="13">unknown variable falls back to the text colour</text>
</svg>
```

And a broken one, which should stay code with a note:

```svg
<svg viewBox="0 0 100 40"><text x="4" y="24">unclosed
```

Inline `<svg>` stays inline code, and this one stays a normal code block:

```xml
<svg viewBox="0 0 1 1"/>
```

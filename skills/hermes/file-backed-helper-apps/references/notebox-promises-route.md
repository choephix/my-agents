# Notebox promises route pattern

Session pattern from Rhinox Console `/notebox-promises`.

## Data source

- Root: an explicit Markdown directory, e.g. `/mnt/obsidian-vault/Notebox/Atoms`.
- Candidate notes can be detected from filename markers, frontmatter fields, or body hashtags.
- Treat missing status as `open` when the user defines that convention.
- Group by normalized status in the UI; fade non-open groups instead of overusing status pills.

## Title/body handling

Preferred display order for this class of note dashboard:

1. Leading Markdown H1 in the body (`# Title`).
2. Frontmatter `title:`.
3. Filename/stem fallback only if no human title exists.

When the H1 becomes the card title, strip it from the displayed body preview so the title does not repeat.

## Paths and filenames

Stefan strongly disliked visible filenames returning after asking for them to be hidden. For work dashboards, do not display file paths or filenames by default once a human title exists. Put the full vault/source path in a tooltip on the title if useful for debugging.

## Preview and tags

- Do not character-truncate excerpts in the data layer; let CSS `line-clamp`/ellipsis do visual clipping.
- Two lines can be too little for work notes; four-line clamp was preferred here.
- Merge and dedupe frontmatter tags plus body hashtags.
- Render tags as small bottom chips.
- Avoid noisy pills like `kind: promise` or `status: open` when every item has that meaning.

## Write action pattern

For marking a Markdown-backed item closed:

- Use a separate form/button area, not a button nested inside the item link.
- Button style: ghost by default; subtle background on parent item hover; stronger background on direct hover.
- Server action validates the target path stays under the configured root.
- Update frontmatter by replacing existing `status:` or adding `status: closed`; create frontmatter if missing.
- Revalidate the route after writing.

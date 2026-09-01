---
name: youtube-to-obsidian
description: Scrape transcripts from a YouTube channel into the Obsidian vault. Trigger when I ask to scrape/rip/save a YouTube channel's transcripts, optionally filtered by length, date, title, format, or anything else.
---

# YouTube channel transcripts → Obsidian

Goal: download English subtitles + metadata for a channel with yt-dlp, then convert to markdown with `~/downloads/vtt_to_md.py`.

## Workflow

1. Identify the channel handle (e.g. `@cortexFM`) from the URL. If I gave a `/videos` URL use it; otherwise append `/videos`. If the handle isn't obvious from the URL, web-search to confirm it.
2. Run yt-dlp from `~/downloads`, writing into `./<@handle>/`:

```
yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs en --sub-format vtt \
  --write-info-json --sleep-requests 1 --ignore-errors \
  --remote-components ejs:github \
  --download-archive ./<@handle>/archive.txt \
  -o "./<@handle>/%(id)s.%(ext)s" \
  "<channel-videos-url>"
```

3. Convert: `python3 vtt_to_md.py ./<@handle>`
   - Verify the markdown count against transcript count. `vtt_to_md.py` names files as `<date> - <title>.md`, so duplicate same-day titles can overwrite each other. If `*.en*.vtt` count is greater than output `*.md` count after excluding known no-transcript items, identify duplicate generated filenames and manually write the collided item(s) with a ` [<video_id>]` suffix in the markdown filename.
4. Update the Obsidian Bases index so the new channel appears automatically:
   - Target file: `/mnt/obsidian-vault/Notebox/Indices/Youtube Transcripts.base`
   - Read the file first and check whether it already contains `file.inFolder("Rips/Youtube/<@handle>")`.
   - If missing, append a cards view under `views:` using the channel's human display name from yt-dlp playlist/channel metadata when available; otherwise derive a title from the handle.
   - Default view template:

```yaml
  - type: cards
    name: <Human Channel Name>
    filters:
      and:
        - file.inFolder("Rips/Youtube/<@handle>")
    order:
      - title
    sort:
      - property: upload_date
        direction: DESC
    image: note.thumbnail
    imageAspectRatio: 0.55
    cardSize: 300
```

   - Preserve existing views and style. If a nearby channel view uses different `cardSize` or `imageAspectRatio` for an obvious reason, match the closest existing style; otherwise use the default above.
   - Verify by reading the `.base` file back and confirming the new `file.inFolder(...)` filter exists.

## Required invariants — do not change these

- `-o` template must be `%(id)s.%(ext)s` and the `--download-archive` path must stay stable per channel, or resume breaks and `vtt_to_md.py` can't pair files.
- Keep `--remote-components ejs:github` (needed to solve YouTube's n-challenge for this account; deno is installed).
- `vtt_to_md.py` defaults output to `/mnt/obsidian-vault/Rips/Youtube/<@handle>/`. Vault is the default — only pass `--out` if I ask for somewhere else.

## Filters — translate my request into yt-dlp flags

- Length: `--match-filter "duration > 1800"` (seconds; 1800 = 30 min).
- Date: `--dateafter`/`--datebefore`, `YYYYMMDD` or relative like `"today-2years"`.
- Title: `--match-filter "title ~= '<regex>'"` (escape literal dots; anchor with `^`).
- Format/other: `--match-filter` accepts any info-json field; combine conditions with `&`.
- This list isn't exhaustive — for anything else, find the right yt-dlp flag rather than refusing.
- Before a large or ambiguously-filtered run, offer a preview: same command with `--match-filter ... --print "%(duration_string)s  %(upload_date)s  %(title)s"` and no download.

## vtt_to_md.py options

`--gap-seconds N` (separator threshold, default 3), `--vault-root PATH`, `--out PATH`, `--lang CODE`, `--keep-no-subs`.

## Resuming

Re-run the identical yt-dlp command; the archive skips finished videos. Stopping mid-video is safe (that one re-fetches). Don't change `-o` or the archive path between runs.

---

## Whisper fallback — only when asked for it

Some videos have no captions (common for older uploads). To fill those gaps with machine transcripts, use `~/downloads/diagnose_missing.py` and `~/downloads/whisper_transcribe.py` after the normal scrape. Both scripts assume yt-dlp already ran (they read the `.info.json` files).

1. Find which videos lack a transcript and why:

```
python3 diagnose_missing.py ./<@handle>
```

It classifies each gap (no captions at all / other-language only / recoverable) and prints a retry loop for any that were just interrupted downloads. Only proceed to Whisper for the genuinely caption-less ones.

2. Download audio for the missing videos (reads missing IDs from the folder, skips the `UC...` channel-container entry):

```
cd ./<@handle> && for j in *.info.json; do id="${j%.info.json}"; case "$id" in UC*) continue;; esac; ls "$id".en*.vtt >/dev/null 2>&1 || echo "$id"; done | yt-dlp -x --audio-format mp3 --audio-quality 0 --remote-components ejs:github -o "audio/%(id)s.%(ext)s" --batch-file - ; cd ..
```

3. Transcribe (writes `<id>.en.vtt` into the channel folder so `vtt_to_md.py` picks them up):

```
python3 whisper_transcribe.py ./<@handle> --model small.en
```

`small.en` is the CPU default; `--model medium.en --device cuda` if a GPU is available. Requires `pipx install openai-whisper` once.

4. Re-run `python3 vtt_to_md.py ./<@handle>` to regenerate markdown including the new transcripts.

Note: Whisper output has real punctuation/capitalization, so those episodes read differently from the lowercase auto-caption ones. Expect occasional misheard names/jargon.

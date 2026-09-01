# OMP JSON Output Extraction

Use this when launching `omp --mode json` for adversarial reviews and you need the session id plus the actual assistant answer.

## Why

OMP JSONL contains many event shapes. `agent_end.messages` may include the original user prompt, and naive “largest/last string” extraction can accidentally return the prompt instead of the assistant answer.

## Preferred extraction

Read JSONL line-by-line and prefer:

1. `assistantMessageEvent.type == "text_end"` → `assistantMessageEvent.content`
2. fallback: final `message_end` / `turn_end` assistant message text parts only (`content[].type == "text"`), excluding thinking blocks
3. collect session ids by walking string fields that look like OMP ids when no explicit `session_id` key is present

Compact parser:

```python
import json, pathlib

p = pathlib.Path("/tmp/omp-session.jsonl")
texts = []
ids = []

for line in p.read_text(errors="replace").splitlines():
    try:
        obj = json.loads(line)
    except Exception:
        continue

    def walk(x):
        if isinstance(x, dict):
            for v in x.values():
                if isinstance(v, str) and v.startswith("019") and v not in ids:
                    ids.append(v)
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(obj)

    ame = obj.get("assistantMessageEvent") if isinstance(obj, dict) else None
    if isinstance(ame, dict) and ame.get("type") == "text_end":
        texts.append(ame.get("content", ""))

    if obj.get("type") in {"message_end", "turn_end"} and isinstance(obj.get("message"), dict):
        parts = obj["message"].get("content", [])
        text = "".join(
            part.get("text", "")
            for part in parts
            if isinstance(part, dict) and part.get("type") == "text"
        )
        if text:
            texts.append(text)

print("session_id:", ids[0] if ids else "")
print(texts[-1] if texts else "")
```

## Pitfall

Do not treat `thinking` blocks as answer content. Do not pass artificial `<file name=...>` wrappers into OMP prompts unless the wrapper itself is intended model context.

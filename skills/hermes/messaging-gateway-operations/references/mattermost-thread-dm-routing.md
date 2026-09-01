# Mattermost Thread Mode vs DM Routing

Session-derived diagnostic note for the Mattermost gateway adapter.

## Symptom

With `MATTERMOST_REPLY_MODE=thread`, channel threads can work correctly while direct-message conversations become confusing: replies may be visually nested under individual DM messages, but Hermes still has a single flat DM session because inbound DMs have `thread_id=None`.

This is not evidence that Mattermost channel threads are broken. It is a chat-type mismatch caused by using one global reply-mode setting for both channel/group conversations and DM channels.

## Code locations observed

Adapter source:

```text
~/.hermes/hermes-agent/plugins/platforms/mattermost/adapter.py
```

Relevant behavior:

```py
# Incoming event handling
thread_id = post.get("root_id") or None
if (
    not thread_id
    and self._reply_mode == "thread"
    and channel_type_raw != "D"
    and post_id
):
    thread_id = post_id
```

So top-level channel/group posts can become thread roots, but top-level DMs do not.

Send path:

```py
resolved_root = await self._thread_root_for_send(reply_to, metadata)
if resolved_root:
    payload["root_id"] = resolved_root
```

`_thread_root_for_send()` only checks global `self._reply_mode`, `reply_to`, and metadata. If the caller passes a DM message ID as `reply_to`, global thread mode can still set a `root_id` for a DM send unless the adapter has been fixed to account for chat type.

Gateway routing helper:

```py
def _thread_metadata_for_source(source, reply_to_message_id=None):
    return _thread_metadata_for_target(
        source.platform,
        source.chat_id,
        source.thread_id,
        chat_type=source.chat_type,
        reply_to_message_id=reply_to_message_id or source.message_id,
    )
```

For a DM source with `thread_id=None`, metadata is `None`, but streaming/final sends can still pass the incoming `event_message_id` as `reply_to`.

## Correct interpretation

- Channel/group Mattermost threads: expected to work when `MATTERMOST_REPLY_MODE=thread`.
- Mattermost DMs: thread mode is a poor fit unless explicitly supported with separate semantics.
- The global setting means users cannot currently choose “channel threads on, DM threads off” unless the adapter/config has been patched.
- After a DM-flat adapter patch, old DM transcript context may remain under pre-existing thread-scoped session keys. This is a migration/session-index issue, not model memory failure.

## Session-key amnesia diagnostic

When a user reports that every Mattermost DM seems to begin a fresh Hermes conversation without `/new`, inspect session routing first.

Look for multiple keys in `~/.hermes/sessions/sessions.json` that share the same DM channel ID but differ by a trailing post/root ID:

```text
agent:main:mattermost:dm:<dm_channel_id>
agent:main:mattermost:dm:<dm_channel_id>:<root_post_id_a>
agent:main:mattermost:dm:<dm_channel_id>:<root_post_id_b>
```

Meaning:

- `agent:main:mattermost:dm:<dm_channel_id>` is the intended flat DM key.
- `agent:main:mattermost:dm:<dm_channel_id>:<root_post_id>` means Mattermost `root_id`/thread identity influenced Hermes session routing.
- If an adapter patch changes future DMs to the flat key, earlier turns under `:<root_post_id>` keys do not automatically migrate into the flat transcript. The user may experience this as “amnesia” because the current message is routed to a different persisted session than the previous threaded DM message.

Useful confirmation paths:

```bash
# Inspect persistent routing keys without exposing tokens.
python3 - <<'PY'
import json, pathlib
p = pathlib.Path('~/.hermes/sessions/sessions.json').expanduser()
data = json.loads(p.read_text())
for key, value in data.items():
    if key.startswith('agent:main:mattermost:dm:'):
        origin = value.get('origin', {})
        print(key, '=>', value.get('session_id'), 'thread=', origin.get('thread_id'))
PY
```

Also check `~/.hermes/state.db` recent Mattermost sessions when you need to tell which transcript holds the prior context.

Operational pitfall: editing `plugins/platforms/mattermost/adapter.py` does not affect a running gateway until the live process restarts. Verify service/manual-process status and process start time before concluding the patch is active.

## Preferred fix shape

Patch the existing adapter, do not create a new adapter.

Durable behavior should be one of:

```yaml
mattermost:
  reply_mode: thread
  thread_dms: false
```

or env-backed:

```env
MATTERMOST_REPLY_MODE=thread
MATTERMOST_THREAD_DMS=false
```

Adapter behavior:

```py
if channel_type_raw == "D" and not thread_dms:
    thread_id = None
    # and do not set root_id on outbound DM sends
else:
    # current channel/group thread behavior
```

If only a minimal local hotfix is needed, skip `root_id` / thread-root resolution for DM sends while preserving channel/group thread mode.

## Update safety for local adapter patches

Hermes source installs are git checkouts. Local edits under `~/.hermes/hermes-agent/` show in `git status`.

`hermes update` behavior observed in source:

1. Creates a pre-update backup/snapshot.
2. Stashes local source changes.
3. Fetches/pulls or resets to origin if needed.
4. Attempts to restore the stash.
5. If restore conflicts, leaves the stash preserved and resets the working tree clean so Hermes remains runnable.

Therefore local adapter patches are not silently scrubbed, but they can create update conflicts or be left in a stash. For durable behavior, upstream the fix or carry a deliberate local branch/fork.

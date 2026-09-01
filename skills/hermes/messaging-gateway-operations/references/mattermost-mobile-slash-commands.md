# Mattermost mobile slash-command interception

## Symptom

On Mattermost desktop/web, a user may be able to send Hermes commands such as `/approve`, `/deny`, `/restart`, `/new`, or `/status` as chat messages. On Mattermost mobile, the client intercepts any message beginning with `/` and attempts to execute a native Mattermost slash command first.

Typical mobile error:

```text
Error Executing Command
Command with a trigger of '<command>' not found. To send a message beginning with "/", try adding an empty space at the beginning of the message.
```

If the user follows Mattermost's suggestion and sends ` /approve`, Hermes may treat it as ordinary text because gateway command parsing is usually strict about `text.startswith("/")`.

## Quick reproduction/probe

A strict `MessageEvent` behaves like this:

```text
'/approve'  -> command=approve
' /approve' -> command=None, plain text
'\t/approve' -> command=None, plain text
```

In the Mattermost adapter, look for intake code shaped like:

```python
message_text = post.get("message", "")
if message_text.startswith("/"):
    msg_type = MessageType.COMMAND
```

That misses Mattermost's mobile workaround.

## Low-risk adapter fix

Normalize only command-shaped leading-space messages in the Mattermost adapter before classification and before constructing `MessageEvent`:

```python
stripped_message_text = message_text.lstrip()
if stripped_message_text.startswith("/"):
    message_text = stripped_message_text
```

Important: do not blanket-strip all Mattermost messages. Preserve leading whitespace for ordinary text.

Regression tests should cover:

- DM/channel post with `" /approve"` or `" /stop"` becomes `"/approve"` / `"/stop"` and `MessageType.COMMAND`.
- A non-command message like `"  hello"` remains exactly `"  hello"` and `MessageType.TEXT`.

## Better UX option

Add a Mattermost `!command` alias similar to Slack and Matrix:

```text
!approve -> /approve
!deny    -> /deny
!restart -> /restart
```

Only rewrite `!<known Hermes command>` so messages such as `!nice work` stay ordinary text. If implemented, set the adapter capability:

```python
typed_command_prefix = "!"
```

This makes Hermes prompts say `!approve` / `!deny`, which works on mobile without relying on the visually invisible leading-space workaround.

## Native Mattermost slash-command registration

A fuller product solution is to register Hermes gateway commands as Mattermost custom slash commands using the Mattermost REST API (`POST /api/v4/commands`, list/delete for idempotency). This can provide autocomplete and native mobile handling, but it is much higher surface area:

- integrations must be enabled and permitted for the bot/operator;
- Hermes needs an HTTP endpoint Mattermost can call;
- registration is team-specific and must be idempotent;
- request tokens must be validated;
- triggers can conflict with built-in Mattermost commands;
- slash-command invocations are not normal posts, so session/thread routing must be designed deliberately.

For immediate operations, prefer the adapter normalization and/or `!command` alias first.

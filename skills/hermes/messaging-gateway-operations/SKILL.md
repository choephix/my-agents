---
name: messaging-gateway-operations
description: "Use when configuring or troubleshooting Hermes messaging gateway behavior across chat platforms: bot connectivity, group/DM routing, mention gates, topics/threads, home channels, and platform-specific delivery verification."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [hermes, gateway, messaging, telegram, mattermost, routing, topics]
    related_skills: [hermes-agent]
---

# Messaging Gateway Operations

## Overview

Use this skill for operational work on Hermes as a messaging bot: verifying that the gateway is running, changing platform behavior in `~/.hermes/config.yaml` or `.env`, restarting the service, proving the bot is connected, and explaining platform routing semantics to the user.

This is a supplement to the protected `hermes-agent` skill. Load `hermes-agent` first for authoritative CLI/config references, then use this skill for the practical messaging-gateway workflow and pitfalls captured from real sessions.

## When to Use

- A messaging platform bot is silent or only responds in some places.
- The user wants group/channel responses without explicit mentions.
- The user asks about Telegram groups, forum topics, private DM topic mode, or thread routing.
- You need to verify that a gateway config change took effect after restart.
- You need to map a platform chat/thread ID from logs or API output into Hermes delivery/config syntax.

Do not use this for model/provider setup unless it directly affects gateway operation; use `hermes-agent` for general Hermes setup.

## Core Workflow

1. Confirm gateway state before changing behavior:
   - `hermes gateway status`
   - inspect recent `~/.hermes/logs/gateway.log` for platform connection lines.

2. Inspect configuration without leaking secrets:
   - Use `hermes config` / `hermes config set` for non-secret config.
   - Read `.env` only to confirm whether keys exist; never reproduce token values.

3. Identify the platform gate:
   - service stopped vs connected
   - platform auth failure vs WebSocket/polling connected
   - allowlist restriction
   - mention requirement / privacy mode
   - platform-native limitation, such as Telegram bots not creating groups
   - thread/topic mismatch

4. Apply the smallest config change and restart the gateway:
   - `hermes config set <section.key> <value>` for YAML settings.
   - `hermes gateway restart` for service-backed gateway.
   - If service is not installed, use `hermes gateway install` or foreground `hermes gateway run` only as a diagnostic.

5. Verify with real output:
   - service active/running
   - platform connected/authenticated
   - relevant log line after restart
   - config value now reads as expected

6. Explain the user-visible behavior in platform terms, not just config terms.

## Session Reset Policy Semantics

When explaining or changing gateway conversation-history resets, inspect both config and implementation semantics before answering. `session_reset.mode` controls which fields are active:

- `idle`: only `idle_minutes` matters; `at_hour` may still appear as a default/inert field but does **not** trigger a 4am reset.
- `daily`: `at_hour` matters; idle timeout is inactive.
- `both`: whichever trigger fires first: daily boundary or idle timeout.
- `none`: no automatic reset; context is managed by compression/manual reset.

If the user asks whether an inert-looking field is “necessary,” answer in behavior terms first: e.g. `mode: idle` + `idle_minutes: 2400` means reset after 40 hours of inactivity, not at 4am. Offer to remove inert fields only for clarity; do not imply they change runtime behavior.

## Mattermost Mobile Slash Command Interception

Mattermost mobile (Android/iOS) intercepts any message that starts with `/` and tries to run it as a native Mattermost slash command before Hermes sees it. The client error usually says `Command with a trigger of '<name>' not found` and suggests adding a leading space. That workaround only helps if the Mattermost adapter normalizes command-shaped leading-space messages before gateway dispatch.

When diagnosing `/approve`, `/deny`, `/restart`, `/new`, `/status`, or similar commands failing only on Mattermost mobile:

1. Confirm whether Mattermost blocked the message client-side (the message never appears in chat) versus Hermes receiving it as normal text.
2. Inspect the Mattermost adapter intake path for strict `message_text.startswith("/")` / `MessageEvent.text.startswith("/")` handling.
3. Preferred low-risk fix: in the Mattermost adapter only, strip leading whitespace **only when** the first non-whitespace character is `/`, then classify as `MessageType.COMMAND`. Preserve leading whitespace for ordinary text.
4. Add regression tests for both `" /approve" -> "/approve" + COMMAND` and `"  hello"` staying TEXT with whitespace preserved.
5. Better UX follow-up: consider a Mattermost `!command` alias, matching Slack/Matrix patterns, and set `typed_command_prefix = "!"` so prompts say `!approve` instead of an unusable mobile `/approve`. Only rewrite `!<known Hermes command>` so casual exclamations remain chat text.
6. Full native solution is Mattermost custom slash-command registration from the central command registry, but it is higher-surface-area: requires integrations permissions, an HTTP endpoint, token validation, team-specific idempotent registration, built-in trigger conflict handling, and careful routing/thread semantics.

See `references/mattermost-mobile-slash-commands.md` for the concise reproduction, local probe, and fix trade-offs.

## Mattermost Mention Gate Pattern

For Mattermost channel messages, `mattermost.require_mention: true` makes Hermes ignore non-DM messages unless the bot is mentioned. If the user wants normal channel prompts to trigger Hermes, set it false and restart:

```bash
hermes config set mattermost.require_mention false
hermes gateway restart
hermes gateway status
```

Verify the config afterward and check that Mattermost reconnects/authenticates in gateway logs. If `allowed_channels` is empty, there is no Hermes-side channel allowlist restriction.

## Mattermost Thread Reply Pattern

For Mattermost threaded replies, the durable switch is `MATTERMOST_REPLY_MODE=thread` in the Hermes env file. `config.yaml` covers gates such as `mattermost.require_mention`, but the adapter currently reads reply mode from the Mattermost env variable / platform extra. Inspect the value without leaking tokens, update it carefully, then restart the gateway from outside the running gateway process:

```bash
# inspect without printing secrets
ENV=$(hermes config env-path)
grep -E '^MATTERMOST_REPLY_MODE=' "$ENV" || true

# set to threaded replies
# Prefer a careful editor or small script; .env is protected because it contains credentials.
# Ensure the final line is exactly:
MATTERMOST_REPLY_MODE=thread

# must be run from a normal shell outside the gateway process, or by the user as /restart
hermes gateway restart
hermes gateway status
```

Important DM/channel split from the local Hermes Mattermost adapter: **DMs intentionally stay flat even when `MATTERMOST_REPLY_MODE=thread` is enabled.** Channel/group posts thread; DMs ignore `root_id` for session routing and send-side delivery refuses to set `root_id` for Mattermost `D` channels. If a Mattermost DM session shows `thread=None`, that is expected after the DM-flat patch, not evidence that channel thread routing broke. There is no live `MATTERMOST_THREAD_DMS` switch in the local adapter unless future code adds one.

If running commands from a Mattermost-originated Hermes session, `hermes gateway restart` may be refused to prevent restart loops. In that case ask the user to run `hermes gateway restart` in a server shell, or use the gateway `/restart` command if allowed in the chat.

Verification options:

1. User-visible: ask the user to post a top-level Mattermost channel message and confirm Hermes replies in a thread; then reply inside that thread and confirm Hermes stays there. Do not use DMs for this verification because DMs intentionally stay flat.
2. API-level: using the bot token locally, create a temporary channel root post with `POST /api/v4/posts`, create a reply with the root post's `root_id`, verify the reply's `root_id` matches, then delete both posts. Never print the token.

Mattermost delivery targets can use `mattermost:<channel_id>:<thread_id>` for proactive delivery into a specific channel thread. DM deliveries should normally remain `mattermost:<dm_channel_id>` flat.

### Diagnosing Mattermost DM “amnesia” after thread/flat changes

When the user says Mattermost DMs start a new conversation without `/new`, check the session key shape before blaming model memory. The bug class is usually `root_id` leaking into the Hermes session identity:

```text
agent:main:mattermost:dm:<dm_channel_id>:<root_post_id>
```

A healthy flat DM route is:

```text
agent:main:mattermost:dm:<dm_channel_id>
```

Practical checks:

1. Inspect `~/.hermes/sessions/sessions.json` for multiple `agent:main:mattermost:dm:<same_channel_id>:...` keys.
2. Inspect `~/.hermes/state.db` recent Mattermost sessions to see which transcript the current flat key maps to.
3. Remember that fixing the adapter does **not** migrate old thread-specific DM sessions. Context can look “lost” because prior turns are stranded under older `:<root_post_id>` keys while new messages route to the flat DM key.
4. Verify the live gateway process actually loaded the patch. Code on disk is not enough; compare process start time/service status and restart the gateway after adapter edits.
5. Explain the difference clearly: session-key split / migration issue, not the model forgetting.

See `references/mattermost-thread-dm-routing.md` for the session-key diagnostic details and reproduction shape.

### Propagating the Mattermost DM-flat patch to another Hermes install

When Stefan asks to update another machine's “mm plugin” or “Mattermost plugin the same way,” interpret it as the local Mattermost adapter patch, not only `.env`/config changes: DMs flat, channel/group threads preserved.

Workflow:

1. Use SSH/read-only discovery first: confirm the remote Hermes checkout, git status, current adapter behavior, and whether the gateway is service-managed or a manual process.
2. Prefer generating a patch from the known-good local Hermes checkout, then `scp` it and run `git apply --check` on the remote before applying.
3. Verify with the remote Hermes venv/interpreter, not system Python when possible:
   - `venv/bin/python -m py_compile plugins/platforms/mattermost/adapter.py tests/gateway/test_mattermost.py`
   - focused Mattermost tests if pytest is available or can be installed into the venv with user approval/low risk.
4. Restart only the remote gateway after verification. If it is a manual `gateway run --force --accept-hooks` process rather than a user service, treat killing/restarting it as an explicit side-effect and be clear about the exact command/PID.
5. Do not conclude `thread=None` is broken when inspecting DM sessions; for the patched behavior, flat DM routing is expected.

## Telegram Group and Topic Pattern

When diagnosing Mattermost thread-mode behavior, explicitly distinguish channel/group/private-channel posts from direct-message channels before recommending `MATTERMOST_REPLY_MODE=thread` as a blanket fix.

Current adapter semantics to verify before answering:

- `MATTERMOST_REPLY_MODE` is a single global setting (`thread` or `off`) unless the adapter has since gained per-chat-type config.
- In channel/group/private-channel posts, thread mode can promote a top-level post's own `post_id` into `thread_id`, so replies nest under the top-level channel message and Hermes can use thread-scoped routing/session keys.
- In Mattermost DMs (`channel_type_raw == "D"`), the adapter should not treat top-level DMs like channel thread roots. If a global thread mode causes DM replies to become visually nested while Hermes still has one flat DM session (`thread_id=None`), explain that DMs are compromised by channel-thread mode rather than calling all Mattermost threads broken.
- Preferred fix shape: patch the existing Mattermost adapter rather than building a new adapter. Keep channel/group thread behavior enabled, but skip `root_id` / thread-root resolution for DMs by default, or add an explicit config such as `thread_dms: false` / `MATTERMOST_THREAD_DMS=false`.
- Update safety: local edits under `~/.hermes/hermes-agent/plugins/platforms/mattermost/adapter.py` are git working-tree changes. `hermes update` stashes local changes, updates, then reapplies; conflicts are preserved in the stash and the working tree is reset clean to keep Hermes runnable. Prefer upstreaming the patch for durability.

See `references/mattermost-thread-dm-routing.md` for the session-specific diagnostic details and code locations.

## Telegram Group and Topic Pattern

Telegram has several distinct routing modes. Do not conflate them:

- Basic group: no forum topics; messages share one group session key unless Hermes/user routing adds another dimension.
- Supergroup/forum topics: Telegram provides `message_thread_id`; Hermes can isolate sessions per topic/thread.
- Private DM topic mode (`/topic`): a 1-on-1 bot DM feature for multiple independent sessions; it is not how to enable topics in a group.
- Config-driven private DM topics (`platforms.telegram.extra.dm_topics`): operator-declared DM workspaces, separate from user-driven `/topic`.

When the user says they are “in a Telegram group” and discussing topics:

1. Find/confirm the **current** group chat ID from the incoming message/session routing, gateway logs, or Bot API. Group IDs are negative; supergroups usually use `-100...` IDs.
   - Be careful after conversion: Hermes may retain both the old basic-group ID and the new supergroup ID with the same display name. Prefer the current inbound session/origin or the newest routing entry, not the first matching title.
2. Use `getChat`/`getChatMember` only if you have the bot token available locally; redact tokens in all output.
3. Check `getChat.result.type`:
   - `group` means ordinary group; forum topics are not active for the bot for that chat ID. If the user says topics are active, suspect you probed a stale pre-conversion ID and re-check the current `-100...` chat.
   - `supergroup` plus forum/topic fields means topic routing is available.
4. Check bot membership/admin status. For topic-heavy use, the bot should be admin and have `can_manage_topics` plus send-message permissions.
5. Tell the user to enable Telegram Topics/Forum mode in group settings, or upgrade/convert the group if the UI requires it. The bot cannot reliably do this for them.
6. Warn that converting a group to a supergroup can change the chat ID; re-check logs afterward.
7. Once topics are active, each thread gets isolated Hermes session context automatically. Add `extra.group_topics` only for per-topic skill binding or special handling.

See `references/telegram-topics-and-gateway-routing.md` for the detailed Telegram topic decision tree and sample config.

## Telegram Privacy and Visibility

If a Telegram bot in a group does not see normal messages, the usual causes are:

- BotFather privacy mode is still enabled.
- The bot is not an admin.
- Hermes `telegram.allowed_chats` excludes the group.
- `telegram.require_mention` or mention/wake-word settings intentionally gate responses.

For “respond to everything in groups,” the bot needs to receive ordinary group messages: disable privacy mode in BotFather and remove/re-add the bot to the group, or promote it to admin. Then check Hermes-side allowlists and mention settings.

## Telegram Cut-Off / Partial Delivery Pattern

When the user reports a Telegram reply cut off mid-sentence, distinguish model output from platform delivery before answering:

1. Check the persisted assistant message in the session DB/transcript. If it contains the full final text, the model did not stop early.
2. Check gateway logs around that turn for `response ready ... response=N chars`, normal `Sending response (N chars)`, and `Suppressing normal final send ... streamed=True ... content_delivered=True`.
3. If the full assistant response exists but normal final send was suppressed, suspect the streaming/final-delivery path marked content delivered too optimistically.
4. Check both global and per-platform streaming config. A per-platform override such as `display.platforms.telegram.streaming: true` can enable Telegram streaming even when `streaming.enabled: false`.
5. Safe mitigation: disable Telegram streaming or remove the per-platform override; code fix path is to make final-send suppression depend on a proven final delivery, not a partial preview.

## Delivery Target Syntax

Hermes delivery targets can include platform, chat ID, and thread ID:

```text
telegram:<chat_id>
telegram:<chat_id>:<thread_id>
mattermost:<chat_id>
mattermost:<chat_id>:<thread_id>
```

For Telegram forum topics, the `thread_id` is the topic/thread identifier. The General topic can have special handling; verify actual behavior in logs before hardcoding assumptions.

## Background Process Notification / Self-Followup Pattern

When the user reports that Hermes “started saying something,” then an `interrupted`/background-process notice appeared, or Hermes seemed to reply to itself in Mattermost:

1. Inspect the persisted session transcript and gateway logs around the turn.
2. Check for background process completion injections such as `Process proc_... finished — injecting agent notification...` immediately after a normal final response.
3. Check for session split/compression lines (`Session split detected ...`) and queued-followup lines (`final stream delivery not confirmed; sending first response before continuing`). The combination can make old process notifications look like new inbound messages.
4. Distinguish the real user-facing result from later synthetic process notices. Verify any referenced artifact/file still exists before reassuring the user.
5. If the notices came from killed/superseded background processes, explain that they were stale process-completion notifications, not new model reasoning or intentional subject change.
6. Do not treat the injected process notice as a new user request unless the user explicitly asks to continue from it.

This is especially relevant after long Mattermost turns with `terminal(background=true, notify_on_complete=true)`, OMP/agent runs, or context compression.

## Common Pitfalls

1. **Stopping after a config write.** Gateway config changes usually need `hermes gateway restart`; verify reconnection.

2. **Confusing Telegram `/topic` with group forum topics.** `/topic` is for private bot DMs. Group topics are enabled in Telegram group settings and arrive as `message_thread_id`.

3. **Assuming bots can create Telegram groups or invite users.** Telegram bots generally cannot initiate group creation or add arbitrary users. The human user creates the group and adds/promotes the bot.

4. **Forgetting BotFather privacy mode.** Hermes config can be open while Telegram still withholds ordinary group messages. Disable privacy or make the bot admin.

5. **Using a stale Telegram chat ID after conversion.** A converted group can leave multiple Hermes routing entries with the same display name. If `getChat` says `type: group` but the user is clearly posting in a forum-enabled group, you probably queried the old ID. Re-check the current inbound session/origin or newest `-100...` routing entry.

6. **Leaking tokens while probing Bot API.** Pull tokens from `.env` for API calls but never print them; scrub outputs.

## Verification Checklist

- [ ] Gateway service is active/running or foreground gateway is visibly connected.
- [ ] Target platform logs show connected/authenticated after the latest restart.
- [ ] The changed config key reads back as intended.
- [ ] Platform-native gates are accounted for: Telegram privacy/admin status, Mattermost mention gate, allowlists.
- [ ] Chat ID and thread/topic ID are confirmed from logs or API, not guessed.
- [ ] User-facing explanation distinguishes Hermes config from platform limitations.

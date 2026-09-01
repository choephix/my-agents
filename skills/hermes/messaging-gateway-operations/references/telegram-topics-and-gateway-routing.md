# Telegram Topics and Hermes Gateway Routing

This reference captures practical decision points for Telegram groups, supergroups/forum topics, private DM topic mode, and Hermes delivery/session routing.

## Quick Decision Tree

### User wants a shared Telegram group with Hermes

1. User creates the Telegram group and adds the bot.
   - Bots generally cannot create the group or add the human user themselves.
2. Verify the bot can see and send messages.
   - Gateway logs should show inbound group messages and response delivery.
3. If the bot should respond to ordinary messages, ensure Telegram delivers them:
   - Disable BotFather privacy mode, then remove/re-add the bot, or
   - Promote the bot to admin.
4. Check Hermes gates:
   - `telegram.allowed_chats` should include the group or be empty/open.
   - `telegram.require_mention` controls whether group messages require `@botusername`, reply, or wake pattern.

### User wants topics inside that group

1. Confirm chat type via Bot API `getChat` or logs.
   - `type: group` means normal group; no forum topics for the bot yet.
   - `type: supergroup` with forum/topic support means `message_thread_id` can be used.
2. In Telegram UI, enable Topics/Forum mode in group settings.
   - If the option is unavailable, Telegram may require conversion/upgrade to a supergroup or admin rights in the client.
3. Promote bot to admin and grant topic-relevant rights.
   - At minimum: send messages; for management/creation flows: manage topics.
4. Re-check the **current** chat ID after conversion.
   - Basic group IDs are negative numbers.
   - Supergroup IDs usually start with `-100...`.
   - Conversion can change the ID, so do not freeze config before re-checking.
   - Hermes/session routing may retain multiple entries with the same display name: an old `group` ID and a new `supergroup` ID. Prefer the current inbound session/origin, newest routing entry, or latest gateway update over title matching alone.
   - If probing `getChat` returns `type: group` while the user is actively posting in a forum-enabled group, assume you queried a stale pre-conversion ID and locate the current `-100...` chat before giving instructions.
5. Once messages arrive with `message_thread_id`, Hermes naturally isolates topic sessions by thread.

### User asks about `/topic`

`/topic` is not the group-topic switch. It is a user-driven multi-session feature in a private bot DM:

- Run `/topic` in the root DM with the bot.
- BotFather Threads Settings must enable Threaded Mode and allow users to create topics.
- Root DM becomes a lobby; individual DM topics become independent Hermes sessions.
- `/topic off` disables the private-DM multi-session mode.

Use this when the user wants many parallel personal sessions in the same bot DM. Do not recommend it as the way to enable group forum topics.

## Probing with Bot API Safely

If the bot token exists in `~/.hermes/.env`, you can verify state with Telegram Bot API. Never print the token.

Useful methods:

- `getChat(chat_id=<id>)`: title, type, permissions, forum/topic fields when available.
- `getChatMember(chat_id=<id>, user_id=<bot_id>)`: bot status (`member`, `administrator`) and admin rights.

The bot ID is the numeric part before `:` in the bot token. Output may include user names and chat IDs; those are routing identifiers, not secrets, but still avoid oversharing if not needed.

## Hermes Config for Group Topic Skill Binding

Basic topic isolation needs no config once Telegram sends `message_thread_id`. Add config only when a specific topic should auto-load a skill.

Example:

```yaml
platforms:
  telegram:
    extra:
      group_topics:
      - chat_id: -1001234567890
        topics:
        - name: Engineering
          thread_id: 5
          skill: software-development
        - name: Research
          thread_id: 12
          skill: arxiv
        - name: General
          thread_id: 1
```

Thread IDs are visible in Telegram topic links (`t.me/c/<group_id_without_-100>/<thread_id>`) or in gateway logs/API updates. Verify the actual `thread_id` instead of guessing from topic names.

## Hermes Delivery Targets

Use explicit thread targets when sending to a known topic:

```text
telegram:<chat_id>:<thread_id>
```

Use chat-only targets for root/general chat delivery:

```text
telegram:<chat_id>
```

In scheduled jobs, include the target explicitly if the result should land in a topic. If cron output lands in a root lobby or wrong place, configure the thread-specific delivery target or the Telegram cron thread setting where supported.

## Troubleshooting Symptoms

- Bot responds in DM but not group:
  - Gateway may be fine; check BotFather privacy/admin status and group allowlist.

- Bot sees `/commands` but not normal text:
  - Telegram privacy mode is likely on and bot is not admin.

- Group has no topic/thread IDs:
  - It is likely still a basic group, not a forum-enabled supergroup.

- Topic config does not match after setup:
  - Re-check chat ID after conversion to supergroup; it may have changed.
  - If there are multiple Hermes routing/session entries with the same title, use the current incoming chat/session origin or newest `-100...` supergroup ID, not the old basic-group ID.

- Messages in topics share context unexpectedly:
  - Confirm incoming updates include `message_thread_id`; if not, Telegram is not delivering forum-topic updates as expected.

## Session Lesson

When a user says “we are already in the group; discussing topics,” first verify the current Telegram chat type and bot admin status. In one real case, `getChat` returned `type: group` and `getChatMember` showed the bot was only `member`, so the correct next step was not Hermes `/topic`; it was to enable Telegram group Topics/Forum mode and promote the bot.

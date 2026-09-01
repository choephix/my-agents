// Delay-message extension for OMP.
// Provides /delay, /delays, and /delay-cancel.
// The delayed prompt is kept out of model context until its timer fires.

const CUSTOM_TYPE = "delay-message-state";
const UI_KEY = "delay-message";
const MAX_TIMER_MS = 2_147_483_647; // setTimeout's signed 32-bit practical ceiling.
const ALLOWED_COMMANDS_WHILE_PENDING = new Set(["delays", "delay-cancel"]);

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function preview(text, max = 120) {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, max - 1))}…`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length || seconds) parts.push(`${seconds}s`);
  return parts.slice(0, 3).join(" ");
}

function formatDue(dueAt) {
  return new Date(dueAt).toLocaleString();
}

function parseLeadingDuration(input) {
  let rest = String(input ?? "").trimStart();
  let consumedAny = false;
  let totalMs = 0;

  const unitMs = {
    ms: 1,
    millisecond: 1,
    milliseconds: 1,
    msec: 1,
    msecs: 1,
    s: 1_000,
    sec: 1_000,
    secs: 1_000,
    second: 1_000,
    seconds: 1_000,
    m: 60_000,
    min: 60_000,
    mins: 60_000,
    minute: 60_000,
    minutes: 60_000,
    h: 3_600_000,
    hr: 3_600_000,
    hrs: 3_600_000,
    hour: 3_600_000,
    hours: 3_600_000,
    d: 86_400_000,
    day: 86_400_000,
    days: 86_400_000,
    w: 604_800_000,
    week: 604_800_000,
    weeks: 604_800_000,
  };

  while (true) {
    const match = /^(\d+(?:\.\d+)?)\s*(milliseconds?|msecs?|ms|seconds?|secs?|sec|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d|weeks?|w)\b/i.exec(rest);
    if (!match) break;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier = unitMs[unit];
    if (!Number.isFinite(amount) || amount <= 0 || !multiplier) {
      break;
    }

    totalMs += amount * multiplier;
    consumedAny = true;
    rest = rest.slice(match[0].length).trimStart();
  }

  if (!consumedAny) {
    return { ok: false, error: "Missing duration. Example: /delay 3.5h Continue this." };
  }

  if (!Number.isFinite(totalMs) || totalMs <= 0) {
    return { ok: false, error: "Duration must be a positive amount of time." };
  }

  if (!rest.trim()) {
    return { ok: false, error: "Missing message. Example: /delay 3h Check this again." };
  }

  return { ok: true, delayMs: Math.ceil(totalMs), message: rest };
}

function slashCommandName(text) {
  const match = /^\s*\/([^\s]+)/.exec(String(text ?? ""));
  return match?.[1];
}

function normalizeJob(data) {
  if (!data || typeof data !== "object") return undefined;
  if (data.status !== "pending") return undefined;
  if (typeof data.message !== "string" || !data.message.trim()) return undefined;

  const dueAt = typeof data.dueAt === "number" ? data.dueAt : Date.parse(String(data.dueAt));
  if (!Number.isFinite(dueAt)) return undefined;

  return {
    id: typeof data.id === "string" ? data.id : makeId(),
    status: "pending",
    createdAt: typeof data.createdAt === "string" ? data.createdAt : nowIso(),
    dueAt,
    delayMs: typeof data.delayMs === "number" ? data.delayMs : Math.max(0, dueAt - Date.now()),
    message: data.message,
  };
}

export default function delayMessageExtension(pi) {
  pi.setLabel("Delayed Messages");

  let pending;
  let latestCtx;
  let timer;
  let unsubscribeTerminalInput;

  function persist(job) {
    pi.appendEntry(CUSTOM_TYPE, job);
  }

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function clearUi(ctx = latestCtx) {
    if (!ctx?.hasUI) return;
    ctx.ui.setStatus(UI_KEY, undefined);
    ctx.ui.setWidget(UI_KEY, undefined);
  }

  function showUi(ctx = latestCtx) {
    if (!ctx?.hasUI || !pending) return;
    installEscapeHandler(ctx);

    const remaining = Math.max(0, pending.dueAt - Date.now());
    const status = `Delayed send in ${formatDuration(remaining)} — Esc or /delay-cancel`;
    ctx.ui.setStatus(UI_KEY, status);
    ctx.ui.setWidget(
      UI_KEY,
      [
        status,
        `Due: ${formatDue(pending.dueAt)}`,
        `Message: ${preview(pending.message)}`,
      ],
      { placement: "aboveEditor" },
    );
  }

  function cancelPending(ctx = latestCtx, reason = "cancelled") {
    if (!pending) {
      ctx?.ui?.notify?.("No delayed message is pending.", "info");
      return false;
    }

    const job = pending;
    pending = undefined;
    clearTimer();
    clearUi(ctx);
    persist({ ...job, status: "cancelled", cancelledAt: nowIso(), reason });
    ctx?.ui?.notify?.(`Cancelled delayed message ${job.id}.`, "info");
    return true;
  }

  function deliverPending() {
    if (!pending) return;

    const job = pending;
    pending = undefined;
    clearTimer();
    clearUi(latestCtx);

    // Persist before sending so restart recovery does not duplicate the message.
    persist({ ...job, status: "delivered", deliveredAt: nowIso() });
    latestCtx?.ui?.notify?.(`Sending delayed message ${job.id}.`, "info");
    pi.sendUserMessage(job.message);
  }

  function armTimer(ctx = latestCtx) {
    latestCtx = ctx ?? latestCtx;
    clearTimer();

    if (!pending) {
      clearUi(latestCtx);
      return;
    }

    const remaining = pending.dueAt - Date.now();
    if (remaining <= 0) {
      timer = setTimeout(deliverPending, 0);
      timer.unref?.();
      return;
    }

    const waitMs = Math.min(remaining, MAX_TIMER_MS);
    timer = setTimeout(() => {
      timer = undefined;
      if (!pending) return;
      if (Date.now() >= pending.dueAt) {
        deliverPending();
      } else {
        armTimer(latestCtx);
      }
    }, waitMs);
    timer.unref?.();
    showUi(latestCtx);
  }

  function installEscapeHandler(ctx = latestCtx) {
    if (!ctx?.hasUI || unsubscribeTerminalInput) return;

    unsubscribeTerminalInput = ctx.ui.onTerminalInput((data) => {
      if (!pending) return undefined;
      if (data !== "\x1b") return undefined;

      cancelPending(latestCtx ?? ctx, "escape");
      return { consume: true };
    });
  }

  function restoreFromSession(ctx) {
    latestCtx = ctx;
    installEscapeHandler(ctx);
    clearTimer();

    let latest;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry?.type === "custom" && entry.customType === CUSTOM_TYPE) {
        latest = entry.data;
      }
    }

    pending = normalizeJob(latest);
    if (!pending) {
      clearUi(ctx);
      return;
    }

    armTimer(ctx);
    if (pending && pending.dueAt > Date.now()) {
      showUi(ctx);
    }
  }

  function blockSessionMove(ctx, action) {
    if (!pending) return undefined;
    showUi(ctx);
    ctx.ui.notify(`A delayed message is pending. Press Esc or run /delay-cancel before ${action}.`, "warning");
    return { cancel: true };
  }

  pi.on("session_start", (_event, ctx) => {
    restoreFromSession(ctx);
  });

  pi.on("session_switch", (_event, ctx) => {
    restoreFromSession(ctx);
  });

  pi.on("session_branch", (_event, ctx) => {
    restoreFromSession(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreFromSession(ctx);
  });

  pi.on("session_before_switch", (_event, ctx) => blockSessionMove(ctx, "switching sessions"));
  pi.on("session_before_branch", (_event, ctx) => blockSessionMove(ctx, "branching"));
  pi.on("session_before_tree", (_event, ctx) => blockSessionMove(ctx, "changing tree position"));

  pi.on("input", (event, ctx) => {
    latestCtx = ctx;
    installEscapeHandler(ctx);

    if (!pending) return undefined;
    if (event.source === "extension") return undefined;

    const command = slashCommandName(event.text);
    if (command && ALLOWED_COMMANDS_WHILE_PENDING.has(command)) {
      return undefined;
    }

    showUi(ctx);
    ctx.ui.setEditorText(event.text);
    ctx.ui.notify("Delayed message pending. Press Esc or run /delay-cancel before sending another message.", "warning");
    return { handled: true };
  });

  pi.registerCommand("delay", {
    description: "Hold a message and send it later: /delay 3.5h message",
    async handler(args, ctx) {
      latestCtx = ctx;
      installEscapeHandler(ctx);

      if (pending) {
        showUi(ctx);
        ctx.ui.notify(`Delayed message ${pending.id} is already pending. Press Esc or run /delay-cancel first.`, "warning");
        return;
      }

      const parsed = parseLeadingDuration(args);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "error");
        ctx.ui.setEditorText(`/delay ${args}`.trimEnd());
        return;
      }

      pending = {
        id: makeId(),
        status: "pending",
        createdAt: nowIso(),
        dueAt: Date.now() + parsed.delayMs,
        delayMs: parsed.delayMs,
        message: parsed.message,
      };

      persist(pending);
      armTimer(ctx);
      showUi(ctx);
      ctx.ui.notify(`Delayed message armed for ${formatDue(pending.dueAt)}. Press Esc or run /delay-cancel to cancel.`, "info");
    },
  });

  pi.registerCommand("delays", {
    description: "Show the pending delayed message",
    async handler(_args, ctx) {
      latestCtx = ctx;
      installEscapeHandler(ctx);

      if (!pending) {
        clearUi(ctx);
        ctx.ui.notify("No delayed message is pending.", "info");
        return;
      }

      showUi(ctx);
      ctx.ui.notify(`Delayed message ${pending.id}: sends in ${formatDuration(pending.dueAt - Date.now())}.`, "info");
    },
  });

  pi.registerCommand("delay-cancel", {
    description: "Cancel the pending delayed message",
    async handler(_args, ctx) {
      latestCtx = ctx;
      installEscapeHandler(ctx);
      cancelPending(ctx, "command");
    },
  });

  pi.on("session_shutdown", () => {
    clearTimer();
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
  });
}

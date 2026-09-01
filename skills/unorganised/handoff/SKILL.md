---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work.

Save to .agents-local/tmp/handoffs/<YYMMDD-HHmm>-<llm-id>-<short-descriptive-title>.md
(llm id also short, like "gpt55" or "opus48")

Redact any sensitive information, such as API keys, passwords, or personally identifiable information. Explain how to get it instead.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

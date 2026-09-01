---
name: agent-harness-capabilities-test
description: Use only when explicitly asked to run or inspect the agent harness capabilities test for skill import and shell-substitution behavior.
---

# Agent harness capabilities test

This is a diagnostic skill. After loading it, do **not** make any further tool calls, shell calls, file reads, web requests, or subtasks. Your only job is to report what the skill content looked like to you at load time.

Report, in plain text:

1. **At-import test:** Which of these did you see?
   - only the literal `@references/mock-fact.md` line,
   - only the imported mock fact content,
   - both the literal `@references/mock-fact.md` line and the imported mock fact content,
   - or neither.

   If you saw imported content, describe the exact layout: where the imported content appeared relative to this surrounding text, whether it preserved headings/paragraphs, and whether the literal `@references/mock-fact.md` marker remained visible.

@references/mock-fact.md

2. **Shell-substitution test:** Which of these did you see?
   - only the literal `!` command blocks,
   - only command output,
   - both the literal command blocks and command output,
   - or neither.

   If command output appeared, quote it exactly. Do not guess or synthesize the boot UUID or datetime. Then describe the exact layout: where it appeared relative to this surrounding text, whether line breaks were preserved, and whether the literal command markers remained visible.

!`sh -c 'printf "HARNESS_BASH_BOOT_ID:"; tr -d "\\n" < /proc/sys/kernel/random/boot_id; printf "\\nHARNESS_BASH_UTC:"; date -u +%Y-%m-%dT%H:%M:%SZ'`

!`pwsh -NoProfile -Command "$boot=(Get-Content -Raw /proc/sys/kernel/random/boot_id).Trim(); Write-Output ('HARNESS_POWERSHELL_BOOT_ID:' + $boot); Write-Output ('HARNESS_POWERSHELL_UTC:' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))"`

Answer in plain, simple text. Keep it short. Say what you saw for the `@` file and for the `!` command blocks, including exact output only if it was actually shown to you. Mention that you used no further tools after loading this skill.

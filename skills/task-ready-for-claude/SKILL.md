---
name: task-ready-for-claude
description: Check whether a confirmed task archive can be handed to Claude Code for runtime review or implementation continuation.
argument-hint: "<task-dir>"
arguments: task_dir
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-ready-for-claude

Prepare a Claude Code runtime review or continuation package only after user confirmation is recorded.

## Readiness Gate

Read `$task_dir/DECISIONS.md`.

If it does not contain both:

- `Status: confirmed`
- `Formal execution allowed: yes`

then do not write `HANDOFF.md` or execution-ready `REVIEW.md`. Output the missing confirmation items and recommend `/task-confirm <task-dir>`.

## If Confirmed

Read the task archive and generate the appropriate package:

- If Claude Code is reviewer: write `REVIEW.md`.
- If Claude Code is primary executor: write `HANDOFF.md`.

Include:

```md
# Claude Readiness Package

Task Archive:
Claude Role:
Goal:
Confirmed Scope:
Forbidden Scope:
Files / Systems Allowed:
Files / Systems Forbidden:
Runtime Checks Needed:
Validation Expected:
Rollback Expected:
Secrets Policy:
Human Dispatch Required:
```

Also include:

```md
## Next Prompt Draft

Suggested user prompt for Claude Code:
请根据这个 Claude Readiness Package 继续实现或复核 runtime 体验。正式行动前先检查确认状态、允许范围、禁止范围、验证方式和回滚预期；不要处理未授权敏感区域。
```

## Safety

- Do not start implementation.
- Do not include secret values.
- Do not modify target files.
- Sensitive areas still require separate approval even after general confirmation.

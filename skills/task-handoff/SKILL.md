---
name: task-handoff
description: Generate HANDOFF.md from a task archive for explicit user-dispatched work between Claude Code and Codex desktop.
argument-hint: "<task-dir>"
arguments: task_dir
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-handoff

Generate `HANDOFF.md` for a task archive. Do not call the other agent.

## Instructions

1. Read `BRIEF.md`, `ROUTING.md`, `DECISIONS.md`, and any existing validation notes in `$task_dir`.
2. Identify the destination agent from `ROUTING.md`.
3. State that user dispatch is required before execution.
4. Write or output:

```md
# Agent Handoff

From:
To:
User Approval:
Task Archive:
Goal:
Success Criteria:
Allowed Files:
Forbidden Files:
Task:
Validation:
Rollback:
Risks:
Open Questions:
Pre-Execution Confirmation:
```

## Safety

- If the handoff involves secrets, hooks, MCP, permissions, `settings.local.json`, deletion, or broad moves, mark `User Approval: pending separate confirmation`.
- If task details and boundaries have not been confirmed by the user, mark `User Approval: pending` and say the receiving agent must not execute yet.
- Do not include secret values.
- Keep the task narrow enough for the receiving agent to execute or review without guessing.

## Next Prompt Draft

At the end of the response, include a prompt the user can paste to the receiving agent:

```md
## Next Prompt Draft

Suggested user prompt:
请根据这个 HANDOFF.md 执行或审查任务。执行前先确认 User Approval、允许范围、禁止范围、验证方式和回滚预期；不要处理未授权的敏感区域。
```

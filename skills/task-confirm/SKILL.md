---
name: task-confirm
description: Record explicit user confirmation that a task archive is ready for formal execution or dispatch.
argument-hint: "<task-dir>"
arguments: task_dir
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-confirm

Update `DECISIONS.md` only after the user explicitly confirms task details and boundaries.

## Confirmation Requirement

Before marking a task confirmed, the user must confirm:

- Goal and expected outcome.
- Success criteria.
- In-scope work.
- Out-of-scope work.
- Primary agent and reviewer.
- Allowed files, systems, or repositories.
- Forbidden files, systems, or repositories.
- Validation expectations.
- Rollback expectations.
- Sensitive areas requiring separate approval.

If any of these are missing, do not mark the task confirmed. Ask for the missing details or leave the task as draft-only.

## Write To `DECISIONS.md`

When explicitly confirmed, update or append:

```md
## User Confirmation Before Execution

- Status: confirmed
- Formal execution allowed: yes
- Confirmed goal:
- Confirmed success criteria:
- Confirmed in scope:
- Confirmed out of scope:
- Confirmed primary agent:
- Confirmed reviewer:
- Confirmed allowed files / systems:
- Confirmed forbidden files / systems:
- Confirmed validation:
- Confirmed rollback expectation:
- Sensitive areas requiring separate approval:
```

## Safety

- Do not infer confirmation from a draft archive.
- Do not write `confirmed` if the user only asked for planning.
- Do not include secret values.
- Do not execute the task.

## Next Prompt Draft

At the end of the response, include one of these:

```md
## Next Prompt Draft

Suggested next command:
`/task-ready-for-codex <task-dir>`

Suggested user prompt:
请把这个已确认任务打包给 Codex 审查，重点检查风险、验证缺口和回滚是否充分。
```

or:

```md
## Next Prompt Draft

Suggested next command:
`/task-ready-for-claude <task-dir>`

Suggested user prompt:
请把这个已确认任务打包给 Claude Code 继续实现或复核 runtime 体验。
```

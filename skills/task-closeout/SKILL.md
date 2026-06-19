---
name: task-closeout
description: Close a task archive by summarizing outcome, validation, decisions, rollback, remaining risks, and next steps.
argument-hint: "<task-dir>"
arguments: task_dir
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-closeout

Create or update `VALIDATION.md` and `DECISIONS.md`, then output a concise closeout summary.

## Instructions

1. Read all available task archive files in `$task_dir`.
2. Record validation evidence and gaps in `VALIDATION.md`.
3. Add final decisions or pending questions to `DECISIONS.md`.
4. Output:

```md
# Task Closeout

Task Archive:
Outcome:
Success Criteria Status:
Validation Results:
Rollback:
Remaining Risks:
Open Questions:
Recommended Next Step:
```

## Safety

- Do not claim completion unless evidence in the archive supports it.
- Do not include secret values.
- If rollback is missing for a mutating task, mark closeout incomplete.

## Next Prompt Draft

At the end of the response, include:

```md
## Next Prompt Draft

Suggested user prompt:
请根据这个 closeout 判断是否归档任务、补充验证，或开启一个新的后续任务档案。
```

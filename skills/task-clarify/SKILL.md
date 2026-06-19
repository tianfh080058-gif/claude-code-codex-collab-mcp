---
name: task-clarify
description: Review a draft task archive and generate a short clarification pass before user confirmation and formal execution.
argument-hint: "<task-dir>"
arguments: task_dir
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-clarify

Clarify a draft task archive before `/task-confirm`. This skill improves the archive and asks only high-value questions; it does not execute the task.

## Inputs

Read available files in `$task_dir`, especially:

- `BRIEF.md`
- `ROUTING.md`
- `DECISIONS.md`
- `VALIDATION.md`

## Output

Create or update:

```text
$task_dir/CLARIFICATION.md
```

Also append a concise clarification summary to `DECISIONS.md` under `## Clarification`.

## Clarification Rules

1. Generate at most 3 questions.
2. Ask only questions that materially affect scope, routing, validation, rollback, risk, or success criteria.
3. Classify each item as:
   - Must Confirm Before Execution
   - Safe Default Assumption
   - Non-Blocking Follow-Up
4. Provide a recommended default for each question when safe.
5. Do not ask for information already present in the task archive.
6. Do not include secret values.

## `CLARIFICATION.md` Template

```md
# Task Clarification

Task Archive:
Clarification Status: pending / complete
Confidence: high / medium / low

## Must Confirm Before Execution

1.

## Safe Default Assumptions

- 

## Non-Blocking Follow-Up

- 

## Recommended Confirmation Summary

- Goal:
- Success criteria:
- In scope:
- Out of scope:
- Primary agent:
- Reviewer:
- Allowed files / systems:
- Forbidden files / systems:
- Validation:
- Rollback:
- Sensitive areas:
```

## When To Mark Complete

Mark `Clarification Status: complete` only when the archive contains enough detail for `/task-confirm` to record a real confirmation. If key scope or safety boundaries are missing, leave it as `pending`.

## Next Prompt Draft

At the end of the response, include:

```md
## Next Prompt Draft

Suggested next command:
`/task-confirm <task-dir>`

Suggested user prompt:
我确认该任务的目标、成功标准、范围、禁止范围、主办代理、复核代理、验证方式、回滚预期和敏感边界如下：...
```

## Safety

- Do not execute, hand off, or review target changes.
- Do not modify files outside the task archive.
- Do not change `Status: pending` or `Formal execution allowed: no`.
- Formal work can only begin after `/task-confirm`.

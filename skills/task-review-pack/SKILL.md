---
name: task-review-pack
description: Generate REVIEW.md from a task archive so the other agent can review scope, risks, validation, and rollback.
argument-hint: "<task-dir>"
arguments: task_dir
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-review-pack

Create a review pack for another agent. This skill does not apply fixes.

## Instructions

1. Read the task archive files that exist in `$task_dir`.
2. Summarize what changed or what is proposed.
3. Identify risk focus areas and validation evidence.
4. Write or output:

```md
# Task Review Pack

Task Archive:
Review Target:
Changed Or Proposed Files:
Risk Focus:
Validation Already Run:
Validation Gaps:
Secrets Policy:
Expected Reviewer Output:
Rollback Evidence:
Human Review Needed:
```

## Reviewer Output Requested

Ask the reviewer to report:

- Safe to keep?
- Findings ordered by severity.
- Missing validation.
- Rollback concerns.
- Required user confirmations.

## Safety

- Do not print secret values.
- Mark indirect or missing evidence as `needs verification`.

## Next Prompt Draft

At the end of the response, include a prompt the user can paste to the reviewer:

```md
## Next Prompt Draft

Suggested user prompt:
请根据这个 REVIEW.md 做独立审查。请优先输出高/中/低风险发现、缺失验证、回滚问题和需要用户确认的事项，不要打印任何 secret 值。
```

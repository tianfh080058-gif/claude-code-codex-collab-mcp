# /task-clarify

Legacy command wrapper for `skills/task-clarify/SKILL.md`.

Use this command after `/task-start` and before `/task-confirm` to generate a short clarification pass for a task archive.

Expected output:

```text
reports/tasks/<task-id>/CLARIFICATION.md
```

Rules:

- Ask at most 3 high-value questions.
- Classify each issue as must-confirm, safe default, or non-blocking.
- Do not execute the task.
- Do not include secret values.

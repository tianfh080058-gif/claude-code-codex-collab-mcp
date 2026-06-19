# /task-start

Legacy command wrapper for `skills/task-start/SKILL.md`.

Use this command to create a draft task archive from a user goal.

Expected output:

```text
reports/tasks/YYYYMMDD-HHMMSS-short-slug/
  BRIEF.md
  ROUTING.md
  DECISIONS.md
  VALIDATION.md
```

This command does not authorize formal execution. `DECISIONS.md` must keep:

```md
User Confirmation Before Execution: pending
Formal execution allowed: no
```

Do not include secret values.

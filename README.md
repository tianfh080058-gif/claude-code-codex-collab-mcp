# Codex Claude Collab

Lightweight file-based collaboration workflow for Claude Code and Codex.

This plugin helps Claude Code prepare structured task archives that can be reviewed or executed by Codex without creating an automatic agent loop. It keeps the user as dispatcher, requires explicit confirmation before formal execution, and generates paste-ready prompts for Codex handoff.

## What It Adds

- Task archives under `reports/tasks/YYYYMMDD-HHMMSS-short-slug/`.
- A clarification step before confirmation.
- A hard pre-execution confirmation gate.
- Readiness packages for Codex or Claude Code.
- Paste-ready `CODEX_PROMPT.md` for Codex review or execution.
- A read-only `collaboration-reviewer` agent for archive completeness review.

## Core Workflow

```text
/task-start <goal>
  -> draft task archive

/task-clarify <task-dir>
  -> up to 3 high-value clarification questions

/task-confirm <task-dir>
  -> explicit user confirmation before formal work

/task-ready-for-codex <task-dir>
  -> REVIEW.md / HANDOFF.md plus CODEX_PROMPT.md

/task-ready-for-claude <task-dir>
  -> Claude runtime review or continuation package

/task-closeout <task-dir>
  -> validation, rollback, risks, and next step summary
```

## Included Skills

- `/task-start`
- `/task-clarify`
- `/task-confirm`
- `/task-route`
- `/task-brief`
- `/task-handoff`
- `/task-review-pack`
- `/task-ready-for-codex`
- `/task-ready-for-claude`
- `/task-closeout`

Each skill is explicit-only with `disable-model-invocation: true`.

## Safety Model

- No automatic Codex or Claude invocation.
- No hooks.
- No permissions changes.
- No MCP changes.
- No credential handling.
- Secret values must never be written into task archives.
- Formal execution is blocked until `/task-confirm` records explicit user confirmation.

## Task Archive Files

Core files:

- `BRIEF.md`
- `ROUTING.md`
- `CLARIFICATION.md`
- `DECISIONS.md`
- `VALIDATION.md`

Optional files:

- `REVIEW.md`
- `HANDOFF.md`
- `CODEX_PROMPT.md`

## Example

```text
/task-start Improve login UX and reduce first-time login failures
/task-clarify reports/tasks/20260619-140000-login-ux
/task-confirm reports/tasks/20260619-140000-login-ux
/task-ready-for-codex reports/tasks/20260619-140000-login-ux
```

Then paste the generated `CODEX_PROMPT.md` into Codex.

## Docs

- `docs/workflow.md`
- `docs/task-collaboration-playbook.md`
- `docs/agent-capability-matrix.md`
- `docs/task-archive-template.md`

## Privacy

This plugin intentionally does not include local settings, logs, histories, backups, telemetry, project transcripts, or credentials.

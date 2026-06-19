# Codex Claude Collab

> Turn Claude Code and Codex into a calm, user-directed AI delivery team.

**Codex Claude Collab** is a lightweight collaboration plugin for people who want Claude Code and Codex to work together without letting agents run wild.

It gives Claude Code a disciplined workflow for creating task archives, clarifying requirements, confirming execution boundaries, handing work to Codex, and closing the loop with validation and rollback notes.

No hidden automation. No surprise hooks. No agent-to-agent chaos.

Just a clean operating system for:

- turning fuzzy goals into executable task files,
- forcing clarification before work starts,
- keeping the user in charge,
- sending Codex a paste-ready review prompt,
- and preserving the evidence trail for what happened.

## Why This Exists

Claude Code is excellent at living inside a project: reading code, shaping PRDs, implementing changes, and validating runtime behavior.

Codex is excellent at independent review: configuration governance, cross-file audits, rollback planning, safety checks, and spotting sharp edges.

This plugin lets each tool do what it is good at while the user stays the dispatcher.

## What It Adds

- **Task archives** under `reports/tasks/YYYYMMDD-HHMMSS-short-slug/`.
- **Requirement clarification** with at most 3 high-value questions.
- **Pre-execution confirmation gates** so work cannot start from vague intent.
- **Readiness packages** for Codex or Claude Code.
- **Paste-ready `CODEX_PROMPT.md`** for Codex review or execution.
- **Next prompt drafts** after every step so the user always knows what to say next.
- **Read-only collaboration reviewer** for checking task archive completeness.

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

## A Tiny Story

You say:

```text
/task-start Improve login UX and reduce first-time login failures
```

Claude Code creates a draft archive, but it cannot start work yet.

Then:

```text
/task-clarify reports/tasks/20260619-140000-login-ux
```

It asks only the important questions:

- Are code changes allowed, or only a plan?
- Can auth APIs change, or only the frontend?
- What metric matters most?

After you confirm:

```text
/task-confirm reports/tasks/20260619-140000-login-ux
```

Claude can implement. When it is time for independent review:

```text
/task-ready-for-codex reports/tasks/20260619-140000-login-ux
```

The plugin creates `CODEX_PROMPT.md`, a ready-to-paste prompt that tells Codex exactly what to inspect: scope, risks, validation gaps, rollback expectations, and secret-handling rules.

Claude builds. Codex reviews. You decide.

That is the whole point.

## Docs

- `docs/workflow.md`
- `docs/task-collaboration-playbook.md`
- `docs/agent-capability-matrix.md`
- `docs/task-archive-template.md`

## Privacy

This plugin intentionally does not include local settings, logs, histories, backups, telemetry, project transcripts, or credentials.

## Philosophy

The goal is not to make agents autonomous.

The goal is to make collaboration legible.

Every task should have:

- a clear goal,
- an explicit owner,
- confirmed boundaries,
- validation evidence,
- rollback notes,
- and a next prompt the user can actually use.

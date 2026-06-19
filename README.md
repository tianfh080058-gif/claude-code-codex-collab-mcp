# Codex Claude Collab

> A user-directed command layer for Claude Code and Codex.
> Coordinate two AI coding agents with task archives, confirmation gates, review packets, rollback notes, and paste-ready cross-agent prompts.

**Codex Claude Collab** is a lightweight collaboration plugin for teams and power users who want Claude Code and Codex to work together without creating a risky autonomous agent loop.

It turns vague goals into structured task files, asks for clarification before work starts, records explicit execution boundaries, routes work to the right agent, prepares review packets, and keeps validation plus rollback evidence close to the task.

Claude Code stays close to implementation.
Codex stays sharp on review, governance, rollback, and cross-file reasoning.
You stay in control.

## The Problem

Claude Code and Codex are both powerful, but they shine in different moments.

Claude Code is strongest when it is inside the project runtime: reading local code, shaping PRDs, making implementation changes, running validation, and staying close to the developer loop.

Codex is strongest as an independent operator: auditing diffs, reviewing configuration, planning rollback, checking cross-file impact, and catching the things a primary implementer may miss.

The missing piece is not more autonomy.

The missing piece is a clean operating model for handoff, review, confirmation, and accountability.

## The Operating Model

Codex Claude Collab gives Claude Code a file-based command layer:

```text
Start -> Clarify -> Confirm -> Execute or Handoff -> Review -> Closeout
```

Every meaningful task gets a task archive under:

```text
reports/tasks/YYYYMMDD-HHMMSS-short-slug/
```

That archive becomes the shared source of truth:

- what the user asked for,
- what is in scope,
- what is forbidden,
- which agent should lead,
- what needs confirmation,
- how success will be validated,
- what rollback should look like,
- and what prompt should be pasted into the next agent.

## What This Plugin Gives You

- **Task archives** that turn informal goals into durable execution records.
- **Requirement clarification** with at most 3 high-value questions before work starts.
- **Confirmation gates** that block formal execution until the user approves scope, risks, validation, and rollback expectations.
- **Agent routing** across Claude-led, Codex-led, and dual-agent workflows.
- **Review packets** that help Codex focus on real risk instead of rereading everything from scratch.
- **Handoff packets** that make cross-agent collaboration concrete and auditable.
- **Paste-ready `CODEX_PROMPT.md`** for Codex review or execution.
- **Next prompt drafts** after each stage so the user always knows what to say next.
- **Read-only collaboration reviewer** for checking whether a task archive is complete, authorized, and reviewable.

## Core Workflow

```text
/task-start <goal>
  -> create a draft task archive

/task-clarify <task-dir>
  -> ask only the missing high-impact questions

/task-confirm <task-dir>
  -> record explicit user approval before formal work

/task-route <task-dir>
  -> decide Claude-led, Codex-led, or dual-agent collaboration

/task-ready-for-codex <task-dir>
  -> generate REVIEW.md or HANDOFF.md plus CODEX_PROMPT.md

/task-ready-for-claude <task-dir>
  -> prepare Claude runtime review or continuation context

/task-closeout <task-dir>
  -> summarize validation, risks, rollback, and next actions
```

## Real Example

User goal:

```text
/task-start Improve login UX and reduce first-time login failures
```

The plugin creates a draft archive, but formal execution remains blocked.

Then:

```text
/task-clarify reports/tasks/20260619-140000-login-ux
```

Claude Code asks only the questions that affect execution:

- Are code changes allowed, or should this remain a product/UX plan?
- Can authentication APIs change, or only frontend copy and flow?
- What success signal matters most: completion rate, support tickets, time-to-login, or error recovery?

After the user confirms:

```text
/task-confirm reports/tasks/20260619-140000-login-ux
```

Claude Code can proceed with implementation or planning. When an independent review is needed:

```text
/task-ready-for-codex reports/tasks/20260619-140000-login-ux
```

The plugin generates `CODEX_PROMPT.md`, a ready-to-paste prompt telling Codex exactly what to inspect:

- scope and forbidden areas,
- risk focus,
- changed files,
- validation gaps,
- rollback expectations,
- and secret-handling rules.

Claude builds. Codex reviews. The user decides.

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

## Task Archive Anatomy

Core files:

- `BRIEF.md` - goal, success criteria, scope, constraints.
- `ROUTING.md` - lead agent, reviewer agent, rationale, escalation rules.
- `CLARIFICATION.md` - high-impact questions and user answers.
- `DECISIONS.md` - confirmation status, execution authorization, sensitive areas.
- `VALIDATION.md` - commands, checks, evidence, and validation gaps.

Optional files:

- `REVIEW.md` - focused review request.
- `HANDOFF.md` - execution handoff for another agent.
- `CODEX_PROMPT.md` - paste-ready prompt for Codex.

## Safety Model

This plugin is deliberately conservative.

- It does not call Codex automatically.
- It does not call Claude Code recursively.
- It does not add hooks.
- It does not change permissions.
- It does not modify MCP configuration.
- It does not handle credentials.
- It does not store secrets in task archives.
- It blocks formal execution until `/task-confirm` records explicit user confirmation.

The goal is not unchecked automation. The goal is controlled acceleration.

## Installation

Clone or copy this plugin into your Claude Code plugin directory, then use the explicit slash commands inside Claude Code.

The plugin directory should contain:

```text
codex-claude-collab/
├── .claude-plugin/plugin.json
├── skills/
├── commands/
├── agents/
├── docs/
├── examples/
├── README.md
└── LICENSE
```

## Documentation

- `docs/workflow.md`
- `docs/task-collaboration-playbook.md`
- `docs/agent-capability-matrix.md`
- `docs/task-archive-template.md`

## Privacy

This repository intentionally excludes local settings, logs, histories, backups, telemetry, project transcripts, tokens, and credentials.

Task archives should contain executable summaries, not private chat dumps.

## Philosophy

Great AI collaboration is not a swarm of agents acting on impulse.

It is a disciplined delivery loop:

- clear task framing,
- honest clarification,
- explicit user authorization,
- agent-specific strengths,
- independent review,
- validation evidence,
- rollback awareness,
- and a next prompt the user can actually use.

Codex Claude Collab is the small command layer that makes that loop visible.

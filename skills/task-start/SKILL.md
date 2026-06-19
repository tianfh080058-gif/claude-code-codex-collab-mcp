---
name: task-start
description: Lightly automate task archive creation from a user goal while keeping formal execution blocked until user confirmation.
argument-hint: "<goal>"
arguments: goal
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-start

Create a draft task archive from `$goal`. This skill starts coordination, not execution.

## Output

Create:

```text
reports/tasks/YYYYMMDD-HHMMSS-short-slug/
  BRIEF.md
  ROUTING.md
  DECISIONS.md
  VALIDATION.md
```

## Steps

1. Use `$goal` as the user goal. If missing, ask for the goal.
2. Create a short ASCII slug. Avoid private values.
3. Infer a draft route:
   - Claude-led for product, PRD, application code, UX, debugging, runtime validation.
   - Codex-led for `.claude` governance, hooks, MCP, permissions, backup manifests, audit reports.
   - Dual-agent for security-sensitive work, broad refactors, or work needing independent review.
4. Generate `BRIEF.md`, `ROUTING.md`, `DECISIONS.md`, and `VALIDATION.md`.
5. Mark the archive as draft-only:
   - `User Confirmation Before Execution: pending`
   - `Formal execution allowed: no`
6. List missing confirmation items and recommend `/task-clarify <task-dir>` when scope, success criteria, validation, rollback, or sensitive boundaries are unclear.
7. Do not execute, do not hand off for execution, and do not modify task target files.

## Required Templates

`BRIEF.md`:

```md
# Task Brief

Goal:
Background:
Audience / User:
Success Criteria:
In Scope:
Out Of Scope:
Constraints:
Sensitive Areas:
Initial Assumptions:
Open Questions:
```

`ROUTING.md`:

```md
# Task Routing

Routing Mode:
Primary Agent:
Review Agent:
Why This Split:
Allowed Scope:
Forbidden Scope:
Sensitive Areas:
Recommended Next Step:
Requires User Confirmation: yes
Pre-Execution Confirmation Checklist:
```

`DECISIONS.md`:

```md
# Decisions

## User Confirmation Before Execution

- Status: pending
- Formal execution allowed: no
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

## Assumptions

## Pending Questions
```

`VALIDATION.md`:

```md
# Validation

## Planned Checks

## Checks Run

## Checks Not Run

## Evidence

## Gaps
```

## Next Prompt Draft

At the end of the response, include:

```md
## Next Prompt Draft

Suggested next command:
`/task-clarify <task-dir>`

Suggested user prompt:
请基于这个任务档案提出最多 3 个正式开工前必须澄清的问题，并区分必须确认、可默认假设、非阻塞后续项。
```

## Safety

- Do not include secret values.
- Do not copy full chat transcripts.
- Do not call Codex or Claude automatically.
- Do not add hooks or change permissions.
- If meaningful task details are missing, leave clarification pending and recommend `/task-clarify`.
- Formal work can only begin after `/task-confirm`.

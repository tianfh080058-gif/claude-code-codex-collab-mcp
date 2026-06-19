---
name: task-brief
description: Create a task archive brief from a user goal so Codex desktop and Claude Code CLI can coordinate through files.
argument-hint: "<goal>"
arguments: goal
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-brief

Create or update a task archive under `reports/tasks/YYYYMMDD-HHMMSS-short-slug/`.

## Instructions

1. Use `$goal` as the user goal. If the goal is missing, ask the user for it.
2. Create a short ASCII slug from the goal. Keep it human-readable and avoid private values.
3. Prefer writing `BRIEF.md` and `DECISIONS.md` in the task archive.
4. Do not store secret values or full chat transcripts.
5. Use this `BRIEF.md` structure:

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

6. Use this initial `DECISIONS.md` structure:

```md
# Decisions

## Confirmed

- Task archive created from explicit user request.

## Pending

- Primary agent and reviewer are decided by `/task-route`.
```

## Safety

- Mark secrets, hooks, MCP, permissions, `settings.local.json`, deletion, and broad moves as sensitive.
- Do not execute the task. This skill only creates the archive brief.

## Next Prompt Draft

At the end of the response, include:

```md
## Next Prompt Draft

Suggested next command:
`/task-route <task-dir>`

Suggested user prompt:
请基于这个任务 brief 判断应由 Claude Code 主办、Codex 主办，还是双代理协作，并列出正式开工前要确认的边界。
```

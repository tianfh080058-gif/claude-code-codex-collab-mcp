---
name: task-route
description: Decide whether Claude Code, Codex desktop, or both should handle a task archive or user goal.
argument-hint: "<brief-or-goal>"
arguments: brief_or_goal
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-route

Create `ROUTING.md` for a task archive or output the same structure if no archive exists.

## Instructions

1. Read the provided task archive or interpret `$brief_or_goal` as the goal.
2. Choose one routing mode:
   - Claude-led: project code, product/PRD, runtime validation, implementation work.
   - Codex-led: `.claude` governance, docs organization, backups, rollback, config audit.
   - Dual-agent: high-risk or high-value work where one agent implements and the other reviews.
3. Prefer one primary agent and one reviewer.
4. Do not authorize execution. Routing is a recommendation until the user confirms.
5. Write or output:

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
Requires User Confirmation:
Pre-Execution Confirmation Checklist:
```

## Default Heuristics

- Claude-led for application code, PRD, UX, debugging, CLI runtime validation.
- Codex-led for `.claude` configuration, hooks, MCP, permissions, backup manifests, audit reports.
- Dual-agent for security-sensitive changes, broad refactors, or tasks with both product and configuration impact.

## Confirmation Gate

Before any implementation, configuration change, or cross-agent execution starts, ask the user to confirm:

- Goal and expected outcome.
- Success criteria.
- In-scope and out-of-scope work.
- Primary agent and reviewer.
- Allowed and forbidden files, systems, or repositories.
- Validation expectations.
- Rollback expectations.
- Sensitive areas requiring separate approval.

If the user has not confirmed these points, set `Requires User Confirmation: yes` and recommend only draft refinement as the next step.

## Next Prompt Draft

At the end of the response, include:

```md
## Next Prompt Draft

Suggested next command:
`/task-clarify <task-dir>`

Suggested user prompt:
请根据这个路由结果，提出正式开工前最需要我确认的 1-3 个问题。
```

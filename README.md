# Claude Code-Codex-Collab MCP

> A human-governed collaboration layer for Claude Code and Codex.
> Give each agent the work it is best at, keep the human in command, and turn complex AI-assisted engineering into an auditable delivery loop.

**Claude Code-Codex-Collab MCP** is a Claude Code plugin and cross-agent MCP gateway that lets Claude Code CLI and Codex cooperate through a structured, safety-aware workflow.

It is designed for builders who want more than copy-pasting prompts between tools, but do not want an uncontrolled autonomous agent loop touching production code, credentials, hooks, or permissions without review.

The result is a practical collaboration system:

- Claude Code stays close to the project runtime, implementation, local commands, and developer flow.
- Codex acts as a sharp independent reviewer, planner, auditor, and cross-file reasoning partner.
- The user keeps final control through clarification gates, approval cards, risk policies, quality evidence, and rollback notes.

## Current Capability Snapshot

The current gateway exposes 89 MCP tools organized around a user-governed delivery loop:

- **User modes:** `solo_developer_safe`, `fast_local_iteration`, `config_governance`, `sandbox_autonomous`, and `enterprise_review`.
- **Friendly approvals:** review the next pending action, approve it, deny it, or request revision without manually stitching low-level confirmation calls.
- **Task harness:** every major workflow step returns state, risk, required evidence, blocking issues, stop conditions, and next prompt drafts.
- **Loop automation:** `advance_task_loop` moves a resumable run to the next safe node while stopping for missing evidence, pending approval, repeated failure, or high-risk human review.
- **Quality evidence:** validation, changed files, review findings, fixes, rollback plans, approvals, logs, screenshots, and open risks are tracked before closeout.
- **Desktop boundary:** Codex Desktop is treated as a human-facing workspace; Codex CLI/MCP and Claude Code CLI/MCP are the programmable execution surfaces.

## Why This Exists

Modern coding agents are powerful, but real projects need more than raw power.

They need:

- clear scope before execution,
- explicit approval before risky action,
- independent review after implementation,
- validation evidence before closeout,
- rollback thinking before edits,
- and a collaboration record that survives across agent sessions.

This project turns Claude Code and Codex into a coordinated pair without pretending that either one should silently drive the other forever.

It is not a swarm.
It is an operating model.

```text
Clarify -> Plan -> Approve -> Execute -> Review -> Validate -> Close
```

## What It Does

### Cross-Agent MCP Gateway

The bundled `cross-agent-gateway` MCP server exposes a programmable bridge between Claude Code and Codex:

- call Codex through the Codex MCP backend,
- continue Codex threads,
- call Claude Code through `claude --print`,
- list and proxy tools exposed by `claude mcp serve`,
- classify request risk before execution,
- require human confirmation for risky actions,
- record audit events,
- manage cooperative file locks,
- build context packs,
- run closeout quality gates.

### Human-In-The-Loop Policy Modes

The gateway supports three operating modes:

- `cautious`: every cross-agent call requires explicit confirmation.
- `auto`: low-risk calls can proceed; high-risk calls require confirmation.
- `danger`: gateway confirmation checks are disabled after a bound confirmation.

`danger` mode is intentionally hard to enter. Enabling it requires a pending confirmation tied to the exact request hash. Use it only in disposable sandboxes.

For easier setup, user-facing modes wrap these policies:

- `solo_developer_safe` for daily real-project work.
- `fast_local_iteration` for local non-production iteration.
- `config_governance` for Claude/Codex/MCP/settings work.
- `sandbox_autonomous` for disposable experiments.
- `enterprise_review` for shared or compliance-sensitive repositories.

Use `list_user_mode_presets` to compare them and `apply_user_mode_preset` to configure one for a project.

### Requirement Clarification Gate

Before execution, the gateway can detect missing information and ask up to three high-impact questions.

It checks for:

- a concrete goal,
- scope or affected files,
- success criteria,
- validation method,
- rollback expectation,
- and sensitive areas such as auth, payments, data migration, production systems, permissions, secrets, hooks, or MCP configuration.

High-level tools such as `implement_with_review` and `execute_approved_plan` run this gate before dispatch. If the task is vague, they return `needs_clarification` instead of calling another agent.

### Plan-First Execution

For complex work, the system encourages explicit planning before execution:

- `create_plan`
- `revise_plan`
- `approve_plan`
- `execute_approved_plan`

This gives the user a clear checkpoint before code changes or cross-agent dispatch.

### Resumable Collaboration Runs

Long tasks can be tracked with a state machine:

- `clarifying`
- `planned`
- `approved`
- `implementing`
- `validating`
- `codex_reviewing`
- `fixing`
- `final_gate`
- `done`
- `canceled`

Each run can record validation, review, changed-file, and rollback evidence.

### Quality Gates And Closeout Evidence

The gateway includes closeout checks for:

- goal coverage,
- validation evidence,
- independent review,
- rollback documentation,
- unresolved risks,
- changed files staying inside approved scope.

It does not replace tests. It makes missing evidence visible before a task is called complete.

### Harness And Loop Operating System

The gateway now adds a consistent Harness layer around complex project work.

Key workflow tools return:

- `harness`: current state, task mode, next action, required evidence, blocking issues, quality gate, route, risk, and stop condition.
- `nextPromptDrafts`: copy-ready prompts for the user, Claude Code, and Codex.

This turns each step into an explicit operating loop:

```text
Clarify -> Plan -> Human approve -> Claude implement -> Codex review -> Claude fix -> Quality gate -> Closeout
```

The loop is bounded by stop conditions:

- max review/fix rounds,
- max repeated failures,
- quality gate pass,
- high-risk findings that require human approval.

The goal is not endless autonomy. The goal is a disciplined loop that knows when to continue, when to stop, and when to hand control back to the human.

### Task Archives

The plugin also includes Claude Code slash-command workflows for file-based collaboration archives:

```text
reports/tasks/YYYYMMDD-HHMMSS-short-slug/
```

Each archive can contain:

- `BRIEF.md` - goal, scope, constraints, success criteria,
- `CLARIFICATION.md` - questions and answers,
- `DECISIONS.md` - approvals and sensitive areas,
- `ROUTING.md` - lead/reviewer agent and rationale,
- `VALIDATION.md` - commands, evidence, and gaps,
- `REVIEW.md` - focused review request,
- `HANDOFF.md` - cross-agent handoff,
- `CODEX_PROMPT.md` - paste-ready Codex prompt.

## Architecture

```text
                      Human User
                          |
                          v
              clarification / approval / review
                          |
                          v
              +-----------------------------+
              | cross-agent-gateway MCP     |
              | risk, policy, state, audit  |
              +-------------+---------------+
                            |
          +-----------------+------------------+
          |                                    |
          v                                    v
  Claude Code CLI                       Codex MCP backend
  claude --print                        codex / codex-reply
  claude mcp serve                      independent review
  project runtime                       planning / audit
```

The gateway coordinates programmable MCP/CLI surfaces. It does **not** remote-control an already-open Codex Desktop chat window.

Current boundary: this project can connect Claude Code CLI/MCP capabilities with Codex MCP/CLI capabilities. Codex Desktop is best treated as the human-facing workspace that can load this gateway for a trusted project, not as a background API that can be fully remote-controlled.

Shared task archives, confirmation records, audit events, and quality evidence are the durable coordination layer.

## Quickstart

### 1. Install

Place this plugin in your Claude Code plugin directory:

```text
~/.claude/plugins/codex-claude-collab/
```

The plugin includes:

```text
.claude-plugin/plugin.json
.mcp.json
servers/cross-agent-gateway.mjs
scripts/verify-mcp-gateway.mjs
skills/
commands/
agents/
docs/
examples/
```

### 2. Verify The Gateway

From the plugin workspace:

```bash
node scripts/verify-mcp-gateway.mjs
```

For backend handshakes with both Codex and Claude:

```bash
node scripts/verify-mcp-gateway.mjs --deep
```

### 3. Start Safely

Recommended default:

```text
mode = auto
```

Use `cautious` for:

- configuration governance,
- production repositories,
- hooks,
- MCP configuration,
- permissions,
- secrets,
- unfamiliar codebases.

Use `danger` only in throwaway sandboxes.

### 4. Profile A Project

Use the gateway tool:

```text
profile_project_risk
```

Then initialize project-local collaboration policy:

```text
init_project_collab
```

Recommended presets:

- `developer_safe`
- `config_governance`
- `developer_fast`
- `sandbox_full_auto`

### 5. Run A Complex Task

Preferred high-signal flow:

```text
analyze_requirement_clarity
build_execution_harness
create_plan
approve_plan
execute_approved_plan
record_run_evidence
plan_review_fix_loop
run_quality_gate
summarize_final_result
```

For Claude-led implementation with Codex review:

```text
implement_with_review
ask_codex_to_review
run_quality_gate
```

## Claude Code Slash Commands

The plugin includes explicit slash-command workflows:

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

These commands create structured task archives and paste-ready handoff/review prompts.

## Gateway Tool Highlights

Core control:

- `get_policy`
- `list_user_mode_presets`
- `apply_user_mode_preset`
- `set_policy_mode`
- `classify_risk`
- `health_check`
- `get_collab_status`
- `emergency_stop`

Cross-agent calls:

- `call_codex`
- `continue_codex`
- `call_claude_cli`
- `list_claude_tools`
- `call_claude_tool`

Human approval:

- `prepare_cross_agent_call`
- `confirm_cross_agent_call`
- `list_pending_calls`
- `explain_pending_confirmation`
- `approve_pending_call`
- `deny_pending_call`
- `get_pending_action_card`
- `approve_next_action`
- `deny_next_action`
- `revise_next_action`

Project workflow:

- `profile_project_risk`
- `init_project_collab`
- `start_project_task`
- `build_project_context_pack`
- `implement_with_review`
- `ask_codex_to_review`
- `ask_claude_to_validate_runtime`

Plan and run state:

- `analyze_requirement_clarity`
- `request_clarification`
- `list_task_mode_presets`
- `get_task_mode_preset`
- `build_execution_harness`
- `build_next_prompt_draft`
- `get_evidence_schema`
- `evaluate_stop_condition`
- `plan_review_fix_loop`
- `record_loop_failure`
- `create_plan`
- `revise_plan`
- `approve_plan`
- `execute_approved_plan`
- `start_collab_run`
- `get_collab_run`
- `advance_collab_run`
- `advance_task_loop`
- `record_run_evidence`
- `record_human_approval`
- `explain_missing_evidence`

Quality and reporting:

- `run_quality_gate`
- `select_quality_template`
- `explain_quality_failures`
- `summarize_final_result`
- `export_task_report`
- `generate_pr_summary`
- `generate_handoff_summary`

Recovery:

- `explain_error`
- `suggest_recovery`
- `retry_last_step`
- `rollback_last_change`

Dashboards:

- `get_user_dashboard`
- `get_dashboard_brief`
- `get_dashboard_detail`

See [docs/mcp-gateway.md](docs/mcp-gateway.md) for the full behavior model.

## Safety Model

This project is deliberately conservative.

It does not:

- store credentials,
- require shell hooks,
- silently expand permissions,
- silently approve high-risk cross-agent calls,
- print detected secret values in audit reports,
- or treat vague tasks as ready for execution.

It does:

- bind confirmations to exact request hashes,
- redact common secret patterns in audit logs,
- isolate project policy when `projectDir` or `cwd` is supplied,
- require confirmation for sensitive paths and tools,
- protect state record IDs from path traversal,
- provide cooperative file locks for write-heavy workflows,
- expose an emergency stop that pauses dispatch and cancels pending calls.

## When To Use It

Use this project when:

- you work with both Claude Code and Codex,
- you want one agent to implement and another to review,
- you need traceable approval before risky automation,
- you manage complex changes across many files,
- you want AI output quality to depend on evidence, not optimism,
- you care about rollback and auditability.

It is especially useful for:

- large refactors,
- configuration governance,
- MCP server work,
- agent workflow design,
- security-sensitive code reviews,
- PR preparation,
- multi-step feature delivery.

## Current Boundary

The gateway can coordinate Claude Code CLI and Codex through programmable MCP/CLI surfaces.

It cannot guarantee access to private desktop UI state that a platform does not expose. Codex Desktop should be treated as the human-facing control surface; Codex CLI/MCP should be treated as the programmable execution surface.

That boundary is intentional. It keeps the integration powerful without pretending to own user interface state it cannot safely verify.

## Documentation

- [MCP Gateway](docs/mcp-gateway.md)
- [Workflow](docs/workflow.md)
- [Task Collaboration Playbook](docs/task-collaboration-playbook.md)
- [Agent Capability Matrix](docs/agent-capability-matrix.md)
- [Task Archive Template](docs/task-archive-template.md)

## Verification

The verifier checks:

- tool exposure,
- risk classification,
- human confirmation flow,
- confirmation reuse prevention,
- project policy behavior,
- Claude tool risk handling,
- task archive creation,
- quality gate behavior,
- dashboard output,
- emergency stop,
- optional backend MCP handshakes.

Run:

```bash
node scripts/verify-mcp-gateway.mjs
node scripts/verify-mcp-gateway.mjs --deep
```

## Philosophy

The future of AI-assisted engineering is not one giant agent with unlimited permissions.

It is a disciplined system where different agents bring different strengths, the user can understand what is happening, and every meaningful action has context, approval, evidence, and a way back.

Claude Code-Codex-Collab MCP is built for that future.

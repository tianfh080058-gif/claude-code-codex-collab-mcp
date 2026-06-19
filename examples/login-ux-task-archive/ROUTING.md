# Task Routing

Routing Mode:
Dual-agent

Primary Agent:
Claude Code

Review Agent:
Codex

Why This Split:
Claude Code can inspect and implement in the app repo. Codex can independently review safety, validation, and rollback.

Allowed Scope:
Login UI and frontend state handling.

Forbidden Scope:
Secrets, authentication provider changes, database migrations, production permissions.

Sensitive Areas:
Authentication and privacy.

Recommended Next Step:
Run `/task-clarify <task-dir>`.

Requires User Confirmation:
yes

Pre-Execution Confirmation Checklist:
- Goal.
- Success criteria.
- In scope and out of scope.
- Validation.
- Rollback.

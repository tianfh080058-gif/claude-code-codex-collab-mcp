# Task Brief

Goal:
Improve a SaaS login experience and reduce first-time login failures.

Background:
Users sometimes fail to log in because error messages and recovery paths are unclear.

Audience / User:
New users and returning users who may need password recovery.

Success Criteria:
- Error messages are clearer without revealing whether an account exists.
- Password recovery is easier to find.
- Loading states are visible during login.
- Validation and rollback are documented.

In Scope:
- Login page copy.
- Frontend loading and error states.
- Password recovery entry point.

Out Of Scope:
- Authentication provider replacement.
- Database migration.
- Production permission changes.

Constraints:
- No secret values in task files.
- No auth API changes without separate confirmation.

Sensitive Areas:
- Authentication.
- Privacy.
- Analytics.

Initial Assumptions:
- Claude Code is primary for implementation.
- Codex is reviewer.

Open Questions:
- Which metric is the primary success indicator?

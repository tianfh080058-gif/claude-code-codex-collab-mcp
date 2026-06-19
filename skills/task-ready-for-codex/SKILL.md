---
name: task-ready-for-codex
description: Check whether a confirmed task archive can be handed to Codex desktop for review or execution.
argument-hint: "<task-dir>"
arguments: task_dir
disable-model-invocation: true
allowed-tools:
  - Read
  - Write
  - Bash
---

# /task-ready-for-codex

Prepare a Codex review or handoff package only after user confirmation is recorded.

## Readiness Gate

Read `$task_dir/DECISIONS.md`.

If it does not contain both:

- `Status: confirmed`
- `Formal execution allowed: yes`

then do not write `HANDOFF.md` or execution-ready `REVIEW.md`. Output the missing confirmation items and recommend `/task-confirm <task-dir>`.

## If Confirmed

Read the task archive and generate the appropriate package:

- If Codex is reviewer: write `REVIEW.md`.
- If Codex is primary executor: write `HANDOFF.md`.
- Always write `CODEX_PROMPT.md` with a ready-to-paste prompt for Codex desktop.

Include:

```md
# Codex Readiness Package

Task Archive:
Codex Role:
Goal:
Confirmed Scope:
Forbidden Scope:
Files / Systems Allowed:
Files / Systems Forbidden:
Risk Focus:
Validation Expected:
Rollback Expected:
Secrets Policy:
Human Dispatch Required:
```

## `CODEX_PROMPT.md` Template

```md
# Prompt Draft For Codex

请根据以下任务档案执行指定角色：

Task Archive:
Codex Role:

请先检查：
- 用户确认状态是否为 confirmed
- Formal execution allowed 是否为 yes
- 允许范围和禁止范围是否清楚
- 是否涉及 secrets、hooks、MCP、permissions、settings.local.json、删除或大规模移动
- 验证方式和回滚预期是否充分

如果 Codex Role 是 Reviewer：
- 请按高/中/低风险输出审查发现
- 优先检查安全、权限、配置、验证缺口和 rollback
- 不要修改文件，除非用户明确要求

如果 Codex Role 是 Primary Executor：
- 请先备份会修改的现有文件
- 请最小化补丁
- 请验证语法和安全边界
- 请输出 change report 和 rollback 指令

不要打印 secret 值。只报告文件、类型、风险和建议。
```

## Next Prompt Draft

At the end of the response, include:

```md
## Next Prompt Draft

Suggested user prompt for Codex:
请读取 `<task-dir>/CODEX_PROMPT.md`，并按其中的角色、范围、验证和回滚要求执行。若确认状态不是 confirmed，请停止并列出缺失确认项。
```

## Safety

- Do not call Codex.
- Do not include secret values.
- Do not modify target files.
- Sensitive areas still require separate approval even after general confirmation.

#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const pluginRoot = path.resolve(new URL("..", import.meta.url).pathname);
const projectRoot = path.resolve(pluginRoot, "..", "..");
const gateway = path.join(pluginRoot, "servers", "cross-agent-gateway.mjs");
const stateDir = path.join(
  os.tmpdir(),
  `codex-claude-collab-verify-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 10)}`,
);
const deep = process.argv.includes("--deep");

fs.mkdirSync(stateDir, { recursive: true });
if (deep && process.env.CODEX_CLAUDE_COLLAB_CODEX_HOME) {
  fs.mkdirSync(process.env.CODEX_CLAUDE_COLLAB_CODEX_HOME, { recursive: true });
}

const child = spawn("node", [gateway], {
  cwd: projectRoot,
  env: {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectRoot,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    CODEX_CLAUDE_COLLAB_STATE_DIR: stateDir,
    CODEX_CLAUDE_COLLAB_DEFAULT_MODE: "auto",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let nextId = 1;
let stdout = "";
let stderr = "";
const pending = new Map();

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString("utf8");
  let index;
  while ((index = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, index).trim();
    stdout = stdout.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
  }
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString("utf8");
});

child.on("exit", (code, signal) => {
  for (const waiter of pending.values()) {
    waiter.reject(new Error(`gateway exited with ${code ?? signal}; stderr=${stderr}`));
  }
  pending.clear();
});

function send(method, params = {}, timeoutMs = 30000) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out; stderr=${stderr}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function parseToolResult(result) {
  const text = result?.content?.[0]?.text || "{}";
  return JSON.parse(text);
}

async function callTool(name, args = {}, timeoutMs = 30000) {
  return parseToolResult(await send("tools/call", { name, arguments: args }, timeoutMs));
}

async function expectToolError(name, args = {}, pattern = /./) {
  try {
    await callTool(name, args);
  } catch (error) {
    if (!pattern.test(error.message || String(error))) throw error;
    return error;
  }
  throw new Error(`expected ${name} to fail`);
}

async function main() {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "verify-mcp-gateway", version: "0.1.0" },
  });
  notify("notifications/initialized");

  const listed = await send("tools/list");
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const required of [
    "call_codex",
    "call_claude_cli",
    "classify_risk",
    "health_check",
    "acquire_file_lock",
    "get_collab_status",
    "profile_project_risk",
    "emergency_stop",
    "ask_codex_to_review",
    "start_project_task",
    "build_project_context_pack",
    "run_quality_gate",
    "get_user_dashboard",
    "summarize_final_result",
    "implement_with_review",
    "analyze_requirement_clarity",
    "request_clarification",
    "start_collab_run",
    "get_collab_run",
    "advance_collab_run",
    "record_run_evidence",
    "create_plan",
    "approve_plan",
    "execute_approved_plan",
    "explain_pending_confirmation",
    "propose_changes",
    "select_quality_template",
    "explain_quality_failures",
    "suggest_recovery",
    "export_task_report",
    "recommend_agent_route",
    "get_dashboard_brief",
    "get_dashboard_detail",
  ]) {
    if (!names.has(required)) throw new Error(`missing tool: ${required}`);
  }

  const risk = await callTool("classify_risk", { prompt: "modify hooks and settings.local.json" });
  if (risk.riskLevel !== "L5") throw new Error(`expected L5 risk, got ${risk.riskLevel}`);

  const claudeToolRisk = await callTool("classify_risk", {
    target: "claude",
    tools: ["Bash"],
    arguments: { command: "rm -rf tmp" },
  });
  if (claudeToolRisk.riskLevel !== "L6") throw new Error(`expected L6 Claude Bash risk, got ${claudeToolRisk.riskLevel}`);

  const unclear = await callTool("analyze_requirement_clarity", { goal: "fix it" });
  if (unclear.status !== "needs_clarification") throw new Error("expected unclear task to need clarification");
  const clarify = await callTool("request_clarification", { goal: "fix it" });
  if (!clarify.questions?.length) throw new Error("expected clarification questions");

  const blockedWorkflow = await callTool("implement_with_review", {
    goal: "Fix vague issue",
    projectDir: projectRoot,
  });
  if (blockedWorkflow.status !== "needs_clarification") throw new Error("expected vague implementation to be blocked by clarity gate");

  await expectToolError("get_pending_call", { callId: "../policy" }, /unsafe characters/);
  await expectToolError("append_task_event", { taskId: "../../outside", actor: "verify", event: "probe" }, /unsafe characters/);

  const dangerRequest = await callTool("set_policy_mode", { mode: "danger" });
  if (dangerRequest.status !== "pending_confirmation") throw new Error("expected danger mode to require bound confirmation");
  const policyAfterDangerRequest = await callTool("get_policy");
  if (policyAfterDangerRequest.mode === "danger") throw new Error("danger mode should not be enabled without confirmed retry");

  const pendingCall = await callTool("call_codex", {
    prompt: "modify hooks and settings.local.json",
    cwd: projectRoot,
  });
  if (pendingCall.status !== "pending_confirmation") throw new Error("expected pending confirmation for high-risk call");

  const claudeToolPending = await callTool("call_claude_tool", {
    toolName: "Bash",
    arguments: { command: "pwd" },
    cwd: projectRoot,
  });
  if (claudeToolPending.status !== "pending_confirmation") throw new Error("expected Claude Bash tool call to require confirmation");

  const approvalCard = await callTool("explain_pending_confirmation", { callId: pendingCall.callId });
  if (!approvalCard.requiredConfirmationText) throw new Error("expected approval card confirmation text");

  const confirmed = await callTool("confirm_cross_agent_call", {
    callId: pendingCall.callId,
    confirmationText: pendingCall.requiredConfirmationText,
    approvedBy: "verify",
  });
  if (confirmed.status !== "confirmed") throw new Error("expected confirmation to succeed");

  const reusedConfirmation = await callTool("call_codex", {
    prompt: "modify a different sensitive MCP config",
    cwd: projectRoot,
    confirmedCallId: pendingCall.callId,
    confirmationText: pendingCall.requiredConfirmationText,
  });
  if (reusedConfirmation.status !== "pending_confirmation") {
    throw new Error("expected mismatched confirmed call to require a fresh confirmation");
  }

  const lock = await callTool("acquire_file_lock", {
    owner: "verify",
    files: ["plugins/codex-claude-collab/servers/cross-agent-gateway.mjs"],
    ttlSeconds: 60,
  });
  if (lock.status !== "locked") throw new Error(`expected locked, got ${lock.status}`);

  const health = await callTool("health_check", { deep }, deep ? 90000 : 30000);
  if (!health.server?.ok) throw new Error("gateway health is not ok");
  if (deep && (!health.backends?.codexMcpServer?.ok || !health.backends?.claudeMcpServe?.ok)) {
    throw new Error("expected deep backend MCP health checks to pass");
  }

  const profile = await callTool("profile_project_risk", { projectDir: projectRoot, maxFiles: 1000 });
  if (!profile.risk) throw new Error("expected project risk profile");

  const status = await callTool("get_collab_status", { projectDir: projectRoot, recentLimit: 5 });
  if (!status.userMessage) throw new Error("expected user-centered status message");

  const externalProjectDir = path.join(os.tmpdir(), `codex-claude-collab-archive-project-${Date.now()}`);
  fs.mkdirSync(path.join(externalProjectDir, ".codex-claude-collab"), { recursive: true });
  fs.writeFileSync(path.join(externalProjectDir, ".codex-claude-collab", "policy.json"), JSON.stringify({
    mode: "cautious",
    maxDelegationDepth: 3,
    alwaysConfirm: [],
    forbiddenPaths: [],
    allowedPaths: [],
    paused: false,
  }, null, 2));
  const projectPolicyPending = await callTool("call_claude_cli", {
    prompt: "summarize this project",
    cwd: externalProjectDir,
    intent: "read_only",
  });
  if (projectPolicyPending.status !== "pending_confirmation") throw new Error("expected project-level cautious policy to require confirmation");

  const externalArchivePending = await callTool("create_task_archive", {
    goal: "Verify external project archive",
    projectDir: externalProjectDir,
  });
  if (externalArchivePending.status !== "pending_confirmation") throw new Error("expected external archive write to require confirmation");
  await callTool("confirm_cross_agent_call", {
    callId: externalArchivePending.callId,
    confirmationText: externalArchivePending.requiredConfirmationText,
    approvedBy: "verify",
  });
  const externalArchive = await callTool("create_task_archive", {
    goal: "Verify external project archive",
    projectDir: externalProjectDir,
    confirmedCallId: externalArchivePending.callId,
    confirmationText: externalArchivePending.requiredConfirmationText,
  });
  if (externalArchive.status !== "created") throw new Error("expected confirmed external archive creation");
  const externalArchiveRead = await callTool("read_task_archive", {
    taskDir: externalArchive.taskDir,
    projectDir: externalProjectDir,
  });
  if (!externalArchiveRead.files?.["BRIEF.md"]) throw new Error("expected external archive to be readable with projectDir");

  const task = await callTool("start_project_task", {
    goal: "Improve gateway verification quality",
    projectDir: projectRoot,
    validation: ["node plugins/codex-claude-collab/scripts/verify-mcp-gateway.mjs"],
  });
  if (!task.plan?.executionSteps?.length) throw new Error("expected draft task plan");

  const context = await callTool("build_project_context_pack", { projectDir: projectRoot });
  if (!context.conventions) throw new Error("expected project context pack");

  const gate = await callTool("run_quality_gate", {
    goal: "Verify quality gate",
    validationSummary: "verifier passed",
    evidence: { validation: [{ command: "node verifier", exitCode: 0 }] },
    reviewed: true,
    reviewSummary: "self-check",
    rollbackSummary: "backups available",
    openRisks: [],
  });
  if (!gate.done) throw new Error("expected quality gate to pass with complete evidence");

  const dashboard = await callTool("get_user_dashboard", { projectDir: projectRoot, recentLimit: 5 });
  if (!dashboard.nextBestAction) throw new Error("expected dashboard next best action");

  const finalResult = await callTool("summarize_final_result", {
    goal: "Verify final result summary",
    summary: "Verification complete",
    validationSummary: "verifier passed",
    reviewed: true,
    reviewSummary: "self-check",
    rollbackSummary: "backups available",
    openRisks: [],
  });
  if (!finalResult.qualityGate?.done) throw new Error("expected final result quality gate to pass");

  const plan = await callTool("create_plan", {
    goal: "Improve gateway approval UX",
    projectDir: projectRoot,
    files: ["plugins/codex-claude-collab/servers/cross-agent-gateway.mjs"],
    successCriteria: ["Gateway requires confirmation before risky execution."],
    validation: ["node --check plugins/codex-claude-collab/servers/cross-agent-gateway.mjs"],
    rollback: "Restore the gateway server from .backups.",
  });
  if (plan.plan?.status !== "draft") throw new Error("expected draft saved plan");

  const run = await callTool("start_collab_run", { planId: plan.plan.planId });
  if (!["planned", "clarifying"].includes(run.run.state)) throw new Error("expected collaboration run state");
  if (run.run.state !== "planned") throw new Error("expected complete plan to start as planned");
  const advancedRun = await callTool("advance_collab_run", { runId: run.run.runId, nextState: "approved", actor: "verify", summary: "approved" });
  if (advancedRun.run.state !== "approved") throw new Error("expected run to advance to approved");
  const runEvidence = await callTool("record_run_evidence", {
    runId: run.run.runId,
    kind: "validation",
    evidence: { command: "node verifier", exitCode: 0 },
    summary: "validation passed",
  });
  if (!runEvidence.run.evidence?.length) throw new Error("expected run evidence to be recorded");
  const readRun = await callTool("get_collab_run", { runId: run.run.runId });
  if (readRun.runId !== run.run.runId) throw new Error("expected run readback");

  const timeline = await callTool("get_task_timeline", { taskId: plan.plan.planId });
  if (!timeline.events?.length) throw new Error("expected plan timeline event");

  const approvedPlan = await callTool("approve_plan", { planId: plan.plan.planId, approvedBy: "verify" });
  if (approvedPlan.plan.status !== "approved") throw new Error("expected approved plan");

  const planProgress = await callTool("summarize_task_progress", { taskId: plan.plan.planId });
  if (!planProgress.nextBestAction) throw new Error("expected task progress next best action");

  const planExecution = await callTool("execute_approved_plan", { planId: plan.plan.planId });
  if (!["pending_confirmation", undefined].includes(planExecution.dispatch?.dispatch?.status)) {
    throw new Error("expected approved plan execution to be prepared or pending");
  }

  const proposal = await callTool("propose_changes", {
    title: "Verify proposal flow",
    summary: "Change sensitive MCP config in a controlled way",
    projectDir: externalProjectDir,
    files: ["config.json"],
    patch: "Proposed documentation-only change",
    risks: ["Touches MCP configuration"],
    validation: ["python3 -m json.tool config.json >/dev/null"],
    rollback: "Restore from .backups timestamp.",
  });
  if (proposal.proposal?.status !== "proposed") throw new Error("expected saved proposal");

  const patchReview = await callTool("review_patch_plan", { proposalId: proposal.proposal.proposalId });
  if (!patchReview.requiresConfirmation) throw new Error("expected sensitive proposal to require confirmation");

  const approvedProposal = await callTool("approve_apply", { proposalId: proposal.proposal.proposalId, approvedBy: "verify" });
  if (approvedProposal.proposal.status !== "approved") throw new Error("expected approved proposal");

  const applyDispatch = await callTool("apply_confirmed_changes", { proposalId: proposal.proposal.proposalId });
  if (applyDispatch.dispatch.status !== "pending_confirmation") throw new Error("expected apply dispatch to require confirmation");
  const applyPending = await callTool("get_pending_call", { callId: applyDispatch.dispatch.callId });
  if (applyPending.request?.cwd !== externalProjectDir) throw new Error("expected proposal apply cwd to use proposal projectDir");

  const template = await callTool("select_quality_template", { template: "feature" });
  if (!template.checks.includes("validation")) throw new Error("expected quality template validation check");

  const failedGate = await callTool("run_quality_gate", {
    goal: "Incomplete gate",
    reviewed: false,
    openRisks: ["needs validation"],
  });
  const explainedFailures = await callTool("explain_quality_failures", { qualityGate: failedGate });
  if (!explainedFailures.failures?.length) throw new Error("expected quality failure explanations");

  const recovery = await callTool("suggest_recovery", {
    error: "attempt to write a readonly database",
    context: "Codex backend start",
  });
  if (!/CODEX_CLAUDE_COLLAB_CODEX_HOME/.test(recovery.suggestedFix)) throw new Error("expected Codex writable home recovery");

  const retry = await callTool("retry_last_step", { taskId: plan.plan.planId, reason: "verify retry flow" });
  if (retry.status !== "prepared") throw new Error("expected retry guidance");

  const rollback = await callTool("rollback_last_change", { proposalId: proposal.proposal.proposalId, taskId: plan.plan.planId });
  if (rollback.status !== "guidance_only") throw new Error("expected rollback guidance only");

  const report = await callTool("export_task_report", {
    taskId: plan.plan.planId,
    summary: "Verification report",
    changedFiles: ["plugins/codex-claude-collab/servers/cross-agent-gateway.mjs"],
    validationSummary: "verifier passed",
    reviewSummary: "self-check",
    rollbackSummary: "backups available",
    openRisks: [],
  });
  if (!report.markdown.includes("Collaboration Task Report")) throw new Error("expected exported task report markdown");

  const prSummary = await callTool("generate_pr_summary", {
    summary: "Verification changes",
    changedFiles: ["plugins/codex-claude-collab/scripts/verify-mcp-gateway.mjs"],
    validationSummary: "verifier passed",
    risks: [],
  });
  if (!prSummary.markdown.includes("## Summary")) throw new Error("expected PR summary markdown");

  const handoff = await callTool("generate_handoff_summary", {
    from: "claude-code",
    to: "codex",
    summary: "Ready for review",
    nextSteps: ["Review verifier output"],
    risks: [],
  });
  if (!handoff.markdown.includes("Handoff Summary")) throw new Error("expected handoff markdown");

  const route = await callTool("recommend_agent_route", {
    goal: "Audit Claude MCP permissions",
    files: ["settings.local.json"],
  });
  if (route.primaryAgent !== "codex") throw new Error("expected Codex route for config audit");

  const routeExplanation = await callTool("explain_agent_route", {
    goal: "Implement UI feature",
    files: ["src/App.tsx"],
  });
  if (!routeExplanation.userMessage) throw new Error("expected route explanation");

  const routeOverride = await callTool("override_agent_route", {
    taskId: plan.plan.planId,
    primaryAgent: "claude-code",
    reviewerAgent: "codex",
    reason: "verify override",
  });
  if (routeOverride.status !== "recorded") throw new Error("expected route override record");

  const briefDashboard = await callTool("get_dashboard_brief", { projectDir: projectRoot });
  if (typeof briefDashboard.pendingCount !== "number") throw new Error("expected brief dashboard pending count");

  const detailDashboard = await callTool("get_dashboard_detail", { projectDir: projectRoot, recentLimit: 5 });
  if (!detailDashboard.qualityHints?.length) throw new Error("expected detailed dashboard quality hints");

  const workflow = await callTool("implement_with_review", {
    goal: "Improve gateway verification quality",
    projectDir: projectRoot,
    files: ["plugins/codex-claude-collab/scripts/verify-mcp-gateway.mjs"],
    successCriteria: ["Verifier covers gateway workflow and safety gates."],
    validation: ["node plugins/codex-claude-collab/scripts/verify-mcp-gateway.mjs"],
    rollback: "Restore verifier from .backups.",
  });
  if (workflow.dispatch.status !== "pending_confirmation") throw new Error("expected implement_with_review to require confirmation");

  const stopped = await callTool("emergency_stop", { reason: "verify emergency stop" });
  if (stopped.status !== "stopped") throw new Error("expected emergency stop to engage");

  console.log(JSON.stringify({
    ok: true,
    tools: listed.tools.length,
    risk: risk.riskLevel,
    pendingCall: pendingCall.status,
    claudeToolPending: claudeToolPending.status,
    projectPolicy: projectPolicyPending.status,
    confirmationReuse: reusedConfirmation.status,
    lock: lock.status,
    projectRisk: profile.risk,
    statusMessage: status.userMessage,
    clarity: unclear.status,
    dangerMode: dangerRequest.status,
    externalArchive: externalArchive.status,
    taskPlan: task.plan.status,
    qualityGate: gate.done,
    dashboard: dashboard.nextBestAction,
    approvalCard: approvalCard.status,
    plan: approvedPlan.plan.status,
    run: readRun.state,
    proposal: approvedProposal.proposal.status,
    proposalCwd: applyPending.request?.cwd,
    qualityTemplate: template.template,
    failureCount: explainedFailures.failures.length,
    recovery: recovery.userMessage,
    report: report.markdown.split("\n")[0],
    route: route.primaryAgent,
    briefDashboard: briefDashboard.nextBestAction,
    implementWorkflow: workflow.dispatch.status,
    emergencyStop: stopped.status,
    deep,
    health,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
  });

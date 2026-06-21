#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_NAME = "codex-claude-cross-agent-gateway";
const SERVER_VERSION = "0.1.0";
const MODES = new Set(["cautious", "auto", "danger"]);
const RISK_LEVELS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"];
const QUALITY_TEMPLATES = {
  bugfix: ["goal", "validation", "review", "rollback", "risks"],
  feature: ["goal", "validation", "review", "rollback", "risks"],
  refactor: ["goal", "validation", "review", "rollback", "risks"],
  config: ["goal", "validation", "review", "rollback", "risks"],
  release: ["goal", "validation", "review", "rollback", "risks"],
  docs: ["goal", "validation", "review", "rollback", "risks"],
  security: ["goal", "validation", "review", "rollback", "risks"],
};
const HARNESS_VERSION = "2026-06-20";
const EVIDENCE_TYPES = [
  "validation",
  "changedFiles",
  "reviewFindings",
  "fixesApplied",
  "rollbackPlan",
  "screenshots",
  "logs",
  "humanApprovals",
  "openRisks",
];
const TASK_MODE_PRESETS = {
  bug_fix: {
    label: "Bug Fix",
    primaryAgent: "claude-code",
    reviewerAgent: "codex",
    qualityTemplate: "bugfix",
    maxReviewFixRounds: 2,
    maxFailures: 2,
    requireHumanAfterHighRiskFinding: true,
    requiredEvidence: ["validation", "changedFiles", "reviewFindings", "rollbackPlan"],
    approvalFocus: ["scope", "validation", "rollback"],
  },
  feature_delivery: {
    label: "Feature Delivery",
    primaryAgent: "claude-code",
    reviewerAgent: "codex",
    qualityTemplate: "feature",
    maxReviewFixRounds: 2,
    maxFailures: 2,
    requireHumanAfterHighRiskFinding: true,
    requiredEvidence: ["validation", "changedFiles", "reviewFindings", "rollbackPlan", "humanApprovals"],
    approvalFocus: ["scope", "success criteria", "validation", "rollback"],
  },
  refactor: {
    label: "Refactor",
    primaryAgent: "claude-code",
    reviewerAgent: "codex",
    qualityTemplate: "refactor",
    maxReviewFixRounds: 3,
    maxFailures: 2,
    requireHumanAfterHighRiskFinding: true,
    requiredEvidence: ["validation", "changedFiles", "reviewFindings", "rollbackPlan"],
    approvalFocus: ["affected files", "behavior preservation", "validation"],
  },
  security_review: {
    label: "Security Review",
    primaryAgent: "codex",
    reviewerAgent: "claude-code",
    qualityTemplate: "security",
    maxReviewFixRounds: 1,
    maxFailures: 1,
    requireHumanAfterHighRiskFinding: true,
    requiredEvidence: ["reviewFindings", "humanApprovals", "rollbackPlan", "openRisks"],
    approvalFocus: ["risk", "secret handling", "permissions", "human acceptance"],
  },
  config_governance: {
    label: "Configuration Governance",
    primaryAgent: "codex",
    reviewerAgent: "claude-code",
    qualityTemplate: "config",
    maxReviewFixRounds: 2,
    maxFailures: 1,
    requireHumanAfterHighRiskFinding: true,
    requiredEvidence: ["validation", "changedFiles", "reviewFindings", "rollbackPlan", "humanApprovals"],
    approvalFocus: ["MCP config", "hooks", "permissions", "local settings", "rollback"],
  },
  docs_only: {
    label: "Docs Only",
    primaryAgent: "claude-code",
    reviewerAgent: "codex",
    qualityTemplate: "docs",
    maxReviewFixRounds: 1,
    maxFailures: 2,
    requireHumanAfterHighRiskFinding: false,
    requiredEvidence: ["changedFiles", "reviewFindings", "rollbackPlan"],
    approvalFocus: ["scope", "accuracy", "links"],
  },
  sandbox_experiment: {
    label: "Sandbox Experiment",
    primaryAgent: "claude-code",
    reviewerAgent: "codex",
    qualityTemplate: "feature",
    maxReviewFixRounds: 1,
    maxFailures: 2,
    requireHumanAfterHighRiskFinding: true,
    requiredEvidence: ["validation", "changedFiles", "openRisks"],
    approvalFocus: ["sandbox boundary", "cleanup", "known risks"],
  },
};
const POLICY_PRESETS = {
  developer_safe: {
    mode: "auto",
    alwaysConfirm: ["deploy", ".env", "secrets", "credentials", "hooks", ".mcp.json", "settings.local.json", "delete", "sudo"],
    forbiddenPaths: [".env", ".env.local", ".ssh", ".aws", "node_modules", ".git"],
  },
  developer_fast: {
    mode: "auto",
    alwaysConfirm: [".env", "credentials", "permission_expansion", "delete", "sudo"],
    forbiddenPaths: [".env", ".env.local", ".ssh", ".aws", ".git"],
  },
  config_governance: {
    mode: "cautious",
    alwaysConfirm: ["settings.local.json", "hooks", ".mcp.json", "mcp_config", "permission_expansion", "delete", "sudo", "secrets", "credentials"],
    forbiddenPaths: [".env", ".ssh", ".aws", "history.jsonl", "sessions", "telemetry"],
  },
  sandbox_full_auto: {
    mode: "danger",
    alwaysConfirm: [],
    forbiddenPaths: [".ssh", ".aws"],
  },
  solo_developer_safe: {
    mode: "auto",
    alwaysConfirm: ["deploy", ".env", "secrets", "credentials", "hooks", ".mcp.json", "settings.local.json", "delete", "sudo"],
    forbiddenPaths: [".env", ".env.local", ".ssh", ".aws", "node_modules", ".git"],
  },
  fast_local_iteration: {
    mode: "auto",
    alwaysConfirm: [".env", "credentials", "permission_expansion", "delete", "sudo", "deploy"],
    forbiddenPaths: [".env", ".env.local", ".ssh", ".aws", ".git"],
  },
  sandbox_autonomous: {
    mode: "danger",
    alwaysConfirm: [],
    forbiddenPaths: [".ssh", ".aws", ".env", ".env.local"],
  },
  enterprise_review: {
    mode: "cautious",
    alwaysConfirm: ["deploy", "release", ".env", "secrets", "credentials", "hooks", ".mcp.json", "settings.local.json", "permission_expansion", "delete", "sudo"],
    forbiddenPaths: [".env", ".env.local", ".ssh", ".aws", "history.jsonl", "sessions", "telemetry", ".git"],
  },
};
const USER_MODE_PRESETS = {
  solo_developer_safe: {
    label: "Solo Developer Safe",
    policyPreset: "solo_developer_safe",
    bestFor: "Daily real-project work where Claude implements and Codex reviews.",
    tradeoff: "Balanced speed with confirmation for secrets, hooks, deploys, deletes, and permission changes.",
  },
  fast_local_iteration: {
    label: "Fast Local Iteration",
    policyPreset: "fast_local_iteration",
    bestFor: "Local feature and bug-fix loops in non-production code.",
    tradeoff: "Fewer prompts for ordinary edits, but still confirms destructive or credential-adjacent actions.",
  },
  config_governance: {
    label: "Configuration Governance",
    policyPreset: "config_governance",
    bestFor: "Claude/Codex/MCP/settings/hooks governance work.",
    tradeoff: "Most conservative practical mode; expects frequent human review.",
  },
  sandbox_autonomous: {
    label: "Sandbox Autonomous",
    policyPreset: "sandbox_autonomous",
    bestFor: "Disposable experiments where speed matters more than review overhead.",
    tradeoff: "Danger mode removes gateway confirmation checks after explicit setup confirmation.",
  },
  enterprise_review: {
    label: "Enterprise Review",
    policyPreset: "enterprise_review",
    bestFor: "Shared repositories, compliance-sensitive work, and production-adjacent changes.",
    tradeoff: "Cautious by default; slower but easier to audit.",
  },
};

const projectRoot = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const pluginRoot = path.resolve(process.env.CLAUDE_PLUGIN_ROOT || path.dirname(path.dirname(new URL(import.meta.url).pathname)));
const stateRoot = path.resolve(
  process.env.CODEX_CLAUDE_COLLAB_STATE_DIR ||
    process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), ".claude", "plugins", "data", "codex-claude-collab"),
);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function readJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function slugify(text) {
  return String(text || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "task";
}

function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function redact(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED GITHUB TOKEN]")
    .replace(/\b(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED AWS ACCESS KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED JWT]")
    .replace(/(api[_-]?key|token|secret|password|passwd|authorization|bearer|cookie|session)(["':=]+\s*)([^\s"',}]+)/gi, "$1$2[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED API KEY]")
    .replace(/\b[A-Za-z0-9_-]{80,}={0,2}\b/g, "[REDACTED HIGH-ENTROPY STRING]");
}

function redactStructured(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactStructured(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStructured(item)]));
  }
  return value;
}

function stableForHash(value) {
  if (Array.isArray(value)) return value.map(stableForHash);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableForHash(value[key])]));
  }
  return value;
}

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableForHash(value))).digest("hex");
}

function policyFile() {
  return path.join(stateRoot, "policy.json");
}

function projectPolicyDir(projectDir = projectRoot) {
  return path.join(path.resolve(projectDir), ".codex-claude-collab");
}

function projectPolicyFile(projectDir = projectRoot) {
  return path.join(projectPolicyDir(projectDir), "policy.json");
}

function loadProjectPolicy(projectDir = projectRoot) {
  return readJson(projectPolicyFile(projectDir), {});
}

function loadPolicy(projectDir = projectRoot) {
  const fallback = {
    mode: process.env.CODEX_CLAUDE_COLLAB_DEFAULT_MODE || "auto",
    maxDelegationDepth: 3,
    maxReviewFixRounds: 2,
    requireRollbackForWrites: true,
    alwaysConfirm: [
      "settings.local.json",
      "hooks",
      ".mcp.json",
      "mcp_config",
      "permission_expansion",
      "delete",
      "sudo",
      "secrets",
      "credentials",
    ],
    forbiddenPaths: [],
    allowedPaths: [],
    paused: false,
  };
  const projectPolicy = loadProjectPolicy(projectDir || projectRoot);
  const statePolicy = readJson(policyFile(), {});
  const policy = { ...fallback, ...projectPolicy, ...statePolicy };
  policy.alwaysConfirm = statePolicy.alwaysConfirm || projectPolicy.alwaysConfirm || fallback.alwaysConfirm;
  policy.forbiddenPaths = statePolicy.forbiddenPaths || projectPolicy.forbiddenPaths || fallback.forbiddenPaths;
  policy.allowedPaths = statePolicy.allowedPaths || projectPolicy.allowedPaths || fallback.allowedPaths;
  if (!MODES.has(policy.mode)) policy.mode = "auto";
  return policy;
}

function savePolicy(policy) {
  writeJson(policyFile(), policy);
}

function audit(entry) {
  ensureDir(path.join(stateRoot, "audit"));
  const line = JSON.stringify({ time: nowIso(), ...entry }) + "\n";
  fs.appendFileSync(path.join(stateRoot, "audit", "gateway.jsonl"), redact(line));
}

function riskScoreFromLevel(level) {
  const idx = RISK_LEVELS.indexOf(level);
  return idx >= 0 ? idx : 0;
}

function textFromInput(input = {}) {
  return [
    input.intent,
    input.prompt,
    input.requestedCapability,
    input.target,
    input.arguments ? JSON.stringify(input.arguments) : "",
    ...(input.files || []),
    ...(input.tools || []),
    ...(input.commands || []),
  ]
    .filter(Boolean)
    .join("\n");
}

function pathMatchesAny(file, patterns = []) {
  const normalized = String(file || "").replaceAll("\\", "/").toLowerCase();
  return patterns.some((pattern) => normalized.includes(String(pattern || "").replaceAll("\\", "/").toLowerCase()));
}

function policyPathFindings(input = {}, policy = loadPolicy()) {
  const files = input.files || [];
  const forbidden = files.filter((file) => pathMatchesAny(file, policy.forbiddenPaths || []));
  const allowedPaths = policy.allowedPaths || [];
  const outsideAllowed = allowedPaths.length
    ? files.filter((file) => !pathMatchesAny(file, allowedPaths))
    : [];
  return { forbidden, outsideAllowed };
}

function matchesPattern(text, pattern) {
  const normalizedPattern = String(pattern || "").toLowerCase().trim();
  if (!normalizedPattern) return false;
  const normalizedText = text.toLowerCase();
  if (normalizedPattern.startsWith("regex:")) {
    try {
      return new RegExp(normalizedPattern.slice(6), "i").test(text);
    } catch {
      return false;
    }
  }
  return normalizedText.includes(normalizedPattern);
}

function classifyRisk(input = {}) {
  const rawText = textFromInput(input);
  const haystack = rawText.toLowerCase();

  const reasons = [];
  let level = "L1";

  const bump = (next, reason) => {
    if (riskScoreFromLevel(next) > riskScoreFromLevel(level)) level = next;
    reasons.push(reason);
  };

  if (!haystack.trim()) return { riskLevel: "L0", reasons: ["No action content supplied."], sensitive: false };
  if (/(read|list|inspect|review|audit|summari[sz]e)/.test(haystack)) bump("L2", "Read-only or review-like request.");
  if (/(edit|write|patch|apply|modify|update|create file|run command|shell|bash)/.test(haystack)) bump("L4", "Request may mutate files or run commands.");
  if (/(settings\.local\.json|\.mcp\.json|\bmcp\b|hook|permission|allowlist|approval|credential|secret|token|api[_-]?key|password|cookie|session)/.test(haystack)) {
    bump("L5", "Request touches sensitive configuration, credentials, permissions, hooks, or MCP.");
  }
  if (/(rm\s+-rf|find\b.*-delete|git\s+reset\s+--hard|git\s+clean\s+-fdx|chmod\s+-r\s+777|chown\s+-r|sudo\b|dangerously-skip-permissions|danger-full-access|bypasspermissions)/.test(haystack)) {
    bump("L6", "Request includes destructive, broad-permission, or bypass-permission behavior.");
  }
  const toolNames = (input.tools || []).map((toolName) => String(toolName).toLowerCase());
  if (toolNames.some((toolName) => ["bash", "edit", "write", "notebookedit"].includes(toolName))) {
    bump("L5", "Request uses a Claude tool that can execute commands or mutate files.");
  }
  if (toolNames.some((toolName) => ["webfetch", "websearch"].includes(toolName))) {
    bump("L4", "Request uses a Claude tool with network or external information access.");
  }

  const policy = loadPolicy(input.projectDir || input.cwd || projectRoot);
  const matchedAlwaysConfirm = (policy.alwaysConfirm || []).filter((pattern) => matchesPattern(rawText, pattern));
  if (matchedAlwaysConfirm.length) bump("L5", `Matched alwaysConfirm policy: ${matchedAlwaysConfirm.join(", ")}`);
  const pathFindings = policyPathFindings(input, policy);
  if (pathFindings.forbidden.length) bump("L6", `Touches forbidden paths: ${pathFindings.forbidden.join(", ")}`);
  if (pathFindings.outsideAllowed.length) bump("L5", `Touches paths outside allowedPaths: ${pathFindings.outsideAllowed.join(", ")}`);

  return {
    riskLevel: level,
    reasons: [...new Set(reasons)],
    sensitive: riskScoreFromLevel(level) >= 5,
    matchedAlwaysConfirm,
    pathFindings,
  };
}

function requiresConfirmation(policy, riskLevel, options = {}) {
  if (policy.mode === "danger") return false;
  if (policy.mode === "cautious") return Boolean(options.crossAgent ?? true);
  return riskScoreFromLevel(riskLevel) >= 5;
}

function makeCallId() {
  return `call-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeCallRequest(input = {}) {
  return {
    target: input.target,
    prompt: input.prompt || "",
    cwd: input.cwd || projectRoot,
    requestedCapability: input.requestedCapability || "",
    files: input.files || [],
    tools: input.tools || [],
    commands: input.commands || [],
    arguments: input.arguments || {},
    intent: input.intent || "",
    traceId: input.traceId || "",
    parentCallId: input.parentCallId || "",
    depth: Number(input.depth || 0),
  };
}

function pendingFile(callId) {
  return safeJsonFile(pendingCallsDir(), callId, "callId");
}

function savePending(call) {
  writeJson(pendingFile(call.callId), call);
}

function loadPending(callId) {
  return readJson(pendingFile(callId), null);
}

function humanPhrase(callId) {
  return `I, the human user, approve ${callId}`;
}

function buildPendingCall(input, risk) {
  const callId = makeCallId();
  const request = normalizeCallRequest(input);
  const call = {
    callId,
    createdAt: nowIso(),
    status: "pending_confirmation",
    mode: loadPolicy().mode,
    risk,
    request: redactStructured(request),
    requestHash: hashObject(request),
    requiredConfirmationText: humanPhrase(callId),
    preflight: buildPreflight(input, risk),
  };
  savePending(call);
  audit({ type: "pending_cross_agent_call", callId, risk });
  return call;
}

function buildPreflight(input = {}, risk = classifyRisk(input)) {
  const target = input.target || "unknown";
  const action = input.requestedCapability || input.intent || "cross-agent call";
  return {
    userMessage: `${target} is requesting ${action}. Human confirmation is required before this runs.`,
    target,
    action,
    riskLevel: risk.riskLevel,
    reasons: risk.reasons || [],
    files: input.files || [],
    cwd: input.cwd || projectRoot,
    ifDenied: "No cross-agent execution will run; pending call remains canceled or unconfirmed.",
    recommendation: riskScoreFromLevel(risk.riskLevel) >= 5
      ? "Approve only after reviewing scope, affected files, and rollback expectations."
      : "This looks low risk, but cautious mode still requires confirmation.",
  };
}

function callDepth(input = {}) {
  return Number(input.depth || 0);
}

function assertDelegationAllowed(input = {}) {
  const policy = loadPolicy();
  if (policy.paused) throw new Error("Cross-agent collaboration is paused. Use resume_collaboration before dispatching new calls.");
  const depth = callDepth(input);
  if (depth > Number(policy.maxDelegationDepth || 3)) {
    throw new Error(`Delegation depth ${depth} exceeds maxDelegationDepth ${policy.maxDelegationDepth || 3}`);
  }
}

function taskRoot(projectDir = projectRoot) {
  return path.join(path.resolve(projectDir), "reports", "tasks");
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isInsideOrSame(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return resolvedParent === resolvedChild || isInside(resolvedParent, resolvedChild);
}

function assertSafeRecordId(id, label = "record id") {
  const value = String(id || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} contains unsafe characters`);
  }
  return value;
}

function safeJsonFile(baseDir, id, label = "record id") {
  const safeId = assertSafeRecordId(id, label);
  const base = path.resolve(baseDir);
  const file = path.resolve(base, `${safeId}.json`);
  if (!isInsideOrSame(base, file)) throw new Error(`${label} resolves outside its state directory`);
  return file;
}

function resolveTaskRoot(projectDir) {
  return taskRoot(projectDir || projectRoot);
}

function safeTaskDir(taskDir, projectDir) {
  const root = resolveTaskRoot(projectDir);
  const base = path.resolve(projectDir || projectRoot);
  const resolved = path.isAbsolute(taskDir) ? path.resolve(taskDir) : path.resolve(base, taskDir);
  if (!isInside(root, resolved) && path.resolve(root) !== resolved) {
    throw new Error("taskDir must point inside reports/tasks");
  }
  return resolved;
}

function pendingCallsDir() {
  return path.join(stateRoot, "pending-calls");
}

function recordFile(kind, id) {
  return safeJsonFile(path.join(stateRoot, kind), id, `${kind} id`);
}

function saveRecord(kind, id, data) {
  writeJson(recordFile(kind, id), data);
}

function loadRecord(kind, id) {
  return readJson(recordFile(kind, id), null);
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function locksFile() {
  return path.join(stateRoot, "locks.json");
}

function withLocksMutation(mutator) {
  const lockPath = `${locksFile()}.lock`;
  ensureDir(path.dirname(lockPath));
  let fd;
  const deadline = Date.now() + 5000;
  while (!fd) {
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 30000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          // Fall through to retry below.
        }
        if (Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
          continue;
        }
      }
      throw new Error("locks file is busy; retry the lock operation");
    }
  }
  try {
    return mutator();
  } finally {
    if (fd) fs.closeSync(fd);
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Best effort cleanup; stale lock handling above covers abandoned files.
    }
  }
}

function loadLocks() {
  const locks = readJson(locksFile(), []);
  const now = Date.now();
  const active = locks.filter((lock) => !lock.expiresAt || Date.parse(lock.expiresAt) > now);
  if (active.length !== locks.length) writeJson(locksFile(), active);
  return active;
}

function saveLocks(locks) {
  writeJson(locksFile(), locks);
}

function normalizeFiles(files = []) {
  return files.map((file) => path.resolve(projectRoot, file));
}

function filesOverlap(a = [], b = []) {
  const left = normalizeFiles(a);
  const right = normalizeFiles(b);
  return left.some((x) => right.some((y) => x === y || isInside(x, y) || isInside(y, x)));
}

class McpFramer {
  constructor(onMessage) {
    this.buffer = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const asText = this.buffer.toString("utf8", 0, Math.min(this.buffer.length, 32));
      if (/^content-length:/i.test(asText)) {
        const headerEnd = this.buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = this.buffer.slice(0, headerEnd).toString("utf8");
        const match = header.match(/content-length:\s*(\d+)/i);
        if (!match) throw new Error("MCP frame missing Content-Length header");
        const length = Number(match[1]);
        const messageStart = headerEnd + 4;
        const messageEnd = messageStart + length;
        if (this.buffer.length < messageEnd) return;
        const payload = this.buffer.slice(messageStart, messageEnd).toString("utf8");
        this.buffer = this.buffer.slice(messageEnd);
        this.onMessage(JSON.parse(payload), "content-length");
        continue;
      }

      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const line = this.buffer.slice(0, lineEnd).toString("utf8").trim();
      this.buffer = this.buffer.slice(lineEnd + 1);
      if (!line) continue;
      this.onMessage(JSON.parse(line), "line");
    }
  }
}

function encodeMessage(message, mode = "content-length") {
  if (mode === "line") return Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"), payload]);
}

let serverTransportMode = "line";

function send(message) {
  process.stdout.write(encodeMessage(message, serverTransportMode));
}

class StdioMcpClient {
  constructor(command, args, options = {}) {
    this.command = command;
    this.args = args;
    this.cwd = options.cwd || projectRoot;
    this.env = { ...process.env, ...(options.env || {}) };
    this.nextId = 1;
    this.pending = new Map();
  }

  async start(timeoutMs = 30000) {
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.stderr = "";
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString("utf8");
    });
    const framer = new McpFramer((message) => this.handleMessage(message));
    this.child.stdout.on("data", (chunk) => framer.push(chunk));
    this.child.on("exit", (code, signal) => {
      for (const { reject } of this.pending.values()) reject(new Error(`${this.command} exited with ${code ?? signal}`));
      this.pending.clear();
    });
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    }, timeoutMs);
    this.notify("notifications/initialized", {});
  }

  handleMessage(message) {
    if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else pending.resolve(message.result);
  }

  request(method, params = {}, timeoutMs = 600000) {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms${this.stderr ? `; stderr: ${redact(this.stderr).slice(0, 1000)}` : ""}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(encodeMessage(message, "line"));
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }, "line"));
  }

  async listTools(timeoutMs = 60000) {
    return this.request("tools/list", {}, timeoutMs);
  }

  async callTool(name, args = {}, timeoutMs = 600000) {
    return this.request("tools/call", { name, arguments: args }, timeoutMs);
  }

  stop() {
    if (this.child && !this.child.killed) this.child.kill();
  }
}

function resultText(data) {
  return {
    content: [{ type: "text", text: redact(typeof data === "string" ? data : JSON.stringify(data, null, 2)) }],
  };
}

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

const tools = [
  tool("get_policy", "Return the active cross-agent HITL policy and state directory.", {
    type: "object",
    properties: {},
  }),
  tool("list_user_mode_presets", "List user-facing collaboration modes and their policy tradeoffs.", {
    type: "object",
    properties: {},
  }),
  tool("apply_user_mode_preset", "Apply a user-facing collaboration mode to the current or supplied project.", {
    type: "object",
    properties: {
      userMode: { type: "string", enum: ["solo_developer_safe", "fast_local_iteration", "config_governance", "sandbox_autonomous", "enterprise_review"] },
      projectDir: { type: "string" },
      overwrite: { type: "boolean" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["userMode"],
  }),
  tool("set_policy_mode", "Set gateway mode: cautious, auto, or danger. Danger mode requires explicit confirmation text.", {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["cautious", "auto", "danger"] },
      confirmationText: { type: "string" },
      confirmedCallId: { type: "string" },
    },
    required: ["mode"],
  }),
  tool("classify_risk", "Classify risk for a proposed cross-agent action.", {
    type: "object",
    properties: {
      intent: { type: "string" },
      prompt: { type: "string" },
      requestedCapability: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      tools: { type: "array", items: { type: "string" } },
      commands: { type: "array", items: { type: "string" } },
    },
  }),
  tool("prepare_cross_agent_call", "Prepare a Claude/Codex cross-agent call and return the confirmation requirement.", {
    type: "object",
    properties: {
      target: { type: "string", enum: ["codex", "claude"] },
      prompt: { type: "string" },
      requestedCapability: { type: "string" },
      cwd: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      tools: { type: "array", items: { type: "string" } },
      commands: { type: "array", items: { type: "string" } },
      intent: { type: "string", enum: ["read_only", "propose_patch", "mutate", "validate"] },
      traceId: { type: "string" },
      parentCallId: { type: "string" },
      depth: { type: "integer", minimum: 0 },
    },
    required: ["target", "prompt"],
  }),
  tool("confirm_cross_agent_call", "Confirm a prepared cross-agent call using the exact human confirmation text.", {
    type: "object",
    properties: {
      callId: { type: "string" },
      confirmationText: { type: "string" },
      approvedBy: { type: "string" },
    },
    required: ["callId", "confirmationText"],
  }),
  tool("call_codex", "Run a Codex session through `codex mcp-server`, subject to the active HITL policy.", {
    type: "object",
    properties: {
      prompt: { type: "string" },
      cwd: { type: "string" },
      sandbox: { type: "string", enum: ["read-only", "workspace-write", "danger-full-access"] },
      approvalPolicy: { type: "string", enum: ["untrusted", "on-request", "never"] },
      model: { type: "string" },
      profile: { type: "string" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
      intent: { type: "string", enum: ["read_only", "propose_patch", "mutate", "validate"] },
      files: { type: "array", items: { type: "string" } },
      traceId: { type: "string" },
      parentCallId: { type: "string" },
      depth: { type: "integer", minimum: 0 },
    },
    required: ["prompt"],
  }),
  tool("continue_codex", "Continue a Codex MCP thread through `codex-reply`, subject to the active HITL policy.", {
    type: "object",
    properties: {
      threadId: { type: "string" },
      prompt: { type: "string" },
      cwd: { type: "string" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
      traceId: { type: "string" },
      parentCallId: { type: "string" },
      depth: { type: "integer", minimum: 0 },
    },
    required: ["threadId", "prompt"],
  }),
  tool("call_claude_cli", "Run Claude Code non-interactively via `claude --print`, subject to the active HITL policy.", {
    type: "object",
    properties: {
      prompt: { type: "string" },
      cwd: { type: "string" },
      permissionMode: { type: "string", enum: ["default", "acceptEdits", "auto", "bypassPermissions", "dontAsk", "plan"] },
      model: { type: "string" },
      outputFormat: { type: "string", enum: ["text", "json"] },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
      intent: { type: "string", enum: ["read_only", "propose_patch", "mutate", "validate"] },
      files: { type: "array", items: { type: "string" } },
      traceId: { type: "string" },
      parentCallId: { type: "string" },
      depth: { type: "integer", minimum: 0 },
    },
    required: ["prompt"],
  }),
  tool("list_claude_tools", "List tools exposed by `claude mcp serve`.", {
    type: "object",
    properties: { cwd: { type: "string" } },
  }),
  tool("call_claude_tool", "Call a specific tool exposed by `claude mcp serve`, subject to the active HITL policy.", {
    type: "object",
    properties: {
      toolName: { type: "string" },
      arguments: { type: "object" },
      cwd: { type: "string" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
      intent: { type: "string", enum: ["read_only", "propose_patch", "mutate", "validate"] },
      files: { type: "array", items: { type: "string" } },
      traceId: { type: "string" },
      parentCallId: { type: "string" },
      depth: { type: "integer", minimum: 0 },
    },
    required: ["toolName"],
  }),
  tool("create_task_archive", "Create a shared task archive under reports/tasks with core files.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      primaryAgent: { type: "string" },
      reviewerAgent: { type: "string" },
      projectDir: { type: "string" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["goal"],
  }),
  tool("list_task_archives", "List task archives under reports/tasks.", {
    type: "object",
    properties: { projectDir: { type: "string" } },
  }),
  tool("read_task_archive", "Read core files from a task archive with secret redaction.", {
    type: "object",
    properties: { taskDir: { type: "string" }, projectDir: { type: "string" } },
    required: ["taskDir"],
  }),
  tool("append_activity", "Append an activity entry to a task archive ACTIVITY.md.", {
    type: "object",
    properties: {
      taskDir: { type: "string" },
      projectDir: { type: "string" },
      actor: { type: "string" },
      summary: { type: "string" },
      details: { type: "string" },
    },
    required: ["taskDir", "actor", "summary"],
  }),
  tool("list_pending_calls", "List pending or confirmed cross-agent calls.", {
    type: "object",
    properties: { status: { type: "string" } },
  }),
  tool("get_pending_call", "Read one pending call record by callId.", {
    type: "object",
    properties: { callId: { type: "string" } },
    required: ["callId"],
  }),
  tool("cancel_pending_call", "Cancel one pending cross-agent call.", {
    type: "object",
    properties: { callId: { type: "string" }, reason: { type: "string" } },
    required: ["callId"],
  }),
  tool("list_audit_events", "Read recent gateway audit events with redaction.", {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 200 } },
  }),
  tool("acquire_file_lock", "Acquire a cooperative file lock for cross-agent writes.", {
    type: "object",
    properties: {
      owner: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      ttlSeconds: { type: "integer", minimum: 30, maximum: 86400 },
      reason: { type: "string" },
    },
    required: ["owner", "files"],
  }),
  tool("release_file_lock", "Release a cooperative file lock by lockId.", {
    type: "object",
    properties: { lockId: { type: "string" }, owner: { type: "string" } },
    required: ["lockId"],
  }),
  tool("list_file_locks", "List active cooperative file locks.", {
    type: "object",
    properties: {},
  }),
  tool("health_check", "Check gateway, CLI, and optional backend MCP health.", {
    type: "object",
    properties: { deep: { type: "boolean" } },
  }),
  tool("init_project_collab", "Create a project-level collaboration policy preset for a real project.", {
    type: "object",
    properties: {
      projectDir: { type: "string" },
      preset: { type: "string", enum: ["developer_safe", "developer_fast", "config_governance", "sandbox_full_auto", "solo_developer_safe", "fast_local_iteration", "sandbox_autonomous", "enterprise_review"] },
      overwrite: { type: "boolean" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
  }),
  tool("profile_project_risk", "Scan project structure for sensitive areas without printing secret values.", {
    type: "object",
    properties: {
      projectDir: { type: "string" },
      maxFiles: { type: "integer", minimum: 100, maximum: 20000 },
    },
  }),
  tool("get_collab_status", "Return a user-centered summary of current collaboration state.", {
    type: "object",
    properties: { projectDir: { type: "string" }, recentLimit: { type: "integer", minimum: 1, maximum: 50 } },
  }),
  tool("pause_collaboration", "Pause new cross-agent dispatches while preserving state and logs.", {
    type: "object",
    properties: { reason: { type: "string" } },
  }),
  tool("resume_collaboration", "Resume cross-agent dispatches after a pause or emergency stop.", {
    type: "object",
    properties: { reason: { type: "string" } },
  }),
  tool("emergency_stop", "Switch to cautious mode, pause dispatches, cancel pending calls, and release locks.", {
    type: "object",
    properties: { reason: { type: "string" } },
  }),
  tool("ask_codex_to_review", "High-level user intent wrapper: ask Codex to review files or a task in read-only mode.", {
    type: "object",
    properties: {
      prompt: { type: "string" },
      cwd: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["prompt"],
  }),
  tool("ask_codex_to_audit_config", "High-level user intent wrapper: ask Codex to audit configuration risk.", {
    type: "object",
    properties: {
      prompt: { type: "string" },
      cwd: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["prompt"],
  }),
  tool("ask_claude_to_validate_runtime", "High-level user intent wrapper: ask Claude Code to validate runtime behavior.", {
    type: "object",
    properties: {
      prompt: { type: "string" },
      cwd: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["prompt"],
  }),
  tool("start_project_task", "Create a user-centered task plan for complex project work without executing it.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      projectDir: { type: "string" },
      scope: { type: "array", items: { type: "string" } },
      nonGoals: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      primaryAgent: { type: "string" },
      reviewerAgent: { type: "string" },
    },
    required: ["goal"],
  }),
  tool("build_project_context_pack", "Build a compact context pack for Claude/Codex before complex work.", {
    type: "object",
    properties: {
      projectDir: { type: "string" },
    },
  }),
  tool("run_quality_gate", "Evaluate whether supplied task evidence is good enough to close.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      taskDir: { type: "string" },
      validation: { type: "array", items: { type: "string" } },
      validationSummary: { type: "string" },
      reviewed: { type: "boolean" },
      reviewSummary: { type: "string" },
      rollback: { type: "string" },
      rollbackSummary: { type: "string" },
      openRisks: { type: "array", items: { type: "string" } },
      changedFiles: { type: "array", items: { type: "string" } },
      allowedFiles: { type: "array", items: { type: "string" } },
      evidence: { type: "object" },
    },
  }),
  tool("list_task_mode_presets", "List harness task mode presets for project workflows.", {
    type: "object",
    properties: {},
  }),
  tool("get_task_mode_preset", "Return one task mode preset and its required evidence.", {
    type: "object",
    properties: {
      taskMode: { type: "string" },
      goal: { type: "string" },
      files: { type: "array", items: { type: "string" } },
    },
  }),
  tool("build_execution_harness", "Build a complete execution harness packet before agent dispatch.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      projectDir: { type: "string" },
      taskMode: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      scope: { type: "array", items: { type: "string" } },
      successCriteria: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      sensitiveAreas: { type: "array", items: { type: "string" } },
    },
  }),
  tool("build_next_prompt_draft", "Generate copy-ready next prompts for the user, Claude Code, and Codex.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      state: { type: "string" },
      taskMode: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      scope: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      nextAction: { type: "string" },
      blockingIssues: { type: "array", items: { type: "string" } },
    },
  }),
  tool("get_evidence_schema", "Return the normalized evidence schema for a task mode.", {
    type: "object",
    properties: {
      taskMode: { type: "string" },
      goal: { type: "string" },
      files: { type: "array", items: { type: "string" } },
    },
  }),
  tool("evaluate_stop_condition", "Evaluate whether a collaboration loop should stop, continue, or ask a human.", {
    type: "object",
    properties: {
      taskMode: { type: "string" },
      goal: { type: "string" },
      reviewFixRound: { type: "number" },
      failureCount: { type: "number" },
      risk: { type: "object" },
      qualityGate: { type: "object" },
      evidence: { type: "object" },
      phase: { type: "string" },
    },
  }),
  tool("plan_review_fix_loop", "Plan the Claude implement -> Codex review -> Claude fix loop with stop conditions.", {
    type: "object",
    properties: {
      runId: { type: "string" },
      planId: { type: "string" },
      goal: { type: "string" },
      projectDir: { type: "string" },
      taskMode: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      reviewFixRound: { type: "number" },
      failureCount: { type: "number" },
      evidence: { type: "object" },
    },
  }),
  tool("record_loop_failure", "Record a loop failure and return recovery guidance without automatic retry.", {
    type: "object",
    properties: {
      runId: { type: "string" },
      taskId: { type: "string" },
      step: { type: "string" },
      error: { type: "string" },
      failureType: { type: "string" },
      retryable: { type: "boolean" },
      taskMode: { type: "string" },
      failureCount: { type: "number" },
    },
  }),
  tool("get_user_dashboard", "Return a dashboard-oriented summary for non-technical task steering.", {
    type: "object",
    properties: {
      projectDir: { type: "string" },
      recentLimit: { type: "integer", minimum: 1, maximum: 50 },
    },
  }),
  tool("summarize_final_result", "Summarize final task evidence with quality gate and rollback status.", {
    type: "object",
    properties: {
      summary: { type: "string" },
      changedFiles: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      validationSummary: { type: "string" },
      reviewed: { type: "boolean" },
      reviewSummary: { type: "string" },
      rollback: { type: "string" },
      rollbackSummary: { type: "string" },
      openRisks: { type: "array", items: { type: "string" } },
    },
  }),
  tool("implement_with_review", "Prepare a Claude-led implementation with Codex review workflow and confirmation gates.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      projectDir: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      successCriteria: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      sensitiveAreas: { type: "array", items: { type: "string" } },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["goal"],
  }),
  tool("analyze_requirement_clarity", "Check whether a task has enough detail before formal execution.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      projectDir: { type: "string" },
      scope: { type: "array", items: { type: "string" } },
      files: { type: "array", items: { type: "string" } },
      successCriteria: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      sensitiveAreas: { type: "array", items: { type: "string" } },
    },
    required: ["goal"],
  }),
  tool("request_clarification", "Return the top clarification questions needed before execution.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      projectDir: { type: "string" },
      scope: { type: "array", items: { type: "string" } },
      successCriteria: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      sensitiveAreas: { type: "array", items: { type: "string" } },
    },
    required: ["goal"],
  }),
  tool("start_collab_run", "Create a resumable collaboration run state machine.", {
    type: "object",
    properties: {
      planId: { type: "string" },
      goal: { type: "string" },
      projectDir: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      scope: { type: "array", items: { type: "string" } },
      successCriteria: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      sensitiveAreas: { type: "array", items: { type: "string" } },
      primaryAgent: { type: "string" },
      reviewerAgent: { type: "string" },
    },
  }),
  tool("get_collab_run", "Read one collaboration run by runId.", {
    type: "object",
    properties: { runId: { type: "string" } },
    required: ["runId"],
  }),
  tool("advance_collab_run", "Advance a collaboration run through the supported state machine.", {
    type: "object",
    properties: {
      runId: { type: "string" },
      nextState: { type: "string", enum: ["clarifying", "planned", "approved", "implementing", "validating", "codex_reviewing", "fixing", "final_gate", "done", "canceled"] },
      actor: { type: "string" },
      summary: { type: "string" },
    },
    required: ["runId", "nextState"],
  }),
  tool("advance_task_loop", "Advance a resumable collaboration run to the next safe workflow node.", {
    type: "object",
    properties: {
      runId: { type: "string" },
      decision: { type: "string", enum: ["continue", "approve", "cancel", "close"] },
      taskMode: { type: "string" },
      humanApproved: { type: "boolean" },
      evidence: { type: "object" },
      summary: { type: "string" },
      actor: { type: "string" },
      ignorePending: { type: "boolean" },
    },
    required: ["runId"],
  }),
  tool("record_run_evidence", "Attach validation, review, changed-file, or rollback evidence to a collaboration run.", {
    type: "object",
    properties: {
      runId: { type: "string" },
      kind: { type: "string", enum: ["validation", "review", "reviewFindings", "changedFiles", "rollback", "rollbackPlan", "risk", "openRisks", "fixesApplied", "humanApprovals", "logs", "screenshots", "note"] },
      evidence: { type: "object" },
      summary: { type: "string" },
    },
    required: ["runId", "kind"],
  }),
  tool("record_human_approval", "Record human approval evidence on a run or return a reusable approval evidence object.", {
    type: "object",
    properties: {
      runId: { type: "string" },
      approvedBy: { type: "string" },
      scope: { type: "string" },
      decision: { type: "string", enum: ["approved", "accepted_risk", "approved_with_changes"] },
      notes: { type: "string" },
    },
  }),
  tool("explain_missing_evidence", "Explain missing quality-gate evidence and suggest a compact evidence packet.", {
    type: "object",
    properties: {
      taskMode: { type: "string" },
      goal: { type: "string" },
      runId: { type: "string" },
      evidence: { type: "object" },
      validationSummary: { type: "string" },
      reviewed: { type: "boolean" },
      rollbackSummary: { type: "string" },
      changedFiles: { type: "array", items: { type: "string" } },
      openRisks: { type: "array", items: { type: "string" } },
    },
  }),
  tool("create_plan", "Create an execution plan for user approval before work starts.", {
    type: "object",
    properties: {
      goal: { type: "string" },
      projectDir: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      successCriteria: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      sensitiveAreas: { type: "array", items: { type: "string" } },
      primaryAgent: { type: "string" },
      reviewerAgent: { type: "string" },
    },
    required: ["goal"],
  }),
  tool("revise_plan", "Revise an existing plan with requested changes.", {
    type: "object",
    properties: {
      planId: { type: "string" },
      requestedChange: { type: "string" },
      status: { type: "string" },
    },
    required: ["planId", "requestedChange"],
  }),
  tool("approve_plan", "Approve a plan so execution can be prepared.", {
    type: "object",
    properties: { planId: { type: "string" }, approvedBy: { type: "string" } },
    required: ["planId"],
  }),
  tool("execute_approved_plan", "Prepare execution for an approved plan through the existing confirmation gate.", {
    type: "object",
    properties: {
      planId: { type: "string" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["planId"],
  }),
  tool("explain_pending_confirmation", "Return a user-friendly approval card for a pending call.", {
    type: "object",
    properties: { callId: { type: "string" } },
    required: ["callId"],
  }),
  tool("get_pending_action_card", "Return the next pending approval card, or a specific card by callId.", {
    type: "object",
    properties: { callId: { type: "string" } },
  }),
  tool("approve_next_action", "Approve the next or selected pending action and return retry arguments.", {
    type: "object",
    properties: { callId: { type: "string" }, approvedBy: { type: "string" } },
  }),
  tool("deny_next_action", "Deny the next or selected pending action.", {
    type: "object",
    properties: { callId: { type: "string" }, reason: { type: "string" } },
  }),
  tool("revise_next_action", "Cancel the next or selected pending action and record a revision request.", {
    type: "object",
    properties: { callId: { type: "string" }, requestedChange: { type: "string" }, taskId: { type: "string" } },
    required: ["requestedChange"],
  }),
  tool("approve_pending_call", "Approve a pending call using the same confirmation semantics.", {
    type: "object",
    properties: { callId: { type: "string" }, confirmationText: { type: "string" }, approvedBy: { type: "string" } },
    required: ["callId", "confirmationText"],
  }),
  tool("deny_pending_call", "Deny a pending call.", {
    type: "object",
    properties: { callId: { type: "string" }, reason: { type: "string" } },
    required: ["callId"],
  }),
  tool("request_plan_change", "Record a requested plan change instead of approving the current plan.", {
    type: "object",
    properties: { planId: { type: "string" }, requestedChange: { type: "string" } },
    required: ["planId", "requestedChange"],
  }),
  tool("get_task_timeline", "Get the event timeline for a task or plan.", {
    type: "object",
    properties: { taskId: { type: "string" } },
    required: ["taskId"],
  }),
  tool("append_task_event", "Append an event to a task or plan timeline.", {
    type: "object",
    properties: { taskId: { type: "string" }, actor: { type: "string" }, event: { type: "string" }, details: { type: "string" } },
    required: ["taskId", "actor", "event"],
  }),
  tool("summarize_task_progress", "Summarize timeline progress and next best action.", {
    type: "object",
    properties: { taskId: { type: "string" } },
    required: ["taskId"],
  }),
  tool("propose_changes", "Create a change proposal without applying it.", {
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      files: { type: "array", items: { type: "string" } },
      patch: { type: "string" },
      risks: { type: "array", items: { type: "string" } },
      validation: { type: "array", items: { type: "string" } },
      rollback: { type: "string" },
      projectDir: { type: "string" },
    },
  }),
  tool("review_patch_plan", "Review a saved change proposal before application.", {
    type: "object",
    properties: { proposalId: { type: "string" } },
    required: ["proposalId"],
  }),
  tool("approve_apply", "Approve a saved change proposal for confirmed application.", {
    type: "object",
    properties: { proposalId: { type: "string" }, approvedBy: { type: "string" } },
    required: ["proposalId"],
  }),
  tool("apply_confirmed_changes", "Prepare application of an approved proposal via Claude Code and the existing confirmation gate.", {
    type: "object",
    properties: {
      proposalId: { type: "string" },
      confirmedCallId: { type: "string" },
      confirmationText: { type: "string" },
    },
    required: ["proposalId"],
  }),
  tool("select_quality_template", "Return the checks used for a quality template.", {
    type: "object",
    properties: { template: { type: "string", enum: ["bugfix", "feature", "refactor", "config", "release"] } },
    required: ["template"],
  }),
  tool("explain_quality_failures", "Explain failed quality gate checks in user-facing terms.", {
    type: "object",
    properties: { qualityGate: { type: "object" } },
    required: ["qualityGate"],
  }),
  tool("explain_error", "Explain an error with user message, suggested fix, and technical details.", {
    type: "object",
    properties: { error: { type: "string" }, stderr: { type: "string" }, context: { type: "string" } },
  }),
  tool("suggest_recovery", "Suggest recovery actions for a failed step.", {
    type: "object",
    properties: { error: { type: "string" }, stderr: { type: "string" }, context: { type: "string" } },
  }),
  tool("retry_last_step", "Prepare a retry note for the last failed step; does not execute automatically.", {
    type: "object",
    properties: { taskId: { type: "string" }, reason: { type: "string" } },
  }),
  tool("rollback_last_change", "Return rollback guidance for the latest proposal or task evidence.", {
    type: "object",
    properties: { proposalId: { type: "string" }, taskId: { type: "string" } },
  }),
  tool("export_task_report", "Export a structured task report from supplied evidence.", {
    type: "object",
    properties: { taskId: { type: "string" }, summary: { type: "string" }, changedFiles: { type: "array", items: { type: "string" } }, validationSummary: { type: "string" }, reviewSummary: { type: "string" }, rollbackSummary: { type: "string" }, openRisks: { type: "array", items: { type: "string" } } },
  }),
  tool("generate_pr_summary", "Generate a PR-style summary from supplied task evidence.", {
    type: "object",
    properties: { summary: { type: "string" }, changedFiles: { type: "array", items: { type: "string" } }, validationSummary: { type: "string" }, risks: { type: "array", items: { type: "string" } } },
  }),
  tool("generate_handoff_summary", "Generate a concise handoff summary.", {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" }, summary: { type: "string" }, nextSteps: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } } },
  }),
  tool("recommend_agent_route", "Recommend Claude/Codex routing for a task.", {
    type: "object",
    properties: { goal: { type: "string" }, files: { type: "array", items: { type: "string" } } },
  }),
  tool("explain_agent_route", "Explain a routing recommendation in user-facing language.", {
    type: "object",
    properties: { goal: { type: "string" }, files: { type: "array", items: { type: "string" } } },
  }),
  tool("override_agent_route", "Record a user override for agent routing.", {
    type: "object",
    properties: { taskId: { type: "string" }, primaryAgent: { type: "string" }, reviewerAgent: { type: "string" }, reason: { type: "string" } },
    required: ["taskId", "primaryAgent", "reviewerAgent"],
  }),
  tool("get_dashboard_brief", "Return a short dashboard summary.", {
    type: "object",
    properties: { projectDir: { type: "string" } },
  }),
  tool("get_dashboard_detail", "Return a detailed dashboard summary.", {
    type: "object",
    properties: { projectDir: { type: "string" }, recentLimit: { type: "integer", minimum: 1, maximum: 50 } },
  }),
];

function checkConfirmed(args, request) {
  if (!args.confirmedCallId) return false;
  const call = loadPending(args.confirmedCallId);
  if (!call || call.status !== "confirmed") return false;
  if (args.confirmationText !== call.requiredConfirmationText) return false;
  return call.requestHash === hashObject(normalizeCallRequest(request));
}

function maybeRequireConfirmation(request) {
  const policy = loadPolicy(request.projectDir || request.cwd || projectRoot);
  const risk = classifyRisk(request);
  const needs = requiresConfirmation(policy, risk.riskLevel, { crossAgent: true });
  return { policy, risk, needs };
}

async function guardedCrossAgent(args, request, runner) {
  assertDelegationAllowed(request);
  const { policy, risk, needs } = maybeRequireConfirmation(request);
  const confirmed = checkConfirmed(args, request);
  if (needs && !confirmed) {
    const call = buildPendingCall(request, risk);
    return {
      status: "pending_confirmation",
      mode: policy.mode,
      risk,
      callId: call.callId,
      requiredConfirmationText: call.requiredConfirmationText,
      message: "Human confirmation is required before this cross-agent call can run.",
    };
  }
  audit({ type: "cross_agent_call_start", target: request.target, risk, mode: policy.mode, traceId: request.traceId, parentCallId: request.parentCallId, depth: request.depth || 0 });
  const result = await runner(policy, risk);
  audit({ type: "cross_agent_call_finish", target: request.target, risk, mode: policy.mode, traceId: request.traceId, parentCallId: request.parentCallId, depth: request.depth || 0 });
  return result;
}

function bumpRiskTo(risk, level, reason) {
  const next = { ...risk, reasons: [...(risk.reasons || [])] };
  if (riskScoreFromLevel(level) > riskScoreFromLevel(next.riskLevel)) next.riskLevel = level;
  next.reasons = [...new Set([...next.reasons, reason])];
  next.sensitive = riskScoreFromLevel(next.riskLevel) >= 5;
  return next;
}

function localWriteRisk(request = {}) {
  let risk = classifyRisk(request);
  const files = request.files || [];
  const outsideProject = files.filter((file) => !isInsideOrSame(projectRoot, path.resolve(file)));
  if (outsideProject.length) {
    risk = bumpRiskTo(risk, "L5", "Local write targets files outside the current gateway project root.");
  }
  return risk;
}

async function guardedLocalWrite(args, request, writer) {
  assertDelegationAllowed(request);
  const policy = loadPolicy(request.projectDir || request.cwd || projectRoot);
  const risk = localWriteRisk(request);
  const needs = requiresConfirmation(policy, risk.riskLevel, { crossAgent: true });
  const confirmed = checkConfirmed(args, request);
  if (needs && !confirmed) {
    const call = buildPendingCall(request, risk);
    return {
      status: "pending_confirmation",
      mode: policy.mode,
      risk,
      callId: call.callId,
      requiredConfirmationText: call.requiredConfirmationText,
      message: "Human confirmation is required before this local gateway write can run.",
    };
  }
  audit({ type: "local_write_start", target: request.target, risk, mode: policy.mode, files: request.files || [] });
  const result = await writer(policy, risk);
  audit({ type: "local_write_finish", target: request.target, risk, mode: policy.mode, files: request.files || [] });
  return result;
}

async function runCodexTool(name, toolArgs, cwd) {
  const env = process.env.CODEX_CLAUDE_COLLAB_CODEX_HOME ? { CODEX_HOME: process.env.CODEX_CLAUDE_COLLAB_CODEX_HOME } : {};
  const client = new StdioMcpClient("codex", ["mcp-server"], { cwd: cwd || projectRoot, env });
  await client.start(30000);
  try {
    return await client.callTool(name, toolArgs);
  } finally {
    client.stop();
  }
}

async function runClaudeTool(name, toolArgs, cwd) {
  const client = new StdioMcpClient("claude", ["mcp", "serve"], { cwd: cwd || projectRoot });
  await client.start(30000);
  try {
    if (name === "__list__") return await client.listTools(60000);
    return await client.callTool(name, toolArgs || {}, 600000);
  } finally {
    client.stop();
  }
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeoutMs = options.timeoutMs || 120000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: null, signal: "timeout", stdout: redact(stdout), stderr: redact(stderr || `${command} timed out after ${timeoutMs}ms`) });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout: redact(stdout), stderr: redact(stderr) });
    });
  });
}

async function commandHealth(command, args = ["--version"]) {
  try {
    const result = await runProcess(command, args, { timeoutMs: 15000 });
    return {
      ok: result.code === 0,
      code: result.code,
      signal: result.signal,
      stdout: result.stdout.slice(0, 500),
      stderr: result.stderr.slice(0, 500),
    };
  } catch (error) {
    return { ok: false, error: redact(error.message || String(error)) };
  }
}

async function backendMcpHealth(command, args, env = {}) {
  const client = new StdioMcpClient(command, args, { cwd: projectRoot, env });
  try {
    await client.start(30000);
    const listed = await client.listTools(30000);
    return {
      ok: true,
      tools: (listed.tools || []).map((item) => item.name).slice(0, 50),
    };
  } catch (error) {
    return { ok: false, error: redact(error.message || String(error)) };
  } finally {
    client.stop();
  }
}

async function healthCheck(deep = false) {
  const health = {
    server: { name: SERVER_NAME, version: SERVER_VERSION, ok: true },
    policy: loadPolicy(),
    projectRoot,
    pluginRoot,
    stateRoot,
    cli: {
      node: await commandHealth("node"),
      codex: await commandHealth("codex"),
      claude: await commandHealth("claude"),
    },
  };
  if (deep) {
    const codexEnv = process.env.CODEX_CLAUDE_COLLAB_CODEX_HOME ? { CODEX_HOME: process.env.CODEX_CLAUDE_COLLAB_CODEX_HOME } : {};
    health.backends = {
      codexMcpServer: await backendMcpHealth("codex", ["mcp-server"], codexEnv),
      claudeMcpServe: await backendMcpHealth("claude", ["mcp", "serve"]),
    };
  }
  return health;
}

function walkProjectFiles(root, maxFiles = 5000) {
  const results = [];
  const skipDirs = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".cache"]);
  function walk(dir) {
    if (results.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        results.push(relative);
      }
    }
  }
  walk(root);
  return results;
}

function profileProjectRisk(projectDir = projectRoot, maxFiles = 5000) {
  const root = path.resolve(projectDir);
  const files = walkProjectFiles(root, maxFiles);
  const hit = (label, matcher, risk = "medium", recommendation = "Review before enabling automation.") => {
    const matches = files.filter(matcher);
    return matches.length ? { label, risk, count: matches.length, examples: matches.slice(0, 10), recommendation } : null;
  };
  const findings = [
    hit("Environment files", (file) => /(^|\/)\.env($|[./_-])/.test(file), "high", "Do not pass env values to agents; always confirm changes."),
    hit("MCP configuration", (file) => /(^|\/)\.mcp\.json$|(^|\/)\.codex\/config\.toml$/.test(file), "high", "Require confirmation for MCP edits."),
    hit("Hooks", (file) => /(^|\/)(hooks|\.git\/hooks)\//.test(file), "high", "Require confirmation for hook edits."),
    hit("Deployment or release scripts", (file) => /(deploy|release|publish|terraform|pulumi|k8s|helm)/i.test(file), "high", "Require confirmation before external-impact changes."),
    hit("CI workflows", (file) => /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.yml$|(^|\/)circle\.yml$/.test(file), "medium", "Review CI changes carefully."),
    hit("Package scripts", (file) => /(^|\/)package\.json$|(^|\/)Makefile$|(^|\/)justfile$/.test(file), "medium", "Inspect scripts before running automation."),
    hit("Claude/Codex configuration", (file) => /(^|\/)(CLAUDE\.md|AGENTS\.md|settings\.json|settings\.local\.json)$/.test(file), "high", "Use cautious mode for runtime-agent config."),
  ].filter(Boolean);
  const high = findings.filter((item) => item.risk === "high").length;
  const medium = findings.filter((item) => item.risk === "medium").length;
  return {
    projectDir: root,
    scannedFiles: files.length,
    risk: high ? "high" : medium ? "medium" : "low",
    recommendedPreset: high ? "developer_safe" : "developer_fast",
    recommendedMode: high ? "auto" : "auto",
    findings,
    note: "Findings are based on file paths and known config surfaces only; secret values are not read or printed.",
  };
}

function detectProjectConventions(projectDir = projectRoot) {
  const root = path.resolve(projectDir);
  const files = walkProjectFiles(root, 3000);
  const has = (name) => files.includes(name);
  const hasSuffix = (suffix) => files.some((file) => file.endsWith(suffix));
  const packageJson = has("package.json") ? readJson(path.join(root, "package.json"), {}) : null;
  const scripts = packageJson?.scripts ? Object.keys(packageJson.scripts) : [];
  const languages = [];
  if (hasSuffix(".ts") || hasSuffix(".tsx")) languages.push("TypeScript");
  if (hasSuffix(".js") || hasSuffix(".jsx") || packageJson) languages.push("JavaScript");
  if (hasSuffix(".py")) languages.push("Python");
  if (hasSuffix(".go")) languages.push("Go");
  if (hasSuffix(".rs")) languages.push("Rust");
  if (hasSuffix(".java")) languages.push("Java");
  if (hasSuffix(".rb")) languages.push("Ruby");
  const testHints = [];
  for (const script of scripts) {
    if (/test|check|lint|type|build/i.test(script)) testHints.push(`npm script: ${script}`);
  }
  if (has("Makefile")) testHints.push("Makefile present");
  if (has("pyproject.toml")) testHints.push("pyproject.toml present");
  return {
    projectDir: root,
    languages: [...new Set(languages)],
    packageManager: has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("package-lock.json") ? "npm" : null,
    scripts,
    testHints,
    notableFiles: files.filter((file) => /(^|\/)(README|CLAUDE|AGENTS|package|pyproject|Makefile|justfile|Cargo|go\.mod)/i.test(file)).slice(0, 30),
  };
}

function contextPack(projectDir = projectRoot) {
  const risk = profileProjectRisk(projectDir, 5000);
  const conventions = detectProjectConventions(projectDir);
  const root = path.resolve(projectDir);
  const files = walkProjectFiles(root, 1000);
  const topLevelDirs = [...new Set(files.map((file) => file.split(path.sep)[0]).filter(Boolean))].slice(0, 40);
  return {
    generatedAt: nowIso(),
    projectDir: root,
    topLevelDirs,
    conventions,
    risk,
    guidance: [
      "Use this context pack before dispatching Claude or Codex on complex work.",
      "Do not include secret values in prompts or task archives.",
      "For high-risk areas, request confirmation and record validation plus rollback.",
    ],
  };
}

function taskPlanFromGoal(goal, options = {}) {
  const risk = profileProjectRisk(options.projectDir || projectRoot, 5000);
  const conventions = detectProjectConventions(options.projectDir || projectRoot);
  const scope = options.scope || options.files || [];
  const validation = options.validation || conventions.testHints || [];
  const primaryAgent = options.primaryAgent || (risk.risk === "high" ? "claude-code" : "claude-code");
  const reviewerAgent = options.reviewerAgent || "codex";
  return {
    generatedAt: nowIso(),
    goal: redact(goal),
    status: "draft_needs_user_approval",
    primaryAgent,
    reviewerAgent,
    scope,
    successCriteria: options.successCriteria || [],
    nonGoals: options.nonGoals || ["Do not modify secrets or credentials.", "Do not expand permissions without separate confirmation."],
    assumptions: options.assumptions || [],
    sensitiveAreas: options.sensitiveAreas || [],
    risk: {
      projectRisk: risk.risk,
      findings: risk.findings,
      requiresConfirmation: risk.risk !== "low",
    },
    executionSteps: [
      "Build or refresh project context pack.",
      "Ask primary agent to propose implementation approach.",
      "Acquire file locks before any mutation.",
      "Run agreed validation commands.",
      "Ask reviewer agent for independent review.",
      "Fix accepted findings within approved scope.",
      "Run quality gate and summarize final result.",
    ],
    validation,
    rollback: options.rollback || "Record changed files and backup/rollback commands before mutation.",
  };
}

function analyzeRequirementClarity(input = {}) {
  const goal = String(input.goal || "").trim();
  const scope = input.scope || input.files || [];
  const successCriteria = input.successCriteria || [];
  const validation = input.validation || [];
  const rollback = input.rollback || input.rollbackSummary || "";
  const sensitiveAreas = input.sensitiveAreas || [];
  const missing = [];
  if (!goal || goal.length < 12) missing.push("goal");
  if (!scope.length) missing.push("scope");
  if (!successCriteria.length && !/success|criteria|完成|验收|目标/.test(goal.toLowerCase())) missing.push("successCriteria");
  if (!validation.length) missing.push("validation");
  if (!rollback) missing.push("rollback");
  if (!sensitiveAreas.length && /(auth|login|payment|deploy|mcp|hook|permission|secret|credential|删除|权限|部署|密钥)/i.test(goal)) {
    missing.push("sensitiveAreas");
  }
  const questions = [];
  if (missing.includes("scope")) questions.push("哪些文件、模块或系统允许修改，哪些明确禁止？");
  if (missing.includes("successCriteria")) questions.push("怎样才算完成？请给出可验收的成功标准。");
  if (missing.includes("validation")) questions.push("完成后应运行哪些验证命令或检查？");
  if (missing.includes("rollback")) questions.push("如果结果不符合预期，应如何回滚？");
  if (missing.includes("sensitiveAreas")) questions.push("是否涉及 secrets、权限、部署、MCP、hooks 或认证支付等敏感区域？");
  return {
    status: missing.length ? "needs_clarification" : "clear",
    readyForExecution: missing.length === 0,
    confidence: missing.length === 0 ? "high" : missing.length <= 2 ? "medium" : "low",
    missing,
    questions: questions.slice(0, 3),
    safeDefaults: [
      "Do not modify secrets or credentials.",
      "Do not expand permissions without separate confirmation.",
      "Prefer Claude Code for implementation and Codex for independent review unless routing says otherwise.",
    ],
  };
}

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function taskModeName(input = {}) {
  const explicit = input.taskMode || input.modePreset || input.mode;
  if (explicit && TASK_MODE_PRESETS[explicit]) return explicit;
  const text = `${input.goal || ""}\n${input.prompt || ""}\n${asList(input.files || input.scope).join("\n")}`.toLowerCase();
  if (/security|secret|credential|token|permission|auth|audit/.test(text)) return "security_review";
  if (/settings|hooks|mcp|\.claude|configuration|config/.test(text)) return "config_governance";
  if (/docs|readme|documentation|guide/.test(text)) return "docs_only";
  if (/refactor|rename|cleanup|architecture/.test(text)) return "refactor";
  if (/bug|fix|error|regression|failure/.test(text)) return "bug_fix";
  if (/sandbox|experiment|prototype|spike/.test(text)) return "sandbox_experiment";
  return "feature_delivery";
}

function taskModePreset(input = {}) {
  const name = taskModeName(input);
  return { name, ...TASK_MODE_PRESETS[name] };
}

function normalizeEvidence(input = {}, run = null) {
  const evidence = input.evidence || {};
  const runEvidence = run?.evidence || [];
  const groupedRunEvidence = runEvidence.reduce((acc, item) => {
    const kind = item.kind || "logs";
    acc[kind] = [...(acc[kind] || []), item.evidence || item.summary || item];
    return acc;
  }, {});
  const normalized = {
    validation: evidence.validation || input.validationEvidence || groupedRunEvidence.validation || [],
    changedFiles: evidence.changedFiles || input.changedFiles || groupedRunEvidence.changedFiles || [],
    reviewFindings: evidence.reviewFindings || evidence.review || input.reviewFindings || groupedRunEvidence.reviewFindings || groupedRunEvidence.review || [],
    fixesApplied: evidence.fixesApplied || input.fixesApplied || groupedRunEvidence.fixesApplied || [],
    rollbackPlan: evidence.rollbackPlan || input.rollbackPlan || input.rollback || input.rollbackSummary || groupedRunEvidence.rollbackPlan || [],
    screenshots: evidence.screenshots || input.screenshots || groupedRunEvidence.screenshots || [],
    logs: evidence.logs || input.logs || groupedRunEvidence.logs || [],
    humanApprovals: evidence.humanApprovals || input.humanApprovals || groupedRunEvidence.humanApprovals || [],
    openRisks: evidence.openRisks || input.openRisks || groupedRunEvidence.openRisks || [],
  };
  return Object.fromEntries(EVIDENCE_TYPES.map((type) => [type, normalized[type] || []]));
}

function evidenceSchema(input = {}) {
  const preset = taskModePreset(input);
  return {
    version: HARNESS_VERSION,
    taskMode: preset.name,
    types: EVIDENCE_TYPES.map((type) => ({
      type,
      required: preset.requiredEvidence.includes(type),
      description: {
        validation: "Commands, checks, exit codes, or explicit validation notes.",
        changedFiles: "Files changed or expected to change, kept inside approved scope.",
        reviewFindings: "Independent review findings, severities, and accepted/rejected status.",
        fixesApplied: "Fixes made in response to review or validation failures.",
        rollbackPlan: "Backup paths, revert commands, or restore strategy.",
        screenshots: "Visual evidence for UI or document work when relevant.",
        logs: "Relevant logs with secrets redacted.",
        humanApprovals: "Explicit human approvals for scope, risk, execution, or exceptions.",
        openRisks: "Known unresolved risks or explicitly accepted tradeoffs.",
      }[type],
    })),
  };
}

function arrayLength(value) {
  if (!value) return 0;
  return Array.isArray(value) ? value.length : 1;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function ensureRunLoop(run) {
  if (!run.loop) {
    run.loop = {
      reviewFixRound: 0,
      failureCount: 0,
      lastFailureType: "",
      failures: [],
    };
  }
  run.loop.reviewFixRound = Number(run.loop.reviewFixRound || 0);
  run.loop.failureCount = Number(run.loop.failureCount || 0);
  run.loop.failures = Array.isArray(run.loop.failures) ? run.loop.failures : [];
  return run.loop;
}

function evaluateStopCondition(input = {}) {
  const preset = taskModePreset(input);
  const qualityGate = input.qualityGate || null;
  const reviewFixRound = Number(input.reviewFixRound ?? input.reviewRound ?? 0);
  const failureCount = Number(input.failureCount ?? 0);
  const risk = input.risk || classifyRisk(input);
  const evidence = normalizeEvidence(input, input.run || null);
  const hasHighRisk = riskScoreFromLevel(risk.riskLevel) >= 5 || arrayLength(evidence.openRisks) > 0;
  if (preset.requireHumanAfterHighRiskFinding && hasHighRisk && !arrayLength(evidence.humanApprovals) && input.phase !== "planning") {
    return {
      shouldStop: true,
      decision: "needs_human",
      reason: "High-risk finding requires human approval before continuing.",
      nextAction: "Ask the human to approve, narrow scope, or accept/resolve the risk.",
    };
  }
  if (qualityGate?.done) {
    return {
      shouldStop: true,
      decision: "ready_for_closeout",
      reason: "Quality gate passed.",
      nextAction: "Summarize final result and close the task.",
    };
  }
  if (reviewFixRound >= Number(input.maxReviewFixRounds ?? preset.maxReviewFixRounds)) {
    return {
      shouldStop: true,
      decision: "max_review_rounds_reached",
      reason: `Review/fix round limit reached (${reviewFixRound}).`,
      nextAction: "Escalate to the human with remaining risks and options.",
    };
  }
  if (failureCount >= Number(input.maxFailures ?? preset.maxFailures)) {
    return {
      shouldStop: true,
      decision: "repeated_failure",
      reason: `Failure limit reached (${failureCount}).`,
      nextAction: "Stop automatic retries and ask the human to choose retry, rollback, or scope reduction.",
    };
  }
  return {
    shouldStop: false,
    decision: "continue",
    reason: "No stop condition met.",
    nextAction: "Continue the approved loop and record evidence.",
  };
}

function promptLines(lines) {
  return lines.filter(Boolean).join("\n");
}

function buildNextPromptDraft(input = {}) {
  const preset = taskModePreset(input);
  const goal = redact(input.goal || input.summary || input.plan?.goal || input.run?.goal || "the current task");
  const scope = asList(input.scope || input.files || input.plan?.taskPlan?.scope);
  const validation = asList(input.validation || input.plan?.taskPlan?.validation);
  const rollback = input.rollback || input.rollbackSummary || input.plan?.taskPlan?.rollback || "Document rollback before mutation.";
  const state = input.state || input.status || input.run?.state || "planned";
  const qualityGate = input.qualityGate;
  const blockingIssues = input.blockingIssues || qualityGate?.blockingIssues || [];
  const nextAction = input.nextAction || input.recommendedNextAction || (blockingIssues.length ? "Resolve blocking issues before closeout." : "Proceed with the next approved step.");
  const scopeLine = scope.length ? `Scope: ${scope.join(", ")}` : "Scope: use the approved plan or ask for clarification before editing.";
  const validationLine = validation.length ? `Validation: ${validation.join("; ")}` : "Validation: propose and record an appropriate validation method.";
  const issueLine = blockingIssues.length ? `Blocking issues: ${blockingIssues.join("; ")}` : "";
  return {
    nextActionPrompt: promptLines([
      `Current state: ${state}.`,
      `Goal: ${goal}`,
      `Next action: ${nextAction}`,
      scopeLine,
      validationLine,
      `Rollback: ${rollback}`,
      issueLine,
    ]),
    nextClaudePrompt: promptLines([
      "Claude Code, continue this task inside the approved execution harness.",
      `Task mode: ${preset.name} (${preset.label}).`,
      `Goal: ${goal}`,
      scopeLine,
      validationLine,
      `Rollback expectation: ${rollback}`,
      "Stay inside approved scope. Do not touch secrets, credentials, hooks, MCP configuration, deployment files, or permissions unless explicitly approved.",
      "After work, report changed files, validation evidence, rollback path, and open risks.",
    ]),
    nextCodexPrompt: promptLines([
      "Codex, act as the independent reviewer for this task.",
      `Task mode: ${preset.name} (${preset.label}).`,
      `Goal: ${goal}`,
      scopeLine,
      validationLine,
      "Review for bugs, scope drift, missing validation, unsafe behavior, hidden side effects, and rollback gaps.",
      "Return findings ordered by Critical, High, Medium, Low. Do not print secret values.",
    ]),
    userFacingPromptDraft: promptLines([
      `请继续该任务：${goal}`,
      `当前状态：${state}`,
      `下一步：${nextAction}`,
      scope.length ? `范围：${scope.join(", ")}` : "请先确认允许修改的范围。",
      validation.length ? `验证：${validation.join("; ")}` : "请补充验证方式。",
      `回滚：${rollback}`,
    ]),
  };
}

function buildExecutionHarness(input = {}) {
  const preset = taskModePreset(input);
  const route = input.route || routeRecommendation({
    goal: input.goal || input.prompt || "",
    files: input.files || input.scope || [],
  });
  const clarity = analyzeRequirementClarity({
    goal: input.goal || input.prompt || "",
    scope: input.scope || input.files || [],
    successCriteria: input.successCriteria || [],
    validation: input.validation || [],
    rollback: input.rollback || input.rollbackSummary || "",
    sensitiveAreas: input.sensitiveAreas || [],
  });
  const risk = classifyRisk({
    prompt: input.goal || input.prompt || "",
    files: input.files || input.scope || [],
    intent: input.intent || "plan",
    requestedCapability: input.requestedCapability || "execution_harness",
    projectDir: input.projectDir,
  });
  return {
    version: HARNESS_VERSION,
    createdAt: nowIso(),
    taskMode: preset,
    goal: redact(input.goal || input.prompt || ""),
    scope: input.scope || input.files || [],
    nonGoals: input.nonGoals || ["Do not modify secrets or credentials.", "Do not expand permissions without explicit approval."],
    successCriteria: input.successCriteria || [],
    validation: input.validation || [],
    rollback: input.rollback || input.rollbackSummary || "Document rollback before mutation.",
    sensitiveAreas: input.sensitiveAreas || [],
    route,
    risk,
    clarity,
    evidenceSchema: evidenceSchema({ ...input, taskMode: preset.name }),
    stopPolicy: {
      maxReviewFixRounds: preset.maxReviewFixRounds,
      maxFailures: preset.maxFailures,
      stopWhenQualityGatePasses: true,
      requireHumanAfterHighRiskFinding: preset.requireHumanAfterHighRiskFinding,
    },
  };
}

function withHarness(base = {}, input = {}) {
  const state = input.state || base.status || base.plan?.status || base.run?.state || "unknown";
  const goal = input.goal || base.plan?.goal || base.run?.goal || base.summary || "";
  const qualityGate = input.qualityGate || base.qualityGate || null;
  const stopCondition = input.stopCondition || evaluateStopCondition({
    ...input,
    goal,
    qualityGate,
    risk: input.risk || base.risk,
    phase: input.phase || state,
  });
  const promptDrafts = buildNextPromptDraft({
    ...input,
    goal,
    state,
    qualityGate,
    blockingIssues: input.blockingIssues || base.blockingIssues || qualityGate?.blockingIssues || [],
    nextAction: input.nextAction || base.nextBestAction || base.recommendedNextAction || stopCondition.nextAction,
  });
  return {
    ...base,
    harness: {
      version: HARNESS_VERSION,
      state,
      taskMode: taskModePreset(input).name,
      summary: redact(input.summary || base.userMessage || base.summary || ""),
      nextAction: input.nextAction || base.nextBestAction || base.recommendedNextAction || stopCondition.nextAction,
      requiredEvidence: evidenceSchema(input).types.filter((item) => item.required).map((item) => item.type),
      blockingIssues: input.blockingIssues || base.blockingIssues || qualityGate?.blockingIssues || [],
      qualityGate,
      stopCondition,
      route: input.route || base.route || null,
      risk: input.risk || base.risk || null,
    },
    nextPromptDrafts: promptDrafts,
  };
}

function qualityGateReport(input = {}) {
  const evidence = input.evidence || {};
  const normalizedEvidence = normalizeEvidence(input, input.run || null);
  const validationEvidence = normalizedEvidence.validation;
  const failedValidation = validationEvidence.filter((item) => item && item.exitCode !== undefined && item.exitCode !== 0);
  const reviewEvidence = normalizedEvidence.reviewFindings;
  const changedFiles = normalizedEvidence.changedFiles;
  const openRisks = hasOwn(input, "openRisks") ? input.openRisks : normalizedEvidence.openRisks;
  const allowedFiles = input.allowedFiles || input.scope || [];
  const outsideScope = allowedFiles.length
    ? changedFiles.filter((file) => !allowedFiles.some((allowed) => pathMatchesAny(file, [allowed]) || pathMatchesAny(allowed, [file])))
    : [];
  const preset = taskModePreset(input);
  const requiredEvidence = input.requiredEvidence || preset.requiredEvidence || [];
  const hasRequiredEvidence = (type) => {
    switch (type) {
      case "validation":
        return Boolean((input.validation || []).length || input.validationSummary || arrayLength(normalizedEvidence.validation));
      case "changedFiles":
        return arrayLength(normalizedEvidence.changedFiles) > 0;
      case "reviewFindings":
        return Boolean(input.reviewSummary || input.reviewed === true || arrayLength(normalizedEvidence.reviewFindings));
      case "fixesApplied":
        return arrayLength(normalizedEvidence.fixesApplied) > 0;
      case "rollbackPlan":
        return Boolean(input.rollback || input.rollbackSummary || arrayLength(normalizedEvidence.rollbackPlan));
      case "screenshots":
        return arrayLength(normalizedEvidence.screenshots) > 0;
      case "logs":
        return arrayLength(normalizedEvidence.logs) > 0;
      case "humanApprovals":
        return Boolean(input.humanApproved === true || arrayLength(normalizedEvidence.humanApprovals));
      case "openRisks":
        return hasOwn(evidence, "openRisks") || hasOwn(input, "openRisks") || arrayLength(normalizedEvidence.openRisks) > 0;
      default:
        return true;
    }
  };
  const missingRequiredEvidence = requiredEvidence.filter((type) => !hasRequiredEvidence(type));
  const checks = [
    { id: "goal", passed: Boolean(input.goal || input.taskDir), label: "Goal or task reference exists." },
    { id: "validation", passed: Boolean((input.validation || []).length || input.validationSummary || validationEvidence.length) && failedValidation.length === 0, label: "Validation evidence is recorded and not failing." },
    { id: "review", passed: Boolean(input.reviewSummary || input.reviewed === true || reviewEvidence.length), label: "Independent review is recorded." },
    { id: "rollback", passed: Boolean(input.rollback || input.rollbackSummary), label: "Rollback path is documented." },
    { id: "risks", passed: !arrayLength(openRisks), label: "No unresolved open risks remain." },
    { id: "scope", passed: outsideScope.length === 0, label: "Changed files stay within approved scope." },
    {
      id: "requiredEvidence",
      passed: missingRequiredEvidence.length === 0,
      label: missingRequiredEvidence.length
        ? `Required evidence is missing: ${missingRequiredEvidence.join(", ")}.`
        : `Required evidence is present for ${preset.name}.`,
    },
  ];
  const passed = checks.filter((check) => check.passed).length;
  return {
    generatedAt: nowIso(),
    done: passed === checks.length,
    score: Math.round((passed / checks.length) * 100),
    passed,
    total: checks.length,
    checks,
    evidence: {
      validation: validationEvidence,
      review: reviewEvidence,
      changedFiles,
      failedValidation,
      outsideScope,
      missingRequiredEvidence,
      requiredEvidence,
    },
    blockingIssues: checks.filter((check) => !check.passed).map((check) => check.label),
    recommendation: passed === checks.length ? "Ready to close." : "Do not mark complete until blocking issues are addressed or explicitly accepted.",
  };
}

function summarizeResult(input = {}) {
  const gate = qualityGateReport({ ...input, goal: input.goal || input.summary });
  return {
    generatedAt: nowIso(),
    summary: redact(input.summary || "No final summary supplied."),
    changedFiles: input.changedFiles || [],
    validation: input.validationSummary || input.validation || "not provided",
    review: input.reviewSummary || "not provided",
    rollback: input.rollbackSummary || input.rollback || "not provided",
    remainingRisks: input.openRisks || [],
    qualityGate: gate,
    userMessage: gate.done
      ? "Work appears ready to close based on supplied evidence."
      : "Work is not ready to close; review blocking issues in qualityGate.",
  };
}

function routeRecommendation(input = {}) {
  const text = `${input.goal || ""}\n${(input.files || []).join("\n")}`.toLowerCase();
  if (/claude|codex|settings|hooks|mcp|permission|secret|credential|\.claude/.test(text)) {
    return {
      primaryAgent: "codex",
      reviewerAgent: "claude-code",
      rationale: ["Configuration, permission, hooks, MCP, or secret-sensitive work benefits from Codex governance first."],
    };
  }
  if (/review|audit|risk|security/.test(text)) {
    return {
      primaryAgent: "codex",
      reviewerAgent: "claude-code",
      rationale: ["Review and audit tasks benefit from independent Codex analysis."],
    };
  }
  return {
    primaryAgent: "claude-code",
    reviewerAgent: "codex",
    rationale: ["Implementation and runtime validation are usually Claude-led, with Codex providing independent review."],
  };
}

function createPlanRecord(input = {}) {
  const route = routeRecommendation(input);
  const planId = makeId("plan");
  const projectDir = path.resolve(input.projectDir || projectRoot);
  const plan = {
    planId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: "draft",
    projectDir,
    goal: redact(input.goal || ""),
    route,
    taskPlan: taskPlanFromGoal(input.goal || "", {
      ...input,
      projectDir,
      primaryAgent: input.primaryAgent || route.primaryAgent,
      reviewerAgent: input.reviewerAgent || route.reviewerAgent,
    }),
    contextPackSummary: {
      risk: profileProjectRisk(projectDir, 3000).risk,
      conventions: detectProjectConventions(projectDir),
    },
    requestedChanges: [],
  };
  saveRecord("plans", planId, plan);
  return plan;
}

function timelineFile(taskId) {
  return recordFile("timelines", taskId);
}

function loadTimeline(taskId) {
  return readJson(timelineFile(taskId), { taskId, events: [] });
}

function saveTimeline(taskId, timeline) {
  writeJson(timelineFile(taskId), timeline);
}

function addTimelineEvent(taskId, event) {
  const timeline = loadTimeline(taskId);
  timeline.events.push({ time: nowIso(), ...event });
  saveTimeline(taskId, timeline);
  return timeline;
}

function createProposal(input = {}) {
  const proposalId = makeId("proposal");
  const projectDir = path.resolve(input.projectDir || projectRoot);
  const proposal = {
    proposalId,
    createdAt: nowIso(),
    status: "proposed",
    projectDir,
    title: redact(input.title || input.goal || "Change proposal"),
    summary: redact(input.summary || ""),
    files: input.files || [],
    patch: redact(input.patch || ""),
    risks: input.risks || [],
    validation: input.validation || [],
    rollback: input.rollback || "Document rollback before applying.",
    risk: classifyRisk({
      prompt: `${input.summary || ""}\n${input.patch || ""}`,
      files: input.files || [],
      intent: "mutate",
      requestedCapability: "apply_change_proposal",
    }),
  };
  saveRecord("proposals", proposalId, proposal);
  audit({ type: "propose_changes", proposalId, files: proposal.files, risk: proposal.risk });
  return proposal;
}

const RUN_TRANSITIONS = {
  draft: ["clarifying", "planned", "canceled"],
  clarifying: ["planned", "canceled"],
  planned: ["approved", "clarifying", "canceled"],
  approved: ["implementing", "canceled"],
  implementing: ["validating", "canceled"],
  validating: ["codex_reviewing", "fixing", "final_gate", "canceled"],
  codex_reviewing: ["fixing", "final_gate", "canceled"],
  fixing: ["validating", "codex_reviewing", "final_gate", "canceled"],
  final_gate: ["done", "fixing", "canceled"],
  done: [],
  canceled: [],
};

function createRunRecord(input = {}) {
  const plan = input.planId ? loadRecord("plans", input.planId) : null;
  if (input.planId && !plan) throw new Error("Unknown planId");
  const runId = makeId("run");
  const goal = input.goal || plan?.goal || "";
  const projectDir = path.resolve(input.projectDir || plan?.projectDir || projectRoot);
  const clarity = analyzeRequirementClarity({
    goal,
    projectDir,
    scope: input.scope || input.files || plan?.taskPlan?.scope || [],
    successCriteria: input.successCriteria || plan?.taskPlan?.successCriteria || [],
    validation: input.validation || plan?.taskPlan?.validation || [],
    rollback: input.rollback || plan?.taskPlan?.rollback,
    sensitiveAreas: input.sensitiveAreas || plan?.taskPlan?.sensitiveAreas || [],
  });
  const run = {
    runId,
    planId: input.planId || "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    state: clarity.readyForExecution ? "planned" : "clarifying",
    goal: redact(goal),
    projectDir,
    primaryAgent: input.primaryAgent || plan?.taskPlan?.primaryAgent || "claude-code",
    reviewerAgent: input.reviewerAgent || plan?.taskPlan?.reviewerAgent || "codex",
    clarity,
    loop: {
      reviewFixRound: 0,
      failureCount: 0,
      lastFailureType: "",
      failures: [],
    },
    evidence: [],
    history: [{ time: nowIso(), state: clarity.readyForExecution ? "planned" : "clarifying", event: "run_created" }],
  };
  saveRecord("runs", runId, run);
  return run;
}

function loadRun(runId) {
  return loadRecord("runs", runId);
}

function saveRun(run) {
  run.updatedAt = nowIso();
  saveRecord("runs", run.runId, run);
}

function transitionRun(run, nextState, event = {}) {
  const allowed = RUN_TRANSITIONS[run.state] || [];
  if (!allowed.includes(nextState)) {
    throw new Error(`Cannot transition run from ${run.state} to ${nextState}`);
  }
  run.state = nextState;
  run.history.push({ time: nowIso(), state: nextState, ...event });
  saveRun(run);
  return run;
}

function explainError(input = {}) {
  const text = `${input.error || ""}\n${input.stderr || ""}\n${input.context || ""}`;
  let userMessage = "The gateway or backend returned an error.";
  let suggestedFix = "Check the technical details and retry after correcting the cause.";
  if (/readonly database|attempt to write a readonly database|CODEX_HOME/i.test(text)) {
    userMessage = "Codex is installed but cannot write its state database.";
    suggestedFix = "Set CODEX_CLAUDE_COLLAB_CODEX_HOME to a writable directory, then retry.";
  } else if (/timed out/i.test(text)) {
    userMessage = "The backend did not respond before the timeout.";
    suggestedFix = "Retry, or run health_check with deep=true to inspect backend startup.";
  } else if (/permission|operation not permitted/i.test(text)) {
    userMessage = "The requested operation appears blocked by permissions or sandboxing.";
    suggestedFix = "Review the active mode, sandbox, cwd, and project policy.";
  }
  return {
    userMessage,
    suggestedFix,
    technicalDetails: redact(text).slice(0, 2000),
  };
}

function recentAudit(limit = 10) {
  const file = path.join(stateRoot, "audit", "gateway.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-limit).map((line) => readJsonLine(line)).filter(Boolean);
}

function pendingCallSummaries(status) {
  return listJsonFiles(pendingCallsDir())
    .map((file) => readJson(file, null))
    .filter(Boolean)
    .filter((call) => !status || call.status === status)
    .map((call) => ({
      callId: call.callId,
      status: call.status,
      createdAt: call.createdAt,
      riskLevel: call.risk?.riskLevel,
      target: call.request?.target,
      action: call.request?.requestedCapability,
      preflight: call.preflight,
    }));
}

function pendingCalls(status = "pending_confirmation") {
  return listJsonFiles(pendingCallsDir())
    .map((file) => readJson(file, null))
    .filter(Boolean)
    .filter((call) => !status || call.status === status)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

function nextPendingCall(callId = "") {
  if (callId) {
    const call = loadPending(callId);
    if (!call) throw new Error("Unknown callId");
    return call;
  }
  return pendingCalls("pending_confirmation")[0] || null;
}

function pendingActionCard(call) {
  if (!call) {
    return {
      status: "idle",
      userMessage: "No pending cross-agent action needs approval.",
      options: [],
    };
  }
  return {
    status: call.status,
    callId: call.callId,
    title: "Review Next Action",
    target: call.preflight?.target,
    action: call.preflight?.action,
    riskLevel: call.risk?.riskLevel,
    reasons: call.risk?.reasons || [],
    files: call.preflight?.files || [],
    cwd: call.preflight?.cwd,
    recommendation: call.preflight?.recommendation,
    requiredConfirmationText: call.requiredConfirmationText,
    userMessage: call.status === "pending_confirmation"
      ? "Review this pending action, then approve, deny, or request a revision."
      : "This action is no longer pending.",
    options: [
      { action: "approve_next_action", label: "Approve", effect: "Confirms this exact pending action and returns retry arguments." },
      { action: "deny_next_action", label: "Deny", effect: "Cancels this pending action without execution." },
      { action: "revise_next_action", label: "Revise", effect: "Cancels this action and records what should change before retrying." },
    ],
  };
}

function collabStatus(projectDir = projectRoot, recentLimit = 10) {
  const pending = pendingCallSummaries("pending_confirmation");
  const locks = loadLocks();
  const policy = loadPolicy();
  return {
    userMessage: pending.length
      ? `${pending.length} cross-agent call(s) need your confirmation.`
      : policy.paused
        ? "Collaboration is paused; no new cross-agent calls will run."
        : "No user action is currently required.",
    mode: policy.mode,
    paused: Boolean(policy.paused),
    pendingConfirmations: pending,
    activeLocks: locks,
    recentAudit: recentAudit(recentLimit),
    projectRisk: profileProjectRisk(projectDir, 3000),
  };
}

function appendEvidencePacket(run, evidence = {}, summary = "", actor = "gateway") {
  if (!run) return [];
  const saved = [];
  const aliases = {
    review: "reviewFindings",
    rollback: "rollbackPlan",
    risk: "openRisks",
  };
  const packet = { ...evidence };
  for (const [from, to] of Object.entries(aliases)) {
    if (packet[from] && !packet[to]) packet[to] = packet[from];
  }
  for (const type of EVIDENCE_TYPES) {
    if (!arrayLength(packet[type])) continue;
    const item = {
      time: nowIso(),
      kind: type,
      summary: redact(summary || `${type} evidence recorded by ${actor}`),
      evidence: redactStructured(packet[type]),
    };
    run.evidence.push(item);
    saved.push(item);
  }
  if (saved.length) {
    run.history.push({ time: nowIso(), state: run.state, event: "evidence_packet_recorded", actor, kinds: saved.map((item) => item.kind) });
    saveRun(run);
  }
  return saved;
}

function updatePolicyPatch(patch) {
  const policy = loadPolicy();
  const next = { ...policy, ...patch };
  savePolicy(next);
  return next;
}

function cancelAllPending(reason) {
  const calls = listJsonFiles(pendingCallsDir()).map((file) => readJson(file, null)).filter(Boolean);
  for (const call of calls) {
    if (call.status === "pending_confirmation") {
      call.status = "canceled";
      call.canceledAt = nowIso();
      call.cancelReason = redact(reason || "canceled");
      savePending(call);
    }
  }
  return calls.filter((call) => call.status === "canceled").length;
}

async function callTool(name, args = {}) {
  switch (name) {
    case "get_policy":
      return { ...loadPolicy(), stateRoot, projectRoot, pluginRoot };
    case "list_user_mode_presets":
      return {
        userModes: Object.fromEntries(Object.entries(USER_MODE_PRESETS).map(([name, preset]) => [name, {
          ...preset,
          policy: POLICY_PRESETS[preset.policyPreset],
        }])),
        recommendedDefault: "solo_developer_safe",
      };
    case "apply_user_mode_preset": {
      const preset = USER_MODE_PRESETS[args.userMode];
      if (!preset) throw new Error(`Unknown userMode: ${args.userMode}`);
      const result = await callTool("init_project_collab", {
        ...args,
        preset: preset.policyPreset,
      });
      return withHarness({
        status: result.status,
        userMode: args.userMode,
        label: preset.label,
        policyPreset: preset.policyPreset,
        result,
        userMessage: result.status === "pending_confirmation"
          ? "User mode setup is waiting for confirmation."
          : `User mode ${preset.label} is configured or already present.`,
      }, {
        ...args,
        state: result.status === "pending_confirmation" ? "pending_confirmation" : "configured",
        nextAction: result.status === "pending_confirmation"
          ? "Review and approve the pending user-mode setup action."
          : "Use get_dashboard_brief or start_complex project work through the high-level workflow tools.",
      });
    }
    case "set_policy_mode": {
      if (!MODES.has(args.mode)) throw new Error("mode must be cautious, auto, or danger");
      if (args.mode === "danger") {
        const request = {
          target: "gateway",
          prompt: "Enable danger mode for the Codex-Claude cross-agent gateway.",
          cwd: projectRoot,
          requestedCapability: "set_policy_mode:danger",
          intent: "mutate",
          files: [policyFile()],
          commands: ["set_policy_mode danger"],
        };
        const risk = {
          riskLevel: "L6",
          reasons: ["Danger mode disables gateway confirmation checks for future calls."],
          sensitive: true,
          matchedAlwaysConfirm: ["danger"],
          pathFindings: { forbidden: [], outsideAllowed: [] },
        };
        if (!checkConfirmed(args, request)) {
          const call = buildPendingCall(request, risk);
          return {
            status: "pending_confirmation",
            mode: loadPolicy().mode,
            risk,
            callId: call.callId,
            requiredConfirmationText: call.requiredConfirmationText,
            message: "Danger mode requires a bound human confirmation. Confirm this pending call, then retry set_policy_mode with confirmedCallId and confirmationText.",
          };
        }
      }
      const policy = loadPolicy();
      policy.mode = args.mode;
      savePolicy(policy);
      audit({ type: "set_policy_mode", mode: args.mode });
      return { status: "updated", policy };
    }
    case "classify_risk":
      return classifyRisk(args);
    case "prepare_cross_agent_call": {
      assertDelegationAllowed(args);
      const risk = classifyRisk(args);
      const policy = loadPolicy();
      const needs = requiresConfirmation(policy, risk.riskLevel, { crossAgent: true });
      if (!needs) return { status: "ready", mode: policy.mode, risk, requiresConfirmation: false };
      const call = buildPendingCall(args, risk);
      return {
        status: "pending_confirmation",
        mode: policy.mode,
        risk,
        requiresConfirmation: true,
        callId: call.callId,
        requiredConfirmationText: call.requiredConfirmationText,
      };
    }
    case "confirm_cross_agent_call": {
      const call = loadPending(args.callId);
      if (!call) throw new Error("Unknown callId");
      if (args.confirmationText !== call.requiredConfirmationText) {
        throw new Error("confirmationText does not match the required human confirmation text");
      }
      call.status = "confirmed";
      call.approvedAt = nowIso();
      call.approvedBy = args.approvedBy || "human";
      savePending(call);
      audit({ type: "confirm_cross_agent_call", callId: args.callId, approvedBy: call.approvedBy });
      return { status: "confirmed", callId: args.callId };
    }
    case "call_codex":
      return guardedCrossAgent(args, {
        target: "codex",
        prompt: args.prompt,
        cwd: args.cwd,
        requestedCapability: "codex_session",
        intent: args.intent || "",
        files: args.files || [],
        traceId: args.traceId || "",
        parentCallId: args.parentCallId || "",
        depth: Number(args.depth || 0),
        commands: [`codex mcp-server tool codex; sandbox=${args.sandbox || "workspace-write"}; approval=${args.approvalPolicy || "on-request"}`],
      }, async (policy) => {
        const toolArgs = {
          prompt: args.prompt,
          cwd: args.cwd || projectRoot,
          sandbox: args.sandbox || (policy.mode === "danger" ? "danger-full-access" : "workspace-write"),
          "approval-policy": args.approvalPolicy || (policy.mode === "danger" ? "never" : "on-request"),
        };
        if (args.model) toolArgs.model = args.model;
        if (args.profile) toolArgs.profile = args.profile;
        return runCodexTool("codex", toolArgs, args.cwd);
      });
    case "continue_codex":
      return guardedCrossAgent(args, {
        target: "codex",
        prompt: args.prompt,
        cwd: args.cwd,
        requestedCapability: "codex_reply",
        traceId: args.traceId || "",
        parentCallId: args.parentCallId || "",
        depth: Number(args.depth || 0),
      }, async () => runCodexTool("codex-reply", { threadId: args.threadId, prompt: args.prompt }, args.cwd));
    case "call_claude_cli":
      return guardedCrossAgent(args, {
        target: "claude",
        prompt: args.prompt,
        cwd: args.cwd,
        requestedCapability: "claude_cli_session",
        intent: args.intent || "",
        files: args.files || [],
        traceId: args.traceId || "",
        parentCallId: args.parentCallId || "",
        depth: Number(args.depth || 0),
        commands: ["claude --print"],
      }, async (policy) => {
        const cliArgs = ["--print", "--output-format", args.outputFormat || "text"];
        if (args.model) cliArgs.push("--model", args.model);
        if (policy.mode === "danger") cliArgs.push("--dangerously-skip-permissions");
        else cliArgs.push("--permission-mode", args.permissionMode || (policy.mode === "auto" ? "auto" : "default"));
        cliArgs.push(args.prompt);
        return runProcess("claude", cliArgs, { cwd: args.cwd || projectRoot });
      });
    case "list_claude_tools":
      return runClaudeTool("__list__", {}, args.cwd);
    case "call_claude_tool":
      return guardedCrossAgent(args, {
        target: "claude",
        prompt: `Call Claude MCP tool ${args.toolName}`,
        cwd: args.cwd,
        requestedCapability: args.toolName,
        tools: [args.toolName],
        arguments: args.arguments || {},
        intent: args.intent || "",
        files: args.files || [],
        traceId: args.traceId || "",
        parentCallId: args.parentCallId || "",
        depth: Number(args.depth || 0),
      }, async () => runClaudeTool(args.toolName, args.arguments || {}, args.cwd));
    case "create_task_archive": {
      const root = resolveTaskRoot(args.projectDir);
      return guardedLocalWrite(args, {
        target: "gateway",
        prompt: `Create task archive for: ${args.goal}`,
        cwd: args.projectDir || projectRoot,
        requestedCapability: "create_task_archive",
        intent: "mutate",
        files: [root],
      }, async () => {
        const dir = path.join(root, `${timestampSlug()}-${slugify(args.goal)}`);
        ensureDir(dir);
        fs.writeFileSync(path.join(dir, "BRIEF.md"), `# Task Brief\n\nGoal: ${redact(args.goal)}\n\nStatus: draft\n`);
        fs.writeFileSync(path.join(dir, "ROUTING.md"), `# Routing\n\nPrimary agent: ${args.primaryAgent || "needs decision"}\nReviewer agent: ${args.reviewerAgent || "needs decision"}\n`);
        fs.writeFileSync(path.join(dir, "DECISIONS.md"), "# Decisions\n\n## User Confirmation Before Execution\n\nStatus: pending\n");
        fs.writeFileSync(path.join(dir, "VALIDATION.md"), "# Validation\n\nStatus: not run\n");
        fs.writeFileSync(path.join(dir, "ACTIVITY.md"), `# Activity\n\n- ${nowIso()} gateway created task archive.\n`);
        audit({ type: "create_task_archive", dir });
        return { status: "created", taskDir: dir, projectDir: path.resolve(args.projectDir || projectRoot) };
      });
    }
    case "list_task_archives": {
      const root = resolveTaskRoot(args.projectDir);
      const entries = fs.existsSync(root)
        ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(root, d.name)).sort()
        : [];
      return { taskRoot: root, tasks: entries };
    }
    case "read_task_archive": {
      const dir = safeTaskDir(args.taskDir, args.projectDir);
      const names = ["BRIEF.md", "ROUTING.md", "DECISIONS.md", "VALIDATION.md", "REVIEW.md", "HANDOFF.md", "ACTIVITY.md"];
      const files = {};
      for (const file of names) {
        const p = path.join(dir, file);
        if (fs.existsSync(p)) files[file] = redact(fs.readFileSync(p, "utf8"));
      }
      return { taskDir: dir, files };
    }
    case "append_activity": {
      const dir = safeTaskDir(args.taskDir, args.projectDir);
      const entry = `\n- ${nowIso()} ${args.actor}: ${redact(args.summary)}${args.details ? `\n\n${redact(args.details)}\n` : ""}`;
      fs.appendFileSync(path.join(dir, "ACTIVITY.md"), entry);
      audit({ type: "append_activity", taskDir: dir, actor: args.actor, summary: args.summary });
      return { status: "appended", taskDir: dir };
    }
    case "list_pending_calls": {
      const calls = listJsonFiles(pendingCallsDir())
        .map((file) => readJson(file, null))
        .filter(Boolean)
        .filter((call) => !args.status || call.status === args.status)
        .map((call) => ({
          callId: call.callId,
          status: call.status,
          createdAt: call.createdAt,
          approvedAt: call.approvedAt,
          canceledAt: call.canceledAt,
          mode: call.mode,
          risk: call.risk,
          requestHash: call.requestHash,
        }));
      return { calls };
    }
    case "get_pending_call": {
      const call = loadPending(args.callId);
      if (!call) throw new Error("Unknown callId");
      return call;
    }
    case "cancel_pending_call": {
      const call = loadPending(args.callId);
      if (!call) throw new Error("Unknown callId");
      call.status = "canceled";
      call.canceledAt = nowIso();
      call.cancelReason = redact(args.reason || "not specified");
      savePending(call);
      audit({ type: "cancel_pending_call", callId: args.callId, reason: args.reason || "not specified" });
      return { status: "canceled", callId: args.callId };
    }
    case "list_audit_events": {
      const file = path.join(stateRoot, "audit", "gateway.jsonl");
      if (!fs.existsSync(file)) return { events: [] };
      const limit = Math.min(Math.max(Number(args.limit || 50), 1), 200);
      const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-limit);
      return { events: lines.map((line) => readJsonLine(line)).filter(Boolean) };
    }
    case "acquire_file_lock": {
      return withLocksMutation(() => {
        const locks = loadLocks();
        const files = args.files || [];
        const conflict = locks.find((lock) => filesOverlap(lock.files, files));
        if (conflict) {
          return { status: "conflict", conflict };
        }
        const ttlSeconds = Math.min(Math.max(Number(args.ttlSeconds || 3600), 30), 86400);
        const lock = {
          lockId: `lock-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
          owner: args.owner,
          files,
          reason: redact(args.reason || ""),
          createdAt: nowIso(),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        };
        locks.push(lock);
        saveLocks(locks);
        audit({ type: "acquire_file_lock", lockId: lock.lockId, owner: args.owner, files });
        return { status: "locked", lock };
      });
    }
    case "release_file_lock": {
      return withLocksMutation(() => {
        const locks = loadLocks();
        const lock = locks.find((item) => item.lockId === args.lockId);
        if (!lock) return { status: "not_found", lockId: args.lockId };
        if (args.owner && lock.owner !== args.owner) throw new Error("owner does not match lock owner");
        saveLocks(locks.filter((item) => item.lockId !== args.lockId));
        audit({ type: "release_file_lock", lockId: args.lockId, owner: args.owner || lock.owner });
        return { status: "released", lockId: args.lockId };
      });
    }
    case "list_file_locks":
      return { locks: loadLocks() };
    case "health_check":
      return healthCheck(Boolean(args.deep));
    case "init_project_collab": {
      const projectDir = path.resolve(args.projectDir || projectRoot);
      const presetName = args.preset || "developer_safe";
      const preset = POLICY_PRESETS[presetName];
      if (!preset) throw new Error(`Unknown preset: ${presetName}`);
      const file = projectPolicyFile(projectDir);
      if (fs.existsSync(file) && !args.overwrite) {
        return { status: "exists", policyFile: file, message: "Project policy already exists. Pass overwrite=true to replace it." };
      }
      return guardedLocalWrite(args, {
        target: "gateway",
        prompt: `Initialize project collaboration policy ${presetName}`,
        cwd: projectDir,
        requestedCapability: "init_project_collab",
        intent: "mutate",
        files: [file],
      }, async () => {
        const risk = profileProjectRisk(projectDir, 5000);
        const policy = {
          preset: presetName,
          mode: preset.mode,
          maxDelegationDepth: 3,
          maxReviewFixRounds: 2,
          requireRollbackForWrites: true,
          alwaysConfirm: preset.alwaysConfirm,
          forbiddenPaths: preset.forbiddenPaths,
          allowedPaths: [],
          paused: false,
          createdAt: nowIso(),
          generatedBy: SERVER_NAME,
          projectRiskAtCreation: risk.risk,
        };
        writeJson(file, policy);
        audit({ type: "init_project_collab", projectDir, preset: presetName, policyFile: file });
        return { status: "created", policyFile: file, policy, risk };
      });
    }
    case "profile_project_risk":
      return profileProjectRisk(args.projectDir || projectRoot, Number(args.maxFiles || 5000));
    case "get_collab_status":
      return collabStatus(args.projectDir || projectRoot, Number(args.recentLimit || 10));
    case "pause_collaboration": {
      const policy = updatePolicyPatch({ paused: true });
      audit({ type: "pause_collaboration", reason: args.reason || "not specified" });
      return { status: "paused", policy, userMessage: "New cross-agent calls are paused. Existing logs and pending calls are preserved." };
    }
    case "resume_collaboration": {
      const policy = updatePolicyPatch({ paused: false });
      audit({ type: "resume_collaboration", reason: args.reason || "not specified" });
      return { status: "resumed", policy, userMessage: "Cross-agent calls may run again according to the active policy." };
    }
    case "emergency_stop": {
      const canceled = cancelAllPending(args.reason || "emergency stop");
      withLocksMutation(() => saveLocks([]));
      const policy = updatePolicyPatch({ paused: true, mode: "cautious" });
      audit({ type: "emergency_stop", reason: args.reason || "not specified", canceled });
      return {
        status: "stopped",
        userMessage: "Emergency stop engaged: mode is cautious, collaboration is paused, pending calls are canceled, and locks are released.",
        canceledPendingCalls: canceled,
        releasedLocks: true,
        policy,
      };
    }
    case "ask_codex_to_review": {
      const prompt = [
        "Review the following project work. Stay read-only. Focus on bugs, missing tests, unsafe behavior, and rollback clarity.",
        args.files?.length ? `Files or scope: ${args.files.join(", ")}` : "",
        `User request: ${args.prompt}`,
      ].filter(Boolean).join("\n\n");
      const result = await callTool("call_codex", {
        prompt,
        cwd: args.cwd || projectRoot,
        sandbox: "read-only",
        approvalPolicy: "never",
        intent: "read_only",
        requestedCapability: "codex_review",
        files: args.files || [],
        confirmedCallId: args.confirmedCallId,
        confirmationText: args.confirmationText,
      });
      return withHarness(result, {
        ...args,
        goal: args.prompt,
        state: result.status === "pending_confirmation" ? "pending_confirmation" : "codex_reviewing",
        files: args.files || [],
        nextAction: result.status === "pending_confirmation"
          ? "Review and approve or deny the pending Codex review call."
          : "Record Codex review findings and decide whether Claude should fix them.",
      });
    }
    case "ask_codex_to_audit_config": {
      const prompt = [
        "Audit configuration risk. Do not print secret values. Report file, type, risk, recommendation, validation, and rollback considerations.",
        args.files?.length ? `Files or scope: ${args.files.join(", ")}` : "",
        `User request: ${args.prompt}`,
      ].filter(Boolean).join("\n\n");
      return callTool("call_codex", {
        prompt,
        cwd: args.cwd || projectRoot,
        sandbox: "read-only",
        approvalPolicy: "never",
        intent: "read_only",
        requestedCapability: "codex_config_audit",
        files: args.files || [],
        confirmedCallId: args.confirmedCallId,
        confirmationText: args.confirmationText,
      });
    }
    case "ask_claude_to_validate_runtime": {
      const prompt = [
        "Validate runtime behavior from Claude Code's perspective. Prefer read-only checks unless the user explicitly approved changes.",
        args.files?.length ? `Files or scope: ${args.files.join(", ")}` : "",
        `User request: ${args.prompt}`,
      ].filter(Boolean).join("\n\n");
      const result = await callTool("call_claude_cli", {
        prompt,
        cwd: args.cwd || projectRoot,
        permissionMode: "default",
        outputFormat: "text",
        intent: "validate",
        files: args.files || [],
        confirmedCallId: args.confirmedCallId,
        confirmationText: args.confirmationText,
      });
      return withHarness(result, {
        ...args,
        goal: args.prompt,
        state: result.status === "pending_confirmation" ? "pending_confirmation" : "validating",
        files: args.files || [],
        nextAction: result.status === "pending_confirmation"
          ? "Review and approve or deny the pending Claude validation call."
          : "Record validation evidence and run the quality gate.",
      });
    }
    case "start_project_task": {
      const plan = taskPlanFromGoal(args.goal, args);
      audit({ type: "start_project_task", goal: args.goal, projectDir: args.projectDir || projectRoot });
      return withHarness({
        userMessage: "Draft task plan created. Review scope, validation, risk, and rollback before execution.",
        plan,
      }, {
        ...args,
        state: "planned",
        goal: args.goal,
        files: args.files || args.scope || plan.scope,
        validation: plan.validation,
        rollback: plan.rollback,
        route: { primaryAgent: plan.primaryAgent, reviewerAgent: plan.reviewerAgent },
        nextAction: "Review the draft task plan, then approve or request changes.",
      });
    }
    case "build_project_context_pack": {
      const pack = contextPack(args.projectDir || projectRoot);
      audit({ type: "build_project_context_pack", projectDir: args.projectDir || projectRoot });
      return pack;
    }
    case "run_quality_gate": {
      const gate = qualityGateReport(args);
      return withHarness(gate, {
        ...args,
        state: gate.done ? "final_gate" : "validating",
        qualityGate: gate,
        nextAction: gate.done ? "Summarize final result and close the task." : "Address quality gate blocking issues before closeout.",
      });
    }
    case "list_task_mode_presets":
      return {
        presets: Object.fromEntries(Object.entries(TASK_MODE_PRESETS).map(([name, preset]) => [name, {
          ...preset,
          evidenceSchema: evidenceSchema({ taskMode: name }),
        }])),
      };
    case "get_task_mode_preset": {
      const preset = taskModePreset(args);
      return {
        preset,
        evidenceSchema: evidenceSchema({ ...args, taskMode: preset.name }),
        nextPromptDrafts: buildNextPromptDraft({ ...args, taskMode: preset.name, state: "planning" }),
      };
    }
    case "build_execution_harness": {
      const executionHarness = buildExecutionHarness(args);
      return withHarness({
        status: executionHarness.clarity.readyForExecution ? "ready" : "needs_clarification",
        userMessage: executionHarness.clarity.readyForExecution
          ? "Execution harness is ready for plan approval or dispatch."
          : "Execution harness needs clarification before dispatch.",
        executionHarness,
      }, {
        ...args,
        state: executionHarness.clarity.readyForExecution ? "planned" : "clarifying",
        route: executionHarness.route,
        risk: executionHarness.risk,
        nextAction: executionHarness.clarity.readyForExecution
          ? "Approve the plan or prepare execution through the active confirmation policy."
          : "Ask the user the clarification questions before execution.",
      });
    }
    case "build_next_prompt_draft":
      return {
        version: HARNESS_VERSION,
        taskMode: taskModePreset(args).name,
        nextPromptDrafts: buildNextPromptDraft(args),
      };
    case "get_evidence_schema":
      return evidenceSchema(args);
    case "evaluate_stop_condition":
      return evaluateStopCondition(args);
    case "plan_review_fix_loop": {
      const plan = args.planId ? loadRecord("plans", args.planId) : null;
      const run = args.runId ? loadRun(args.runId) : null;
      if (args.planId && !plan) throw new Error("Unknown planId");
      if (args.runId && !run) throw new Error("Unknown runId");
      const goal = args.goal || run?.goal || plan?.goal || "";
      const files = args.files || run?.files || plan?.taskPlan?.scope || [];
      const validation = args.validation || plan?.taskPlan?.validation || [];
      const rollback = args.rollback || plan?.taskPlan?.rollback || "";
      const preset = taskModePreset({ ...args, goal, files });
      let loopState = {
        reviewFixRound: Number(args.reviewFixRound || 0),
        failureCount: Number(args.failureCount || 0),
        lastFailureType: "",
        failures: [],
      };
      if (run) {
        loopState = ensureRunLoop(run);
        loopState.reviewFixRound = Math.max(loopState.reviewFixRound, Number(args.reviewFixRound ?? loopState.reviewFixRound));
        loopState.failureCount = Math.max(loopState.failureCount, Number(args.failureCount ?? loopState.failureCount));
        saveRun(run);
      }
      const qualityGate = qualityGateReport({
        taskMode: preset.name,
        goal,
        validation,
        evidence: args.evidence || {},
        rollback,
        reviewed: Boolean(args.evidence?.reviewFindings || args.evidence?.review),
        openRisks: args.evidence?.openRisks || [],
        changedFiles: args.evidence?.changedFiles || [],
        allowedFiles: files,
      });
      const stopCondition = evaluateStopCondition({
        ...args,
        goal,
        files,
        validation,
        rollback,
        qualityGate,
        reviewFixRound: loopState.reviewFixRound,
        failureCount: loopState.failureCount,
        phase: run?.state || "planning",
      });
      const loop = {
        version: HARNESS_VERSION,
        goal: redact(goal),
        taskMode: preset.name,
        currentState: run?.state || "planned",
        reviewFixRound: loopState.reviewFixRound,
        failureCount: loopState.failureCount,
        maxReviewFixRounds: preset.maxReviewFixRounds,
        maxFailures: preset.maxFailures,
        lastFailureType: loopState.lastFailureType || "",
        stopCondition,
        steps: [
          { id: "clarify", owner: "human", action: "Clarify missing scope, validation, rollback, and sensitive areas." },
          { id: "approve", owner: "human", action: "Approve the plan and any high-risk confirmations." },
          { id: "implement", owner: "claude-code", action: "Implement only inside approved scope and report changed files plus validation evidence." },
          { id: "review", owner: "codex", action: "Review implementation for bugs, risk, validation gaps, and rollback gaps." },
          { id: "fix", owner: "claude-code", action: "Fix accepted review findings within approved scope." },
          { id: "quality_gate", owner: "gateway", action: "Run quality gate and stop when it passes or a stop condition triggers." },
        ],
      };
      return withHarness({ status: stopCondition.shouldStop ? "stopped" : "planned", loop, qualityGate }, {
        ...args,
        goal,
        files,
        validation,
        rollback,
        state: loop.currentState,
        qualityGate,
        stopCondition,
        nextAction: stopCondition.nextAction,
      });
    }
    case "record_loop_failure": {
      const explanation = explainError(args);
      let persistedFailureCount = Number(args.failureCount || 0) + 1;
      if (args.runId) {
        const run = loadRun(args.runId);
        if (!run) throw new Error("Unknown runId");
        const loop = ensureRunLoop(run);
        const previousFailureCount = Math.max(loop.failureCount, Number(args.failureCount || 0));
        loop.failureCount = previousFailureCount + 1;
        loop.lastFailureType = args.failureType || "unknown";
        loop.failures.push({
          time: nowIso(),
          step: redact(args.step || ""),
          failureType: redact(args.failureType || "unknown"),
          retryable: args.retryable !== false,
        });
        persistedFailureCount = loop.failureCount;
        run.evidence.push({
          time: nowIso(),
          kind: "logs",
          summary: redact(args.error || args.step || "Loop failure"),
          evidence: redactStructured({ failureType: args.failureType || "unknown", retryable: args.retryable !== false }),
        });
        run.history.push({ time: nowIso(), state: run.state, event: "loop_failure_recorded", step: redact(args.step || "") });
        saveRun(run);
      }
      if (args.taskId) {
        addTimelineEvent(args.taskId, {
          actor: "gateway",
          event: "loop_failure_recorded",
          details: `${args.step || "unknown step"}: ${args.failureType || "unknown failure"}`,
        });
      }
      const stopCondition = evaluateStopCondition({
        ...args,
        failureCount: persistedFailureCount,
        phase: "failure",
      });
      return withHarness({
        status: stopCondition.shouldStop ? "blocked" : "retry_prepared",
        userMessage: explanation.userMessage,
        suggestedFix: explanation.suggestedFix,
        recoverySteps: [
          "Classify the failure and confirm whether the task still matters.",
          "Retry only if the failure is understood and the stop condition allows it.",
          "Ask the human before retrying risky, permission-related, or repeatedly failing steps.",
          "Record rollback evidence if stopping or reverting.",
        ],
      }, {
        ...args,
        state: "blocked",
        stopCondition,
        nextAction: stopCondition.nextAction,
      });
    }
    case "get_user_dashboard": {
      const status = collabStatus(args.projectDir || projectRoot, Number(args.recentLimit || 10));
      return withHarness({
        title: "Codex-Claude Collaboration Dashboard",
        userMessage: status.userMessage,
        mode: status.mode,
        paused: status.paused,
        needsUserAction: status.pendingConfirmations.length > 0,
        pendingConfirmations: status.pendingConfirmations.map((call) => ({
          callId: call.callId,
          riskLevel: call.riskLevel,
          target: call.target,
          action: call.action,
          userMessage: call.preflight?.userMessage,
          recommendation: call.preflight?.recommendation,
        })),
        activeLocks: status.activeLocks,
        projectRisk: status.projectRisk,
        recentAudit: status.recentAudit,
        nextBestAction: status.pendingConfirmations.length
          ? "Review pending confirmation details, then confirm or cancel."
          : status.paused
            ? "Resume collaboration when ready."
            : "Start a task or request review/validation.",
      }, {
        ...args,
        state: status.paused ? "paused" : status.pendingConfirmations.length ? "pending_confirmation" : "idle",
        nextAction: status.pendingConfirmations.length
          ? "Review pending confirmation details, then confirm or cancel."
          : status.paused
            ? "Resume collaboration when ready."
            : "Start a task or request review/validation.",
      });
    }
    case "summarize_final_result":
      return withHarness(summarizeResult(args), {
        ...args,
        state: "final_gate",
        qualityGate: qualityGateReport({ ...args, goal: args.goal || args.summary }),
        nextAction: "Close the task if the quality gate passed; otherwise address blocking issues.",
      });
    case "implement_with_review": {
      const projectDir = args.projectDir || projectRoot;
      const clarity = analyzeRequirementClarity({
        goal: args.goal,
        projectDir,
        scope: args.files || [],
        successCriteria: args.successCriteria || [],
        validation: args.validation || [],
        rollback: args.rollback || "",
        sensitiveAreas: args.sensitiveAreas || [],
      });
      if (!clarity.readyForExecution) {
        return withHarness({
          status: "needs_clarification",
          userMessage: "Implementation is blocked until the missing requirements are clarified.",
          clarity,
        }, {
          ...args,
          state: "clarifying",
          goal: args.goal,
          blockingIssues: clarity.missing,
          nextAction: "Ask the user the clarification questions before implementation.",
        });
      }
      const plan = taskPlanFromGoal(args.goal, {
        projectDir,
        scope: args.files || [],
        successCriteria: args.successCriteria || [],
        validation: args.validation || [],
        rollback: args.rollback || "",
        sensitiveAreas: args.sensitiveAreas || [],
        primaryAgent: "claude-code",
        reviewerAgent: "codex",
      });
      const pack = contextPack(projectDir);
      const prompt = [
        "Implement the approved task in the target project, then stop and summarize changed files plus validation evidence.",
        "Stay inside the stated scope. Do not touch secrets, credentials, hooks, MCP configuration, deployment files, or permissions unless explicitly approved.",
        `Goal: ${args.goal}`,
        args.files?.length ? `Scope files: ${args.files.join(", ")}` : "",
        args.validation?.length ? `Expected validation: ${args.validation.join("; ")}` : "",
        `Context pack: ${JSON.stringify(pack).slice(0, 12000)}`,
      ].filter(Boolean).join("\n\n");
      const dispatch = await callTool("call_claude_cli", {
        prompt,
        cwd: projectDir,
        permissionMode: "default",
        outputFormat: "text",
        intent: "mutate",
        files: args.files || [],
        requestedCapability: "claude_implementation",
        confirmedCallId: args.confirmedCallId,
        confirmationText: args.confirmationText,
      });
      audit({ type: "implement_with_review", goal: args.goal, projectDir });
      return withHarness({
        userMessage: dispatch.status === "pending_confirmation"
          ? "Implementation workflow is prepared and waiting for your confirmation."
          : "Implementation workflow dispatched. Request Codex review after Claude returns changes and validation evidence.",
        plan,
        contextPackSummary: {
          projectRisk: pack.risk.risk,
          languages: pack.conventions.languages,
          testHints: pack.conventions.testHints,
        },
        dispatch,
        nextSteps: [
          "If pending, confirm or cancel the implementation dispatch.",
          "After implementation, run ask_codex_to_review with changed files and validation summary.",
          "Run run_quality_gate before closing the task.",
        ],
      }, {
        ...args,
        state: dispatch.status === "pending_confirmation" ? "pending_confirmation" : "implementing",
        goal: args.goal,
        files: args.files || [],
        validation: args.validation || [],
        rollback: args.rollback || "",
        route: { primaryAgent: "claude-code", reviewerAgent: "codex" },
        nextAction: dispatch.status === "pending_confirmation"
          ? "Review and approve or deny the pending implementation dispatch."
          : "Record changed files and validation evidence, then request Codex review.",
      });
    }
    case "analyze_requirement_clarity":
      return analyzeRequirementClarity(args);
    case "request_clarification": {
      const clarity = analyzeRequirementClarity(args);
      return withHarness({
        status: clarity.status,
        readyForExecution: clarity.readyForExecution,
        questions: clarity.questions,
        missing: clarity.missing,
        recommendedNextAction: clarity.readyForExecution
          ? "Proceed to plan approval or execution confirmation."
          : "Ask the user these questions before formal execution.",
      }, {
        ...args,
        state: clarity.readyForExecution ? "planned" : "clarifying",
        goal: args.goal,
        blockingIssues: clarity.missing,
        nextAction: clarity.readyForExecution
          ? "Proceed to plan approval or execution confirmation."
          : "Ask the user these questions before formal execution.",
      });
    }
    case "start_collab_run": {
      const run = createRunRecord(args);
      audit({ type: "start_collab_run", runId: run.runId, state: run.state, projectDir: run.projectDir });
      return withHarness({
        userMessage: run.clarity.readyForExecution
          ? "Collaboration run created and ready for plan approval."
          : "Collaboration run created but needs clarification before execution.",
        run,
      }, {
        ...args,
        state: run.state,
        goal: run.goal,
        run,
        route: { primaryAgent: run.primaryAgent, reviewerAgent: run.reviewerAgent },
        blockingIssues: run.clarity.readyForExecution ? [] : run.clarity.missing,
        nextAction: run.clarity.readyForExecution ? "Approve the run plan or advance it to approved." : "Clarify missing requirements before execution.",
      });
    }
    case "get_collab_run": {
      const run = loadRun(args.runId);
      if (!run) throw new Error("Unknown runId");
      return run;
    }
    case "advance_collab_run": {
      const run = loadRun(args.runId);
      if (!run) throw new Error("Unknown runId");
      if (args.nextState !== "clarifying" && !run.clarity?.readyForExecution && ["approved", "implementing", "validating", "codex_reviewing", "final_gate", "done"].includes(args.nextState)) {
        return withHarness({
          status: "blocked",
          userMessage: "Run cannot advance to execution states until clarification is complete.",
          clarity: run.clarity,
          run,
        }, {
          ...args,
          state: run.state,
          goal: run.goal,
          run,
          blockingIssues: run.clarity?.missing || [],
          nextAction: "Resolve clarification gaps before advancing the run.",
        });
      }
      const loop = ensureRunLoop(run);
      if (args.nextState === "fixing") {
        loop.reviewFixRound += 1;
      }
      const next = transitionRun(run, args.nextState, {
        event: "state_advanced",
        actor: args.actor || "gateway",
        summary: redact(args.summary || ""),
        loop: { reviewFixRound: loop.reviewFixRound, failureCount: loop.failureCount },
      });
      audit({ type: "advance_collab_run", runId: run.runId, state: next.state });
      return withHarness({ status: "advanced", run: next }, {
        ...args,
        state: next.state,
        goal: next.goal,
        run: next,
        nextAction: "Continue the run according to the next state and record evidence.",
      });
    }
    case "advance_task_loop": {
      const run = loadRun(args.runId);
      if (!run) throw new Error("Unknown runId");
      const actor = args.actor || "gateway";
      ensureRunLoop(run);
      if (args.evidence) appendEvidencePacket(run, args.evidence, args.summary || "Loop evidence recorded.", actor);
      if (!args.ignorePending) {
        const pending = nextPendingCall("");
        if (pending) {
          return withHarness({
            status: "pending_confirmation",
            run,
            approvalCard: pendingActionCard(pending),
            userMessage: "A pending approval must be resolved before the loop advances.",
          }, {
            ...args,
            state: "pending_confirmation",
            goal: run.goal,
            run,
            risk: pending.risk,
            nextAction: "Approve, deny, or revise the pending action.",
          });
        }
      }
      if (args.decision === "cancel") {
        const next = transitionRun(run, "canceled", { event: "loop_canceled", actor, summary: redact(args.summary || "Canceled by request.") });
        return withHarness({ status: "canceled", run: next }, { ...args, state: next.state, goal: next.goal, run: next, nextAction: "No further automatic loop action will run." });
      }
      if (!run.clarity?.readyForExecution) {
        return withHarness({
          status: "needs_clarification",
          run,
          clarity: run.clarity,
          userMessage: "The task still needs clarification before execution.",
        }, {
          ...args,
          state: run.state,
          goal: run.goal,
          run,
          blockingIssues: run.clarity?.missing || [],
          nextAction: "Answer the clarification questions, then update or restart the run.",
        });
      }
      if (run.state === "done" || run.state === "canceled") {
        return withHarness({ status: run.state, run, userMessage: `Run is already ${run.state}.` }, {
          ...args,
          state: run.state,
          goal: run.goal,
          run,
          nextAction: "Start a new run if additional work is needed.",
        });
      }
      if (run.state === "planned") {
        if (args.decision !== "approve" && args.humanApproved !== true) {
          return withHarness({
            status: "needs_human",
            run,
            userMessage: "Run is planned and needs human approval before implementation.",
          }, {
            ...args,
            state: "planned",
            goal: run.goal,
            run,
            nextAction: "Call advance_task_loop with decision=approve after human approval, or revise the plan.",
          });
        }
        const approval = {
          approvedBy: actor,
          decision: "approved",
          scope: "run_plan",
          time: nowIso(),
          notes: redact(args.summary || "Human approved planned run."),
        };
        appendEvidencePacket(run, { humanApprovals: [approval] }, "Run plan approved by human.", actor);
        const next = transitionRun(run, "approved", { event: "run_plan_approved", actor, summary: redact(args.summary || "") });
        return withHarness({ status: "advanced", run: next, approval }, {
          ...args,
          state: next.state,
          goal: next.goal,
          run: next,
          nextAction: "Advance again to prepare implementation guidance.",
        });
      }
      if (run.state === "approved") {
        const next = transitionRun(run, "implementing", { event: "loop_implementation_ready", actor, summary: redact(args.summary || "") });
        return withHarness({ status: "advanced", run: next }, {
          ...args,
          state: next.state,
          goal: next.goal,
          run: next,
          route: { primaryAgent: next.primaryAgent, reviewerAgent: next.reviewerAgent },
          nextAction: "Send the nextClaudePrompt to Claude Code, then record changed files and validation evidence.",
        });
      }
      const evidence = normalizeEvidence({}, run);
      if (run.state === "implementing") {
        if (!arrayLength(evidence.changedFiles) || !arrayLength(evidence.validation)) {
          return withHarness({
            status: "waiting_for_evidence",
            run,
            missingEvidence: ["changedFiles", "validation"].filter((type) => !arrayLength(evidence[type])),
            userMessage: "Implementation evidence is needed before validation/review.",
          }, {
            ...args,
            state: run.state,
            goal: run.goal,
            run,
            nextAction: "Record changedFiles and validation evidence, then advance the loop.",
          });
        }
        const next = transitionRun(run, "validating", { event: "implementation_evidence_ready", actor, summary: redact(args.summary || "") });
        return withHarness({ status: "advanced", run: next }, { ...args, state: next.state, goal: next.goal, run: next, nextAction: "Evaluate validation and route to Codex review." });
      }
      if (run.state === "validating") {
        if (!arrayLength(evidence.reviewFindings)) {
          const next = transitionRun(run, "codex_reviewing", { event: "review_requested", actor, summary: redact(args.summary || "") });
          return withHarness({ status: "advanced", run: next }, { ...args, state: next.state, goal: next.goal, run: next, nextAction: "Send nextCodexPrompt to Codex and record review findings." });
        }
        const gate = qualityGateReport({ ...args, goal: run.goal, run, evidence, taskMode: args.taskMode || taskModeName({ goal: run.goal }) });
        if (gate.done) {
          const next = transitionRun(run, "final_gate", { event: "quality_gate_ready", actor, summary: "Quality gate passed." });
          return withHarness({ status: "advanced", run: next, qualityGate: gate }, { ...args, state: next.state, goal: next.goal, run: next, qualityGate: gate, nextAction: "Advance once more to close the run if no stop condition blocks it." });
        }
        const next = transitionRun(run, "fixing", { event: "quality_gate_needs_fix", actor, summary: gate.blockingIssues.join("; ") });
        return withHarness({ status: "advanced", run: next, qualityGate: gate }, { ...args, state: next.state, goal: next.goal, run: next, qualityGate: gate, blockingIssues: gate.blockingIssues, nextAction: "Fix blocking issues, record fixes, then advance again." });
      }
      if (run.state === "codex_reviewing") {
        if (!arrayLength(evidence.reviewFindings)) {
          return withHarness({ status: "waiting_for_review", run, userMessage: "Codex review findings are needed before the loop advances." }, {
            ...args,
            state: run.state,
            goal: run.goal,
            run,
            nextAction: "Record reviewFindings evidence, even if the finding list is empty with an explicit review note.",
          });
        }
        const nextState = arrayLength(evidence.openRisks) || arrayLength(evidence.fixesApplied) === 0 ? "fixing" : "final_gate";
        const next = transitionRun(run, nextState, { event: nextState === "fixing" ? "review_needs_fix" : "review_complete", actor, summary: redact(args.summary || "") });
        return withHarness({ status: "advanced", run: next }, { ...args, state: next.state, goal: next.goal, run: next, nextAction: nextState === "fixing" ? "Fix accepted review findings and record fixesApplied." : "Run final quality gate." });
      }
      if (run.state === "fixing") {
        const next = transitionRun(run, "validating", { event: "fix_ready_for_validation", actor, summary: redact(args.summary || "") });
        return withHarness({ status: "advanced", run: next }, { ...args, state: next.state, goal: next.goal, run: next, nextAction: "Record validation evidence for the fix, then advance again." });
      }
      if (run.state === "final_gate") {
        const gate = qualityGateReport({ ...args, goal: run.goal, run, evidence, taskMode: args.taskMode || taskModeName({ goal: run.goal }) });
        const stopCondition = evaluateStopCondition({ ...args, goal: run.goal, run, qualityGate: gate, phase: "final_gate" });
        if (gate.done && stopCondition.decision === "ready_for_closeout") {
          const next = transitionRun(run, "done", { event: "loop_closed", actor, summary: "Quality gate passed and no stop condition blocked closeout." });
          return withHarness({ status: "done", run: next, qualityGate: gate, stopCondition }, { ...args, state: next.state, goal: next.goal, run: next, qualityGate: gate, stopCondition, nextAction: "Summarize final result for the user." });
        }
        return withHarness({ status: stopCondition.decision, run, qualityGate: gate, stopCondition, userMessage: "Final gate is not ready to close." }, {
          ...args,
          state: run.state,
          goal: run.goal,
          run,
          qualityGate: gate,
          stopCondition,
          blockingIssues: gate.blockingIssues,
          nextAction: stopCondition.nextAction,
        });
      }
      return withHarness({ status: "unsupported_state", run, userMessage: `No automatic loop action is defined for ${run.state}.` }, {
        ...args,
        state: run.state,
        goal: run.goal,
        run,
        nextAction: "Use advance_collab_run for manual state control.",
      });
    }
    case "record_run_evidence": {
      const run = loadRun(args.runId);
      if (!run) throw new Error("Unknown runId");
      const item = {
        time: nowIso(),
        kind: args.kind,
        summary: redact(args.summary || ""),
        evidence: redactStructured(args.evidence || {}),
      };
      run.evidence.push(item);
      run.history.push({ time: nowIso(), state: run.state, event: "evidence_recorded", kind: args.kind });
      saveRun(run);
      audit({ type: "record_run_evidence", runId: run.runId, kind: args.kind });
      return withHarness({ status: "recorded", run }, {
        ...args,
        state: run.state,
        goal: run.goal,
        run,
        nextAction: "Continue the loop or run the quality gate when evidence is complete.",
      });
    }
    case "record_human_approval": {
      const approval = {
        approvedBy: args.approvedBy || "human",
        decision: args.decision || "approved",
        scope: redact(args.scope || "current task"),
        notes: redact(args.notes || ""),
        time: nowIso(),
      };
      if (args.runId) {
        const run = loadRun(args.runId);
        if (!run) throw new Error("Unknown runId");
        appendEvidencePacket(run, { humanApprovals: [approval] }, "Human approval recorded.", approval.approvedBy);
        audit({ type: "record_human_approval", runId: run.runId, approvedBy: approval.approvedBy });
        return withHarness({ status: "recorded", approval, run }, {
          ...args,
          state: run.state,
          goal: run.goal,
          run,
          nextAction: "Continue the loop or run the quality gate.",
        });
      }
      return { status: "ready", approval, evidence: { humanApprovals: [approval] } };
    }
    case "explain_missing_evidence": {
      const run = args.runId ? loadRun(args.runId) : null;
      if (args.runId && !run) throw new Error("Unknown runId");
      const gate = qualityGateReport({
        ...args,
        goal: args.goal || run?.goal,
        run,
        evidence: args.evidence || normalizeEvidence({}, run),
      });
      const missing = gate.evidence?.missingRequiredEvidence || [];
      const suggestions = missing.map((type) => ({
        type,
        suggestion: {
          validation: "Record command/check name, exit code, and a short summary.",
          changedFiles: "Record the changed files that are inside the approved scope.",
          reviewFindings: "Record Codex/Claude review findings, or an explicit empty review result.",
          fixesApplied: "Record fixes made for accepted review findings.",
          rollbackPlan: "Record backup path, revert command, or restore strategy.",
          screenshots: "Attach or describe visual evidence for UI/document work.",
          logs: "Attach relevant redacted logs.",
          humanApprovals: "Call record_human_approval after the human approves scope, risk, or closeout.",
          openRisks: "Record unresolved risks, or an explicit empty list when none remain.",
        }[type] || "Record this evidence type before closeout.",
      }));
      return withHarness({
        status: missing.length ? "missing_evidence" : "complete",
        qualityGate: gate,
        missingEvidence: missing,
        suggestions,
        suggestedEvidencePacket: {
          validation: [],
          changedFiles: args.changedFiles || [],
          reviewFindings: [],
          rollbackPlan: args.rollbackSummary ? [args.rollbackSummary] : [],
          humanApprovals: [],
          openRisks: args.openRisks || [],
        },
      }, {
        ...args,
        state: missing.length ? "evidence_needed" : "evidence_ready",
        goal: args.goal || run?.goal,
        run,
        qualityGate: gate,
        blockingIssues: gate.blockingIssues,
        nextAction: missing.length ? "Record the missing evidence, then rerun the quality gate." : "Proceed to final closeout.",
      });
    }
    case "create_plan": {
      const plan = createPlanRecord(args);
      addTimelineEvent(plan.planId, {
        actor: "gateway",
        event: "plan_created",
        details: `Draft plan created for: ${plan.goal}`,
      });
      audit({ type: "create_plan", planId: plan.planId, projectDir: plan.projectDir });
      return withHarness({
        userMessage: "Draft plan created. Review it before approving execution.",
        plan,
      }, {
        ...args,
        state: "planned",
        goal: plan.goal,
        files: plan.taskPlan?.scope || [],
        validation: plan.taskPlan?.validation || [],
        rollback: plan.taskPlan?.rollback || "",
        route: plan.route,
        nextAction: "Approve the plan or request changes before execution.",
      });
    }
    case "revise_plan": {
      const plan = loadRecord("plans", args.planId);
      if (!plan) throw new Error("Unknown planId");
      const change = {
        time: nowIso(),
        requestedChange: redact(args.requestedChange),
      };
      plan.requestedChanges = [...(plan.requestedChanges || []), change];
      plan.status = args.status || "revision_requested";
      plan.updatedAt = nowIso();
      saveRecord("plans", args.planId, plan);
      addTimelineEvent(args.planId, {
        actor: "human",
        event: "plan_revision_requested",
        details: args.requestedChange,
      });
      audit({ type: "revise_plan", planId: args.planId });
      return {
        userMessage: "Plan revision request recorded. The plan should be revised before execution.",
        plan,
      };
    }
    case "approve_plan": {
      const plan = loadRecord("plans", args.planId);
      if (!plan) throw new Error("Unknown planId");
      plan.status = "approved";
      plan.approvedAt = nowIso();
      plan.approvedBy = args.approvedBy || "human";
      plan.updatedAt = nowIso();
      saveRecord("plans", args.planId, plan);
      addTimelineEvent(args.planId, {
        actor: plan.approvedBy,
        event: "plan_approved",
        details: "Plan approved for execution preparation.",
      });
      audit({ type: "approve_plan", planId: args.planId, approvedBy: plan.approvedBy });
      return withHarness({
        userMessage: "Plan approved. Execution still goes through the active confirmation policy.",
        plan,
      }, {
        ...args,
        state: "approved",
        goal: plan.goal,
        files: plan.taskPlan?.scope || [],
        validation: plan.taskPlan?.validation || [],
        rollback: plan.taskPlan?.rollback || "",
        route: plan.route,
        nextAction: "Prepare execution through execute_approved_plan.",
      });
    }
    case "execute_approved_plan": {
      const plan = loadRecord("plans", args.planId);
      if (!plan) throw new Error("Unknown planId");
      if (plan.status !== "approved") {
        return withHarness({
          status: "blocked",
          userMessage: "This plan is not approved yet. Approve or revise the plan before execution.",
          plan,
        }, {
          ...args,
          state: plan.status,
          goal: plan.goal,
          blockingIssues: ["Plan is not approved."],
          nextAction: "Approve or revise the plan before execution.",
        });
      }
      const clarity = analyzeRequirementClarity({
        goal: plan.goal,
        projectDir: plan.projectDir || projectRoot,
        scope: plan.taskPlan?.scope || [],
        successCriteria: plan.taskPlan?.successCriteria || [],
        validation: plan.taskPlan?.validation || [],
        rollback: plan.taskPlan?.rollback || "",
        sensitiveAreas: plan.taskPlan?.sensitiveAreas || [],
      });
      if (!clarity.readyForExecution) {
        return withHarness({
          status: "needs_clarification",
          userMessage: "Approved plan still lacks required execution details.",
          clarity,
          plan,
        }, {
          ...args,
          state: "clarifying",
          goal: plan.goal,
          files: plan.taskPlan?.scope || [],
          validation: plan.taskPlan?.validation || [],
          rollback: plan.taskPlan?.rollback || "",
          blockingIssues: clarity.missing,
          nextAction: "Clarify missing execution details before dispatch.",
        });
      }
      const dispatch = await callTool("implement_with_review", {
        goal: plan.goal,
        projectDir: plan.projectDir || projectRoot,
        files: plan.taskPlan?.scope || [],
        successCriteria: plan.taskPlan?.successCriteria || [],
        validation: plan.taskPlan?.validation || [],
        rollback: plan.taskPlan?.rollback || "",
        sensitiveAreas: plan.taskPlan?.sensitiveAreas || [],
        confirmedCallId: args.confirmedCallId,
        confirmationText: args.confirmationText,
      });
      addTimelineEvent(args.planId, {
        actor: "gateway",
        event: "execution_prepared",
        details: dispatch.dispatch?.status || "prepared",
      });
      audit({ type: "execute_approved_plan", planId: args.planId, dispatchStatus: dispatch.dispatch?.status });
      return withHarness({
        userMessage: dispatch.dispatch?.status === "pending_confirmation"
          ? "Execution is prepared and waiting for human confirmation."
          : "Execution has been dispatched through the approved workflow.",
        plan,
        dispatch,
      }, {
        ...args,
        state: dispatch.dispatch?.status === "pending_confirmation" ? "pending_confirmation" : "implementing",
        goal: plan.goal,
        files: plan.taskPlan?.scope || [],
        validation: plan.taskPlan?.validation || [],
        rollback: plan.taskPlan?.rollback || "",
        route: plan.route,
        nextAction: dispatch.dispatch?.status === "pending_confirmation"
          ? "Review and approve or deny the pending execution confirmation."
          : "Record implementation evidence, then request Codex review.",
      });
    }
    case "explain_pending_confirmation": {
      const call = loadPending(args.callId);
      if (!call) throw new Error("Unknown callId");
      return {
        callId: call.callId,
        status: call.status,
        title: "Human confirmation required",
        target: call.preflight?.target,
        action: call.preflight?.action,
        riskLevel: call.risk?.riskLevel,
        reasons: call.risk?.reasons || [],
        files: call.preflight?.files || [],
        cwd: call.preflight?.cwd,
        recommendation: call.preflight?.recommendation,
        requiredConfirmationText: call.requiredConfirmationText,
        options: [
          { action: "approve_pending_call", when: "Scope, files, and rollback expectations are acceptable." },
          { action: "deny_pending_call", when: "The request is unclear, too broad, or touches risky areas." },
          { action: "request_plan_change", when: "The overall task is valid but the plan needs adjustment first." },
        ],
      };
    }
    case "get_pending_action_card": {
      const call = nextPendingCall(args.callId || "");
      const card = pendingActionCard(call);
      return withHarness(card, {
        ...args,
        state: card.status === "pending_confirmation" ? "pending_confirmation" : "idle",
        risk: call?.risk || null,
        nextAction: card.status === "pending_confirmation"
          ? "Choose approve_next_action, deny_next_action, or revise_next_action."
          : "Continue the task loop or start a new task.",
      });
    }
    case "approve_next_action": {
      const call = nextPendingCall(args.callId || "");
      if (!call) return { status: "idle", userMessage: "No pending action is waiting for approval." };
      if (call.status !== "pending_confirmation") return { status: call.status, callId: call.callId, userMessage: "This action is not pending." };
      const confirmed = await callTool("confirm_cross_agent_call", {
        callId: call.callId,
        confirmationText: call.requiredConfirmationText,
        approvedBy: args.approvedBy || "human",
      });
      return withHarness({
        ...confirmed,
        confirmedCallId: call.callId,
        confirmationText: call.requiredConfirmationText,
        retry: {
          confirmedCallId: call.callId,
          confirmationText: call.requiredConfirmationText,
        },
        userMessage: "Action approved. Retry the original action with the returned confirmation arguments.",
      }, {
        ...args,
        state: "approved",
        risk: call.risk,
        nextAction: "Retry the original tool call using confirmedCallId and confirmationText.",
      });
    }
    case "deny_next_action": {
      const call = nextPendingCall(args.callId || "");
      if (!call) return { status: "idle", userMessage: "No pending action is waiting for denial." };
      return callTool("cancel_pending_call", { callId: call.callId, reason: args.reason || "Denied by human." });
    }
    case "revise_next_action": {
      const call = nextPendingCall(args.callId || "");
      if (call?.status === "pending_confirmation") {
        await callTool("cancel_pending_call", { callId: call.callId, reason: `Revision requested: ${args.requestedChange}` });
      }
      if (args.taskId) {
        addTimelineEvent(args.taskId, {
          actor: "human",
          event: "revision_requested",
          details: args.requestedChange,
        });
      }
      return withHarness({
        status: "revision_requested",
        canceledCallId: call?.callId || "",
        requestedChange: redact(args.requestedChange),
        userMessage: "Revision request recorded. Prepare a narrower or corrected action before retrying.",
      }, {
        ...args,
        state: "revision_requested",
        nextAction: "Revise the plan or action, then request approval again.",
      });
    }
    case "approve_pending_call":
      return callTool("confirm_cross_agent_call", args);
    case "deny_pending_call":
      return callTool("cancel_pending_call", args);
    case "request_plan_change":
      return callTool("revise_plan", { ...args, status: "changes_requested" });
    case "get_task_timeline":
      return loadTimeline(args.taskId);
    case "append_task_event": {
      const timeline = addTimelineEvent(args.taskId, {
        actor: args.actor,
        event: args.event,
        details: redact(args.details || ""),
      });
      audit({ type: "append_task_event", taskId: args.taskId, event: args.event, actor: args.actor });
      return { status: "appended", timeline };
    }
    case "summarize_task_progress": {
      const timeline = loadTimeline(args.taskId);
      const counts = timeline.events.reduce((acc, event) => {
        acc[event.event] = (acc[event.event] || 0) + 1;
        return acc;
      }, {});
      const latest = timeline.events.at(-1) || null;
      const nextBestAction = latest?.event === "plan_approved"
        ? "Prepare execution through execute_approved_plan."
        : latest?.event === "execution_prepared"
          ? "Review pending confirmation or wait for execution evidence."
          : timeline.events.length
            ? "Continue with the next planned step and record evidence."
            : "Create a plan or append the first task event.";
      return {
        taskId: args.taskId,
        eventCount: timeline.events.length,
        counts,
        latest,
        nextBestAction,
      };
    }
    case "propose_changes": {
      const proposal = createProposal(args);
      return withHarness({
        userMessage: "Change proposal created. Review and approve it before applying.",
        proposal,
      }, {
        ...args,
        state: "proposed",
        goal: proposal.title,
        files: proposal.files,
        rollback: proposal.rollback,
        risk: proposal.risk,
        nextAction: "Review the proposal, then approve or request changes.",
      });
    }
    case "review_patch_plan": {
      const proposal = loadRecord("proposals", args.proposalId);
      if (!proposal) throw new Error("Unknown proposalId");
      const requiresConfirmation = riskScoreFromLevel(proposal.risk?.riskLevel) >= 5;
      return withHarness({
        proposalId: proposal.proposalId,
        status: proposal.status,
        title: proposal.title,
        summary: proposal.summary,
        files: proposal.files,
        risk: proposal.risk,
        validation: proposal.validation,
        rollback: proposal.rollback,
        requiresConfirmation,
        recommendation: requiresConfirmation
          ? "Approve only after confirming scope, validation, and rollback."
          : "Looks suitable for approval if the summary matches user intent.",
      }, {
        ...args,
        state: proposal.status,
        goal: proposal.title,
        files: proposal.files,
        validation: proposal.validation,
        rollback: proposal.rollback,
        risk: proposal.risk,
        nextAction: requiresConfirmation ? "Approve only after reviewing risk, scope, validation, and rollback." : "Approve if the proposal matches user intent.",
      });
    }
    case "approve_apply": {
      const proposal = loadRecord("proposals", args.proposalId);
      if (!proposal) throw new Error("Unknown proposalId");
      proposal.status = "approved";
      proposal.approvedAt = nowIso();
      proposal.approvedBy = args.approvedBy || "human";
      saveRecord("proposals", args.proposalId, proposal);
      audit({ type: "approve_apply", proposalId: args.proposalId, approvedBy: proposal.approvedBy });
      return withHarness({
        userMessage: "Change proposal approved. Applying still goes through the active confirmation policy.",
        proposal,
      }, {
        ...args,
        state: "approved",
        goal: proposal.title,
        files: proposal.files,
        validation: proposal.validation,
        rollback: proposal.rollback,
        risk: proposal.risk,
        nextAction: "Prepare application through apply_confirmed_changes.",
      });
    }
    case "apply_confirmed_changes": {
      const proposal = loadRecord("proposals", args.proposalId);
      if (!proposal) throw new Error("Unknown proposalId");
      if (proposal.status !== "approved") {
        return withHarness({
          status: "blocked",
          userMessage: "This proposal is not approved yet. Review and approve it before applying.",
          proposal,
        }, {
          ...args,
          state: proposal.status,
          goal: proposal.title,
          files: proposal.files,
          blockingIssues: ["Proposal is not approved."],
          nextAction: "Review and approve the proposal before applying.",
        });
      }
      const prompt = [
        "Apply the approved change proposal exactly within the approved scope.",
        "Create backups when modifying existing files, run relevant validation, and report rollback instructions.",
        `Title: ${proposal.title}`,
        `Summary: ${proposal.summary}`,
        proposal.files?.length ? `Approved files: ${proposal.files.join(", ")}` : "",
        proposal.patch ? `Proposed patch or instructions:\n${proposal.patch.slice(0, 12000)}` : "",
        proposal.validation?.length ? `Validation: ${proposal.validation.join("; ")}` : "",
        `Rollback: ${proposal.rollback}`,
      ].filter(Boolean).join("\n\n");
      const dispatch = await callTool("call_claude_cli", {
        prompt,
        cwd: proposal.projectDir || projectRoot,
        permissionMode: "default",
        outputFormat: "text",
        intent: "mutate",
        files: proposal.files || [],
        confirmedCallId: args.confirmedCallId,
        confirmationText: args.confirmationText,
      });
      audit({ type: "apply_confirmed_changes", proposalId: args.proposalId, dispatchStatus: dispatch.status });
      return withHarness({
        userMessage: dispatch.status === "pending_confirmation"
          ? "Application is prepared and waiting for human confirmation."
          : "Approved change proposal dispatched for application.",
        proposal,
        dispatch,
      }, {
        ...args,
        state: dispatch.status === "pending_confirmation" ? "pending_confirmation" : "implementing",
        goal: proposal.title,
        files: proposal.files,
        validation: proposal.validation,
        rollback: proposal.rollback,
        risk: proposal.risk,
        nextAction: dispatch.status === "pending_confirmation"
          ? "Review and approve or deny the pending application confirmation."
          : "Record changed files and validation evidence after application.",
      });
    }
    case "select_quality_template": {
      const checks = QUALITY_TEMPLATES[args.template];
      if (!checks) throw new Error("Unknown quality template");
      return {
        template: args.template,
        checks,
        requiredEvidence: checks.map((check) => ({
          check,
          expected: {
            goal: "Clear task goal or task reference.",
            validation: "Validation command/result or explanation if skipped.",
            review: "Independent review summary or explicit acceptance of no review.",
            rollback: "Backup path, rollback command, or revert strategy.",
            risks: "Open risks list, ideally empty before closeout.",
          }[check],
        })),
      };
    }
    case "explain_quality_failures": {
      const gate = args.qualityGate || {};
      const failed = (gate.checks || [])
        .filter((check) => check && check.passed === false)
        .map((check) => ({
          id: check.id,
          label: check.label,
          userMessage: `${check.label} is missing or incomplete.`,
        }));
      const fallback = (gate.blockingIssues || []).map((issue) => ({
        id: "blocking_issue",
        label: issue,
        userMessage: issue,
      }));
      return {
        done: Boolean(gate.done),
        score: gate.score,
        failures: failed.length ? failed : fallback,
        suggestedFixes: [
          "Add missing validation evidence.",
          "Record review findings or why review was intentionally skipped.",
          "Document rollback before marking the task complete.",
          "Either resolve open risks or explicitly ask the human to accept them.",
        ],
      };
    }
    case "explain_error":
      return explainError(args);
    case "suggest_recovery": {
      const explanation = explainError(args);
      return withHarness({
        ...explanation,
        recoverySteps: [
          "Read the user-facing explanation and confirm whether the failed step is still needed.",
          "Run health_check if the failure may involve a backend CLI or MCP handshake.",
          "Retry only after correcting scope, permissions, timeout, or writable state directory.",
          "Use emergency_stop if the system is repeatedly requesting risky or unclear actions.",
        ],
      }, {
        ...args,
        state: "blocked",
        nextAction: "Choose retry, rollback, or scope reduction before continuing.",
      });
    }
    case "retry_last_step": {
      if (args.taskId) {
        addTimelineEvent(args.taskId, {
          actor: "gateway",
          event: "retry_prepared",
          details: args.reason || "Retry requested.",
        });
      }
      return withHarness({
        status: "prepared",
        userMessage: "Retry guidance recorded. This tool does not execute automatically.",
        retryPlan: [
          "Confirm the previous failure cause is understood.",
          "Reduce scope if possible.",
          "Retry the original tool call with the same confirmation policy.",
        ],
      }, {
        ...args,
        state: "retry_prepared",
        nextAction: "Retry only after the previous failure cause is understood.",
      });
    }
    case "rollback_last_change": {
      const proposal = args.proposalId ? loadRecord("proposals", args.proposalId) : null;
      const timeline = args.taskId ? loadTimeline(args.taskId) : null;
      return withHarness({
        status: "guidance_only",
        userMessage: "Rollback guidance is provided only; no files were changed by this tool.",
        proposalRollback: proposal?.rollback || null,
        latestTaskEvent: timeline?.events?.at(-1) || null,
        recommendedSteps: [
          "Identify the exact changed files from the final report or proposal.",
          "Restore from the documented backup path or revert the approved patch.",
          "Run the same validation used before closeout.",
          "Record rollback evidence in the task timeline.",
        ],
      }, {
        ...args,
        state: "rolled_back",
        goal: proposal?.title || "rollback",
        rollback: proposal?.rollback || "",
        nextAction: "Apply rollback manually if approved, then record rollback evidence.",
      });
    }
    case "export_task_report": {
      const timeline = args.taskId ? loadTimeline(args.taskId) : null;
      const report = [
        "# Collaboration Task Report",
        "",
        `Generated: ${nowIso()}`,
        args.taskId ? `Task ID: ${args.taskId}` : "",
        "",
        "## Summary",
        redact(args.summary || "Not provided."),
        "",
        "## Changed Files",
        ...(args.changedFiles || ["Not provided."]).map((file) => `- ${file}`),
        "",
        "## Validation",
        redact(args.validationSummary || "Not provided."),
        "",
        "## Review",
        redact(args.reviewSummary || "Not provided."),
        "",
        "## Rollback",
        redact(args.rollbackSummary || "Not provided."),
        "",
        "## Open Risks",
        ...((args.openRisks || []).length ? args.openRisks.map((risk) => `- ${redact(risk)}`) : ["- None supplied."]),
        timeline ? "" : null,
        timeline ? "## Timeline" : null,
        ...(timeline ? timeline.events.map((event) => `- ${event.time} ${event.actor}: ${event.event}${event.details ? ` - ${redact(event.details)}` : ""}`) : []),
      ].filter((line) => line !== null).join("\n");
      return withHarness({ markdown: report }, {
        ...args,
        state: "report_ready",
        goal: args.summary,
        files: args.changedFiles || [],
        validation: args.validationSummary ? [args.validationSummary] : [],
        rollback: args.rollbackSummary || "",
        nextAction: "Share this report with the human, PR, or next agent as closeout evidence.",
      });
    }
    case "generate_pr_summary": {
      const body = [
        "## Summary",
        redact(args.summary || "Not provided."),
        "",
        "## Changed Files",
        ...((args.changedFiles || []).length ? args.changedFiles.map((file) => `- ${file}`) : ["- Not provided."]),
        "",
        "## Validation",
        redact(args.validationSummary || "Not provided."),
        "",
        "## Risks",
        ...((args.risks || []).length ? args.risks.map((risk) => `- ${redact(risk)}`) : ["- None noted."]),
      ].join("\n");
      return withHarness({ markdown: body }, {
        ...args,
        state: "ready_for_pr",
        goal: args.summary,
        files: args.changedFiles || [],
        validation: args.validationSummary ? [args.validationSummary] : [],
        nextAction: "Use this PR summary when publishing the branch or opening a pull request.",
      });
    }
    case "generate_handoff_summary": {
      const body = [
        "# Handoff Summary",
        "",
        `From: ${args.from || "unspecified"}`,
        `To: ${args.to || "unspecified"}`,
        "",
        "## Current State",
        redact(args.summary || "Not provided."),
        "",
        "## Next Steps",
        ...((args.nextSteps || []).length ? args.nextSteps.map((step) => `- ${redact(step)}`) : ["- Not provided."]),
        "",
        "## Risks",
        ...((args.risks || []).length ? args.risks.map((risk) => `- ${redact(risk)}`) : ["- None noted."]),
      ].join("\n");
      return withHarness({ markdown: body }, {
        ...args,
        state: "handoff_ready",
        goal: args.summary,
        nextAction: "Send this handoff summary to the next agent or human reviewer.",
      });
    }
    case "recommend_agent_route":
      return routeRecommendation(args);
    case "explain_agent_route": {
      const route = routeRecommendation(args);
      return {
        ...route,
        userMessage: `Recommended route: ${route.primaryAgent} first, ${route.reviewerAgent} reviews. ${route.rationale.join(" ")}`,
      };
    }
    case "override_agent_route": {
      addTimelineEvent(args.taskId, {
        actor: "human",
        event: "route_overridden",
        details: `${args.primaryAgent} primary, ${args.reviewerAgent} reviewer. ${args.reason || ""}`,
      });
      audit({ type: "override_agent_route", taskId: args.taskId, primaryAgent: args.primaryAgent, reviewerAgent: args.reviewerAgent });
      return {
        status: "recorded",
        route: {
          primaryAgent: args.primaryAgent,
          reviewerAgent: args.reviewerAgent,
          rationale: [redact(args.reason || "Human override.")],
        },
      };
    }
    case "get_dashboard_brief": {
      const dashboard = await callTool("get_user_dashboard", { projectDir: args.projectDir || projectRoot, recentLimit: 5 });
      return withHarness({
        userMessage: dashboard.userMessage,
        mode: dashboard.mode,
        paused: dashboard.paused,
        needsUserAction: dashboard.needsUserAction,
        pendingCount: dashboard.pendingConfirmations.length,
        activeLockCount: dashboard.activeLocks.length,
        projectRisk: dashboard.projectRisk.risk,
        nextBestAction: dashboard.nextBestAction,
      }, {
        ...args,
        state: dashboard.paused ? "paused" : dashboard.needsUserAction ? "pending_confirmation" : "idle",
        nextAction: dashboard.nextBestAction,
      });
    }
    case "get_dashboard_detail": {
      const dashboard = await callTool("get_user_dashboard", {
        projectDir: args.projectDir || projectRoot,
        recentLimit: Number(args.recentLimit || 20),
      });
      return {
        ...dashboard,
        qualityHints: [
          "Use create_plan before complex work.",
          "Use propose_changes before applying risky edits.",
          "Use run_quality_gate before closeout.",
          "Use export_task_report for handoff or PR preparation.",
        ],
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handle(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          "Cross-agent gateway for Claude Code and Codex. Supports cautious, auto, and danger modes. Sensitive cross-agent calls return pending confirmation unless danger mode is active.",
      },
    });
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const data = await callTool(message.params?.name, message.params?.arguments || {});
      send({ jsonrpc: "2.0", id: message.id, result: resultText(data) });
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: redact(error.message || String(error)) } });
    }
    return;
  }
  if (Object.prototype.hasOwnProperty.call(message, "id")) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  }
}

ensureDir(stateRoot);
const serverFramer = new McpFramer((message, mode) => {
  serverTransportMode = mode || serverTransportMode;
  handle(message).catch((error) => {
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: redact(error.message || String(error)) } });
    }
  });
});
process.stdin.on("data", (chunk) => serverFramer.push(chunk));

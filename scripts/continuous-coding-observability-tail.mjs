#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const WORKER = "buildcustom-vibesdk-launch";
const VERSION_ID = "f4488693-4424-46a3-9834-30b214645449";
const WRANGLER_CONFIG = "/tmp/buildcustom-safe-observability-build/wrangler.jsonc";
const WRANGLER_EXECUTABLE = "/tmp/buildcustom-safe-observability-build/node_modules/.bin/wrangler";
const WRANGLER_LOG_SINK = "/dev/null/wrangler-tail-discard.log";
const SESSION_READY_LINE = `Connected to ${WORKER}, waiting for logs...`;
const READY_TIMEOUT_MS = 45_000;
const JSON_GRACE_MS = 1_000;
const CHILD_SHUTDOWN_TIMEOUT_MS = 8_000;
const MAX_FRAME_CHARS = 2 * 1024 * 1024;
const MAX_SAFE_RECORDS = 2_000;
const REPORT_RELATIVE_PATH = "production/vibesdk-launch/observability-tail.json";
const SIGNALS = new Set(["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGQUIT", "SIGUSR1", "SIGUSR2"]);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const BOUNDARIES = new Set([
  "operation.persistence",
  "think.stream-result",
  "tool.execution",
  "think.onStepFinish",
  "tool.execute-and-evidence",
  "think.beforeStep",
  "rpc.callback",
  "stream.forwarding",
  "rpc.callback.onDone",
  "rpc.callback.onError",
  "rpc.callback.onError.delivery",
  "driver.initial-lifecycle",
  "driver.recover-pending-chat",
  "driver.recovery-decision",
  "driver.mark-chat-started",
  "driver.chat",
  "driver.error-lifecycle",
  "driver.mark-chat-resolved",
  "driver.post-chat-lifecycle",
  "driver.post-chat-operation",
  "driver.post-chat-decision",
  "driver.onPassEnd",
  "host.websocket",
  "host.stub.chat",
  "host.pass",
]);
const DIAGNOSTIC_EVENTS = new Set([
  "start",
  "resolved",
  "error",
  "close",
  "decision",
  "forwarded",
  "interrupted",
  "response-hook",
  "put-returned",
  "success",
]);
const CONTEXT_KEYS = [
  "agentId",
  "userId",
  "projectId",
  "sessionId",
  "nativeRequestId",
  "conversationId",
  "operationId",
  "turn",
  "step",
  "toolName",
  "toolCallId",
  "continuationCount",
  "completedPassCount",
  "pendingPromptKind",
  "operationState",
  "modelCalls",
  "toolCalls",
  "checkpointCount",
  "readyState",
  "closeCode",
  "wasClean",
  "decision",
  "streamStatus",
  "stage",
  "chunkType",
  "aborted",
  "httpStatus",
  "finishReason",
  "inputTokens",
  "outputTokens",
  "storageKey",
];
const RECORD_KEYS = new Set(["schema", "timestamp", "boundary", "event", "error", ...CONTEXT_KEYS]);
const IDENTIFIER_KEYS = new Set([
  "agentId",
  "userId",
  "projectId",
  "sessionId",
  "nativeRequestId",
  "conversationId",
  "operationId",
  "toolCallId",
]);
const TOOL_NAMES = new Set([
  "read",
  "write",
  "edit",
  "list",
  "find",
  "grep",
  "delete",
  "ask_questions",
  "browser_console_logs",
  "deploy_space",
  "commit",
  "set_title",
  "finish_task",
]);
const OPERATION_STATES = new Set([
  "RUNNING",
  "COMPLETE",
  "BLOCKED",
  "USER_INPUT_REQUIRED",
  "INCOMPLETE_RESOURCE_LIMIT",
]);
const DECISIONS = new Set(["STOP", "CONTINUE", "BLOCKED", "INCOMPLETE_RESOURCE_LIMIT"]);
const CHUNK_TYPES = new Set(["start-step", "finish-step", "tool-output-available"]);
const FINISH_REASONS = new Set(["stop", "length", "tool-calls", "content-filter", "unknown"]);
const SDK_STAGES = new Set(["parse", "persist", "turn", "stream", "recovery", "transcript"]);
const STORAGE_KEYS = new Set([
  "think_task_lifecycle",
  "think_task_evidence",
  "think_task_operation",
  "think_task_forced_status",
  "think_task_start_intent",
]);
const ERROR_NAMES = new Set([
  "UnknownError",
  "ThrownString",
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "DOMException",
  "AbortError",
  "DataCloneError",
  "NetworkError",
  "TimeoutError",
  "NotFoundError",
  "InvalidStateError",
  "OperationError",
  "SecurityError",
  "AI_APICallError",
  "AI_RetryError",
  "AI_TypeValidationError",
  "AI_InvalidResponseDataError",
  "AI_NoOutputGeneratedError",
  "AI_JSONParseError",
  "AI_InvalidToolInputError",
]);
const ERROR_CODES = new Set([
  "ERR_RPC_CANCELED",
  "RPC_CANCELED",
  "ABORT_ERR",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
]);
const INTERNAL_FILES = new Set([
  "index.js",
  "think.js",
  "ThinkAgent.ts",
  "stream-forwarder.ts",
  "finish-task-tool.ts",
  "diagnostics.ts",
  "context-selector.ts",
  "browser-evidence.ts",
  "browser-logs-tool.ts",
  "deploy-tool.ts",
  "commit-tool.ts",
  "ask-questions-tool.ts",
  "set-title-tool.ts",
  "space-workspace-ops.ts",
]);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isBoundedInteger = (value, min = 0, max = 1_000_000) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

function safeContextValue(key, value) {
  if (IDENTIFIER_KEYS.has(key)) {
    return typeof value === "string" && identifierPattern.test(value) ? value : undefined;
  }
  if ([
    "turn",
    "step",
    "continuationCount",
    "completedPassCount",
    "modelCalls",
    "toolCalls",
    "checkpointCount",
    "readyState",
    "closeCode",
    "httpStatus",
    "inputTokens",
    "outputTokens",
  ].includes(key)) {
    if (key === "readyState") return isBoundedInteger(value, 0, 3) ? value : undefined;
    if (key === "closeCode") return isBoundedInteger(value, 0, 4_999) ? value : undefined;
    if (key === "httpStatus") return isBoundedInteger(value, 100, 599) ? value : undefined;
    return isBoundedInteger(value) ? value : undefined;
  }
  if (key === "wasClean" || key === "aborted") return typeof value === "boolean" ? value : undefined;
  if (key === "toolName") return typeof value === "string" && TOOL_NAMES.has(value) ? value : undefined;
  if (key === "operationState") {
    return typeof value === "string" && OPERATION_STATES.has(value) ? value : undefined;
  }
  if (key === "decision") return typeof value === "string" && DECISIONS.has(value) ? value : undefined;
  if (key === "pendingPromptKind") {
    return value === "INITIAL" || value === "CONTINUATION" ? value : undefined;
  }
  if (key === "streamStatus") {
    return value === "completed" || value === "aborted" || value === "error" ? value : undefined;
  }
  if (key === "chunkType") return typeof value === "string" && CHUNK_TYPES.has(value) ? value : undefined;
  if (key === "finishReason") {
    return typeof value === "string" && FINISH_REASONS.has(value) ? value : undefined;
  }
  if (key === "stage") return typeof value === "string" && SDK_STAGES.has(value) ? value : undefined;
  if (key === "storageKey") return typeof value === "string" && STORAGE_KEYS.has(value) ? value : undefined;
  return undefined;
}

function sanitizeError(error, depth = 0, allowMarker = false) {
  if (depth > 3) return { value: { truncated: true } };
  if (error === null) return { value: { name: "UnknownError" } };
  if (typeof error === "string") return { value: { name: "ThrownString" } };
  if (typeof error !== "object") return { value: { name: "UnknownError" } };
  if (!isPlainObject(error)) return { valid: false };

  const keys = Object.keys(error);
  if (allowMarker && keys.length === 1 && error.circular === true) return { value: { circular: true } };
  if (allowMarker && keys.length === 1 && error.truncated === true) return { value: { truncated: true } };
  if (keys.some((key) => !["name", "code", "frames", "cause"].includes(key))) return { valid: false };
  if (depth >= 3 && own(error, "cause")) return { valid: false };

  const result = {
    name: typeof error.name === "string" && ERROR_NAMES.has(error.name) ? error.name : "UnknownError",
  };
  if (typeof error.code === "string" && ERROR_CODES.has(error.code)) result.code = error.code;
  if (own(error, "frames")) {
    if (!Array.isArray(error.frames) || error.frames.length > 5) return { valid: false };
    const frames = [];
    for (const frame of error.frames) {
      if (
        !isPlainObject(frame) ||
        Object.keys(frame).some((key) => !["file", "line", "column"].includes(key)) ||
        typeof frame.file !== "string" ||
        !INTERNAL_FILES.has(frame.file) ||
        !isBoundedInteger(frame.line, 1, 999_999) ||
        !isBoundedInteger(frame.column, 1, 999_999)
      ) {
        return { valid: false };
      }
      frames.push({ file: frame.file, line: frame.line, column: frame.column });
    }
    if (frames.length) result.frames = frames;
  }
  if (own(error, "cause")) {
    const cause = sanitizeError(error.cause, depth + 1, true);
    if (!own(cause, "value")) return { valid: false };
    result.cause = cause.value;
  }
  return { value: result };
}

function sanitizeDiagnostic(record, agentId) {
  if (!isPlainObject(record) || record.schema !== 1) return null;
  if (Object.keys(record).some((key) => !RECORD_KEYS.has(key))) return null;
  if (typeof record.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.timestamp)) {
    return null;
  }
  const timestamp = Date.parse(record.timestamp);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== record.timestamp) return null;
  if (typeof record.boundary !== "string" || !BOUNDARIES.has(record.boundary)) return null;
  if (typeof record.event !== "string" || !DIAGNOSTIC_EVENTS.has(record.event)) return null;

  const safe = {
    schema: 1,
    timestamp: record.timestamp,
    boundary: record.boundary,
    event: record.event,
  };
  for (const key of CONTEXT_KEYS) {
    if (!own(record, key)) continue;
    const value = safeContextValue(key, record[key]);
    if (value !== undefined) safe[key] = value;
  }
  if (safe.agentId !== agentId) return null;
  if (own(record, "error")) {
    const error = sanitizeError(record.error);
    if (!own(error, "value")) return null;
    safe.error = error.value;
  }
  return safe;
}

function sanitizeEnvelope(envelope, agentId, counts) {
  if (
    !isPlainObject(envelope) ||
    envelope.scriptName !== WORKER ||
    !isPlainObject(envelope.scriptVersion) ||
    envelope.scriptVersion.id !== VERSION_ID ||
    !Array.isArray(envelope.logs)
  ) {
    return [];
  }

  const safeRecords = [];
  for (const log of envelope.logs) {
    if (!isPlainObject(log) || log.level !== "info" || !Array.isArray(log.message)) continue;
    if (log.message.length !== 2 || log.message[0] !== "THINK_DIAGNOSTIC" || !isPlainObject(log.message[1])) continue;
    if (log.message[1].agentId !== agentId) continue;
    counts.diagnosticCandidates += 1;
    const record = sanitizeDiagnostic(log.message[1], agentId);
    if (record) safeRecords.push(record);
    else counts.rejectedDiagnosticRecords += 1;
  }
  return safeRecords;
}

function parseAgentId(argv) {
  if (argv.length !== 1 || !argv[0].startsWith("--agent-id=")) return null;
  const agentId = argv[0].slice("--agent-id=".length);
  return identifierPattern.test(agentId) ? agentId : null;
}

function makeReport(agentId) {
  return {
    schema: 1,
    target: { worker: WORKER, versionId: VERSION_ID, agentId },
    requestedFilter: {
      samplingRate: 1,
      search: agentId,
      versionId: VERSION_ID,
      serverSideSearchRequested: true,
      wranglerConfig: WRANGLER_CONFIG,
    },
    sessions: {
      pretty: {
        format: "pretty",
        status: "not-started",
        connectedAt: null,
        exitStatus: { code: null, signal: null },
      },
      json: {
        format: "json",
        status: "not-started",
        startedAt: null,
        gracePassedAt: null,
        exitStatus: { code: null, signal: null },
      },
    },
    eventCollection: "allowlisted-json-console-info",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    failureCode: null,
    counts: {
      jsonEnvelopes: 0,
      diagnosticCandidates: 0,
      rejectedDiagnosticRecords: 0,
      invalidJsonFrames: 0,
      oversizedJsonFrames: 0,
      safeRecords: 0,
    },
    events: [],
  };
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const reportPath = path.join(repositoryRoot, REPORT_RELATIVE_PATH);

async function atomicReplaceReport(report) {
  const temporaryPath = `${reportPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, reportPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function createPrivateReport(report) {
  await mkdir(path.dirname(reportPath), { recursive: true, mode: 0o700 });
  const handle = await open(reportPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(reportPath, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();
  await chmod(reportPath, 0o600);
}

function createReadyLineMatcher(expected, onMatch) {
  let matching = true;
  let position = 0;
  let carriageReturn = false;
  const reset = () => {
    matching = true;
    position = 0;
    carriageReturn = false;
  };

  return {
    feed(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (carriageReturn) {
          if (character === "\n") {
            if (matching && position === expected.length) onMatch();
            reset();
            continue;
          }
          matching = false;
          carriageReturn = false;
        }
        if (character === "\n") {
          if (matching && position === expected.length) onMatch();
          reset();
        } else if (character === "\r") {
          if (matching && position === expected.length) carriageReturn = true;
          else matching = false;
        } else if (matching) {
          if (position < expected.length && character === expected[position]) position += 1;
          else matching = false;
        }
      }
    },
  };
}

function createJsonObjectStreamParser(onFrame, onOversized) {
  const decoder = new StringDecoder("utf8");
  let active = false;
  let frame = "";
  let oversized = false;
  let braces = 0;
  let brackets = 0;
  let quoted = false;
  let escaped = false;
  let lineHasNonWhitespace = false;

  const reset = () => {
    active = false;
    frame = "";
    oversized = false;
    braces = 0;
    brackets = 0;
    quoted = false;
    escaped = false;
  };
  const append = (character) => {
    if (oversized) return;
    if (frame.length >= MAX_FRAME_CHARS) {
      frame = "";
      oversized = true;
      return;
    }
    frame += character;
  };

  function consume(text) {
    for (const character of text) {
      if (!active) {
        if (character === "\n") {
          lineHasNonWhitespace = false;
          continue;
        }
        if (!lineHasNonWhitespace && (character === " " || character === "\t" || character === "\r")) continue;
        if (!lineHasNonWhitespace && character === "{") {
          active = true;
          braces = 1;
          append(character);
          lineHasNonWhitespace = true;
          continue;
        }
        lineHasNonWhitespace = true;
        continue;
      }

      append(character);
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") braces += 1;
      else if (character === "}") braces -= 1;
      else if (character === "[") brackets += 1;
      else if (character === "]") brackets -= 1;
      if (braces === 0 && brackets === 0) {
        if (oversized) onOversized();
        else onFrame(frame);
        reset();
        lineHasNonWhitespace = true;
      }
    }
  }

  return {
    feed(chunk) {
      consume(decoder.write(chunk));
    },
    finish() {
      consume(decoder.end());
      if (active) reset();
    },
  };
}

async function main() {
  const agentId = parseAgentId(process.argv.slice(2));
  if (!agentId) {
    process.stderr.write("Usage: node scripts/continuous-coding-observability-tail.mjs --agent-id=<newownerAgentId>\n");
    return 2;
  }

  const report = makeReport(agentId);
  try {
    await createPrivateReport(report);
  } catch {
    process.stderr.write("TAIL_FAILED_CLOSED report-unavailable-or-already-exists\n");
    return 1;
  }

  try {
    await access(WRANGLER_EXECUTABLE, fsConstants.X_OK);
  } catch {
    report.failureCode = "wrangler-binary-not-found";
    report.finishedAt = new Date().toISOString();
    await atomicReplaceReport(report).catch(() => {});
    process.stderr.write("TAIL_FAILED_CLOSED wrangler-binary-not-found\n");
    return 1;
  }

  let parentSignal = null;
  let resolveParentSignal;
  const parentSignalPromise = new Promise((resolve) => {
    resolveParentSignal = resolve;
  });
  let saveChain = Promise.resolve();
  let saveFailed = false;
  let ready = false;
  let shuttingDown = false;
  const children = [];
  const forceKillTimers = new Map();

  const saveReport = () => {
    saveChain = saveChain.then(async () => {
      if (!saveFailed) await atomicReplaceReport(report);
    }).catch(() => {
      saveFailed = true;
      report.failureCode = "report-write-failed";
    });
    return saveChain;
  };

  const requestStop = (entry, signal) => {
    if (!entry || entry.closed || entry.child.exitCode !== null || entry.child.signalCode !== null) return;
    try {
      entry.child.kill(signal);
    } catch {
      // Never expose arbitrary subprocess errors.
    }
    if (!forceKillTimers.has(entry)) {
      const timer = setTimeout(() => {
        if (!entry.closed && entry.child.exitCode === null && entry.child.signalCode === null) {
          try {
            entry.child.kill("SIGKILL");
          } catch {
            // Never expose arbitrary subprocess errors.
          }
        }
      }, CHILD_SHUTDOWN_TIMEOUT_MS);
      timer.unref();
      forceKillTimers.set(entry, timer);
    }
  };

  const stopAll = (signal = "SIGTERM") => {
    for (const entry of children) requestStop(entry, signal);
  };

  let prettyReadyResolve;
  const prettyReadyPromise = new Promise((resolve) => {
    prettyReadyResolve = resolve;
  });

  const onSigterm = () => {
    if (parentSignal) return;
    parentSignal = "SIGTERM";
    resolveParentSignal("signal");
    stopAll("SIGTERM");
  };
  const onSigint = () => {
    if (parentSignal) return;
    parentSignal = "SIGINT";
    resolveParentSignal("signal");
    stopAll("SIGINT");
  };
  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);

  const spawnTail = (name, format, onStdout) => {
    const child = spawn(
      WRANGLER_EXECUTABLE,
      [
        "tail",
        WORKER,
        `--format=${format}`,
        "--sampling-rate=1",
        `--search=${agentId}`,
        `--version-id=${VERSION_ID}`,
        `--config=${WRANGLER_CONFIG}`,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          WRANGLER_WRITE_LOGS: "false",
          WRANGLER_LOG_PATH: WRANGLER_LOG_SINK,
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    let resolveClosed;
    const closed = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    const entry = {
      name,
      format,
      child,
      closed: false,
      failureCode: null,
      exitCode: null,
      signal: null,
      closedPromise: closed,
    };
    children.push(entry);

    child.stdout.on("data", (chunk) => {
      child.stdout.pause();
      onStdout(chunk);
      void saveChain.finally(() => {
        if (!entry.closed && child.exitCode === null && child.signalCode === null) child.stdout.resume();
      });
    });
    child.stdout.on("error", () => {
      entry.failureCode = "stdout-stream-failed";
      requestStop(entry, "SIGTERM");
    });
    child.on("error", () => {
      entry.failureCode = "wrangler-spawn-failed";
    });
    child.on("close", (code, signal) => {
      entry.closed = true;
      entry.exitCode = Number.isInteger(code) ? code : null;
      entry.signal = SIGNALS.has(signal) ? signal : null;
      const session = report.sessions[name];
      session.status = entry.exitCode === null && entry.signal ? "closed-by-signal" : "closed";
      session.exitStatus = { code: entry.exitCode, signal: entry.signal };
      if (entry.failureCode) report.failureCode ??= entry.failureCode;
      const timer = forceKillTimers.get(entry);
      if (timer) clearTimeout(timer);
      forceKillTimers.delete(entry);
      resolveClosed(entry);
    });
    if (parentSignal) requestStop(entry, parentSignal);
    return entry;
  };

  const finish = async (status, failureCode = null) => {
    if (shuttingDown) return;
    shuttingDown = true;
    report.failureCode = failureCode;
    report.finishedAt = new Date().toISOString();
    if (report.sessions.pretty.status === "connected" || report.sessions.pretty.status === "running") {
      report.sessions.pretty.status = status;
    }
    if (report.sessions.json.status === "running" || report.sessions.json.status === "alive-after-grace") {
      report.sessions.json.status = status;
    }
    await saveReport();
  };

  const finishChildren = async () => {
    stopAll("SIGTERM");
    await Promise.all(children.map((entry) => entry.closedPromise));
    await saveChain;
  };

  if (parentSignal) {
    await finish("not-started", "stopped-before-start");
    process.stderr.write("TAIL_FAILED_CLOSED stopped-before-start\n");
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }

  let pretty;
  try {
    const matcher = createReadyLineMatcher(SESSION_READY_LINE, () => prettyReadyResolve("connected"));
    pretty = spawnTail("pretty", "pretty", (chunk) => matcher.feed(chunk));
  } catch {
    report.failureCode = "pretty-tail-spawn-failed";
    await finish("not-started", report.failureCode);
    process.stderr.write("TAIL_FAILED_CLOSED pretty-tail-spawn-failed\n");
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }
  report.sessions.pretty.status = "starting";
  report.sessions.pretty.startedAt = new Date().toISOString();
  await saveReport();

  let readyTimeout;
  const readyTimeoutPromise = new Promise((resolve) => {
    readyTimeout = setTimeout(() => resolve("timeout"), READY_TIMEOUT_MS);
    readyTimeout.unref();
  });
  const prettyOutcome = await Promise.race([
    prettyReadyPromise,
    pretty.closedPromise.then(() => "pretty-closed"),
    parentSignalPromise,
    readyTimeoutPromise,
  ]);
  clearTimeout(readyTimeout);

  if (prettyOutcome !== "connected" || parentSignal || pretty.closed && pretty.child.exitCode !== null && pretty.child.exitCode !== 0) {
    const failureCode = pretty.failureCode ?? (prettyOutcome === "timeout" ? "pretty-connected-ready-timeout" : "pretty-tail-failed");
    report.sessions.pretty.status = "unconfirmed";
    await finishChildren();
    await finish("unconfirmed", failureCode);
    process.stderr.write(`TAIL_FAILED_CLOSED ${failureCode}\n`);
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }

  report.sessions.pretty.status = "connected";
  report.sessions.pretty.connectedAt = new Date().toISOString();
  await saveReport();
  if (saveFailed || parentSignal || pretty.closed) {
    const failureCode = report.failureCode ?? "pretty-tail-failed-after-connect";
    await finishChildren();
    await finish("unconfirmed", failureCode);
    process.stderr.write(`TAIL_FAILED_CLOSED ${failureCode}\n`);
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }

  let jsonParser;
  let jsonEntry;
  try {
    jsonParser = createJsonObjectStreamParser((frame) => {
      let envelope;
      try {
        envelope = JSON.parse(frame);
      } catch {
        report.counts.invalidJsonFrames += 1;
        return;
      }
      report.counts.jsonEnvelopes += 1;
      const records = sanitizeEnvelope(envelope, agentId, report.counts);
      for (const record of records) {
        saveChain = saveChain.then(async () => {
          if (shuttingDown || saveFailed) return;
          if (report.events.length >= MAX_SAFE_RECORDS) {
            report.failureCode = "safe-record-limit";
            stopAll("SIGTERM");
            return;
          }
          report.events.push(record);
          report.counts.safeRecords = report.events.length;
          await atomicReplaceReport(report);
        }).catch(() => {
          saveFailed = true;
          report.failureCode = "report-write-failed";
          stopAll("SIGTERM");
        });
      }
    }, () => {
      report.counts.oversizedJsonFrames += 1;
    });

    jsonEntry = spawnTail("json", "json", (chunk) => jsonParser.feed(chunk));
  } catch {
    const failureCode = "json-tail-spawn-failed";
    report.failureCode = failureCode;
    await finishChildren();
    await finish("error", failureCode);
    process.stderr.write(`TAIL_FAILED_CLOSED ${failureCode}\n`);
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }
  report.sessions.json.status = "starting";
  report.sessions.json.startedAt = new Date().toISOString();
  await saveReport();

  const gracePromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("grace-passed"), JSON_GRACE_MS);
    timer.unref();
  });
  const graceOutcome = await Promise.race([
    gracePromise,
    jsonEntry.closedPromise.then(() => "json-closed"),
    pretty.closedPromise.then(() => "pretty-closed"),
    parentSignalPromise,
  ]);

  if (graceOutcome !== "grace-passed" || parentSignal || jsonEntry.closed || pretty.closed) {
    const failureCode = jsonEntry.failureCode ?? pretty.failureCode ?? "json-tail-failed-before-ready";
    jsonParser.finish();
    await finishChildren();
    await saveChain;
    await finish("unconfirmed", failureCode);
    process.stderr.write(`TAIL_FAILED_CLOSED ${failureCode}\n`);
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }

  report.sessions.json.status = "alive-after-grace";
  report.sessions.json.gracePassedAt = new Date().toISOString();
  await saveReport();
  if (saveFailed || parentSignal || jsonEntry.closed || pretty.closed) {
    const failureCode = report.failureCode ?? "tail-failed-before-ready";
    await finishChildren();
    await finish("unconfirmed", failureCode);
    process.stderr.write(`TAIL_FAILED_CLOSED ${failureCode}\n`);
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }

  report.sessions.json.status = "running";
  await saveReport();
  if (saveFailed || parentSignal || jsonEntry.closed || pretty.closed) {
    const failureCode = report.failureCode ?? "tail-failed-before-ready";
    await finishChildren();
    await finish("unconfirmed", failureCode);
    process.stderr.write(`TAIL_FAILED_CLOSED ${failureCode}\n`);
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    return 1;
  }

  ready = true;
  process.stdout.write("READY_FILTERED_TAIL\n");

  const stopped = await Promise.race([
    pretty.closedPromise.then(() => "pretty-closed"),
    jsonEntry.closedPromise.then(() => "json-closed"),
    parentSignalPromise,
  ]);
  jsonParser.finish();
  await saveChain;
  if (parentSignal || stopped === "signal") {
    await finishChildren();
    await finish("closed", null);
    process.stdout.write("TAIL_STOPPED graceful\n");
  } else {
    const failureCode =
      (stopped === "json-closed" ? jsonEntry.failureCode : pretty.failureCode) ??
      (stopped === "json-closed" ? "json-tail-exited" : "pretty-tail-exited");
    report.failureCode = failureCode;
    await finishChildren();
    await finish("error", failureCode);
    process.stderr.write(`TAIL_STOPPED ${failureCode}\n`);
  }

  process.off("SIGTERM", onSigterm);
  process.off("SIGINT", onSigint);
  return saveFailed || report.failureCode ? 1 : 0;
}

main().then((status) => {
  process.exitCode = status;
}).catch(() => {
  process.stderr.write("TAIL_FAILED_CLOSED collector-internal-error\n");
  process.exitCode = 1;
});
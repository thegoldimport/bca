const COMMIT_HASH = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const TERMINAL_GENERATION_STATUSES = new Set([
  "complete", "completed", "success", "failed", "error", "stopped",
]);

function reject(message) {
  throw new TypeError(message);
}

function identityKey(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return `n:${value}`;
  }
  if (typeof value !== "string" || !value || value.length > 120) return null;
  if (/^\d+$/.test(value)) {
    try { return `n:${BigInt(value).toString()}`; } catch { return null; }
  }
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? `s:${value}` : null;
}

/** Match the authenticated customer project, owner-bound D1 row and stock agent. */
export function validateOwnerProjectMapping({
  httpStatus, detail, projectId, ownerId, row, expectedAgentId,
}) {
  if (httpStatus !== 200 || !Number.isSafeInteger(projectId) || projectId <= 0
    || Number(detail?.id) !== projectId || !identityKey(ownerId)
    || identityKey(detail?.userId) !== identityKey(ownerId)) {
    reject("Owner project is missing or mismatched.");
  }
  if (!row || identityKey(row.user_id) !== identityKey(ownerId)) {
    reject("Owner-bound runtime link is missing or mismatched.");
  }
  if (row.status === "ready" && row.initialization_status === "ready") {
    if (typeof row.agent_id !== "string" || row.agent_id.length > 120
      || !/^[a-zA-Z0-9_-]+$/.test(row.agent_id)
      || detail.agentId !== row.agent_id
      || (expectedAgentId && row.agent_id !== expectedAgentId)) {
      reject("Ready project runtime agent mapping is missing or mismatched.");
    }
    return { ready: true, agentId: row.agent_id };
  }
  if (row.status !== "initializing"
    || !["pending", "initializing"].includes(row.initialization_status)
    || (detail.agentId != null && detail.agentId !== row.agent_id)
    || (expectedAgentId && row.agent_id && row.agent_id !== expectedAgentId)) {
    reject("Owner runtime link is conflicting or failed.");
  }
  return { ready: false, agentId: null };
}

/** An unused new project must not already have a public preview or release. */
export function validateFreshProjectPreflight(detail, releaseCount) {
  if (!detail || detail.previewUrl != null || detail.deploymentUrl != null
    || !Number.isSafeInteger(releaseCount) || releaseCount !== 0) {
    reject("New project already has a preview or published release.");
  }
  return true;
}

/**
 * Validate the read-only result shape returned by the Durable Objects query/v2
 * endpoint. A missing nested success flag is valid for this endpoint, but an
 * explicit failure, error, write, or incomplete result set is not.
 */
export function validateDurableSelectResult(result, expectedQueryCount) {
  if (!Number.isSafeInteger(expectedQueryCount) || expectedQueryCount <= 0) {
    reject("Expected Durable Object SELECT query count must be a positive integer.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    reject("Durable Object SELECT result is malformed.");
  }
  if (result.success !== undefined && result.success !== true) {
    reject("Durable Object SELECT reported an unsuccessful query.");
  }
  if (result.error !== undefined && result.error !== null) {
    reject("Durable Object SELECT reported an error.");
  }
  if (!Array.isArray(result.results) || result.results.length !== expectedQueryCount) {
    reject("Durable Object SELECT result count does not match the requested query count.");
  }

  for (const queryResult of result.results) {
    if (!queryResult || typeof queryResult !== "object" || Array.isArray(queryResult)) {
      reject("Durable Object SELECT contains a malformed query result.");
    }
    if (queryResult.success !== undefined && queryResult.success !== true) {
      reject("Durable Object SELECT query result reported an unsuccessful query.");
    }
    if (queryResult.error !== undefined && queryResult.error !== null) {
      reject("Durable Object SELECT query result reported an error.");
    }
    if (!queryResult.meta || typeof queryResult.meta !== "object"
      || Array.isArray(queryResult.meta)
      || !Number.isFinite(queryResult.meta.rows_written)
      || queryResult.meta.rows_written !== 0) {
      reject("Durable Object SELECT metadata is malformed or indicates a write.");
    }
    if (!Array.isArray(queryResult.columns) || !Array.isArray(queryResult.rows)
      || queryResult.rows.some(row => !Array.isArray(row)
        || row.length !== queryResult.columns.length)) {
      reject("Durable Object SELECT columns or rows are malformed.");
    }
  }
  return true;
}

/**
 * Summarize a native runtime status without relying on possibly stale
 * configured/provider/agentId fields. Owner identity is established solely by
 * the separately validated owner mapping supplied by the caller.
 */
export function summarizeNativeStatus(data, { ownerMappingVerified } = {}) {
  const connected = typeof data?.connected === "boolean" ? data.connected : null;
  const nativeThink = data?.nativeThink === true;
  const runtimeStatus = typeof data?.runtimeStatus === "string" ? data.runtimeStatus : null;
  const shouldBeGenerating = typeof data?.state?.shouldBeGenerating === "boolean"
    ? data.state.shouldBeGenerating : null;
  const rawGenerationStatus = data?.state?.generation?.status;
  const generationStatus = typeof rawGenerationStatus === "string"
    && /^(idle|running|complete|completed|success|failed|error|stopped)$/.test(rawGenerationStatus)
    ? rawGenerationStatus : null;
  const agentMatched = ownerMappingVerified === true;
  const idleNoGeneration = nativeThink
    && runtimeStatus === "ready"
    && connected === true
    && agentMatched
    && shouldBeGenerating === false
    && generationStatus === "idle";
  const active = shouldBeGenerating === true || generationStatus === "running";
  const terminalNoGeneration = idleNoGeneration;

  return {
    state: idleNoGeneration ? "idle"
      : active ? "generating"
        : generationStatus && TERMINAL_GENERATION_STATUSES.has(generationStatus)
          ? generationStatus : "unknown",
    connected,
    nativeThink,
    runtimeStatus,
    agentMatched,
    shouldBeGenerating,
    generationStatus,
    idleNoGeneration,
    terminalNoGeneration,
  };
}

/**
 * Parse the runtime's owner revision endpoint. Only the root branch/commitHash
 * pair is authoritative; nested legacy shapes are deliberately not accepted.
 */
export function parseOwnerRevision(response) {
  const httpStatus = Number.isInteger(response?.status) ? response.status : null;
  const data = response?.data;
  const dataObject = data && typeof data === "object" && !Array.isArray(data);
  const hasBranch = Boolean(dataObject
    && Object.prototype.hasOwnProperty.call(data, "branch"));
  const hasCommitHash = Boolean(dataObject
    && Object.prototype.hasOwnProperty.call(data, "commitHash"));
  const branch = hasBranch && (data.branch === null || typeof data.branch === "string")
    ? data.branch : null;
  const commitHash = hasCommitHash
    && (data.commitHash === null || typeof data.commitHash === "string")
    ? data.commitHash : null;
  const nullPair = hasBranch && hasCommitHash
    && data.branch === null && data.commitHash === null;
  const committedPair = hasBranch && hasCommitHash
    && typeof branch === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(branch)
    && !branch.includes("..") && !branch.includes("//")
    && !branch.endsWith("/") && !branch.endsWith(".lock")
    && typeof commitHash === "string" && COMMIT_HASH.test(commitHash);
  const schemaValid = (nullPair || committedPair)
    && !Object.prototype.hasOwnProperty.call(data, "revision");

  return {
    httpStatus,
    schemaValid,
    branch,
    commitHash: committedPair ? commitHash.toLowerCase() : commitHash,
    source: nullPair ? "NULL" : committedPair ? "branch+commitHash" : "INVALID",
    valid: httpStatus === 200 && schemaValid,
  };
}

/**
 * Treat the owner revision as the authoritative baseline, including the
 * legitimate null/null pre-first-use state.
 */
export function summarizeNativeRevision(ownerRevision) {
  const pairIsValid = ownerRevision?.valid === true
    && ownerRevision?.httpStatus === 200
    && ownerRevision?.schemaValid === true
    && ((ownerRevision.branch === null && ownerRevision.commitHash === null)
      || (typeof ownerRevision.branch === "string" && ownerRevision.branch.trim().length > 0
        && typeof ownerRevision.commitHash === "string"
        && COMMIT_HASH.test(ownerRevision.commitHash)));
  const baselineKnown = pairIsValid;
  const committedHeadVerified = baselineKnown
    && typeof ownerRevision.commitHash === "string";
  const headCommitHash = committedHeadVerified ? ownerRevision.commitHash.toLowerCase() : null;

  return {
    branch: baselineKnown ? ownerRevision.branch : null,
    headCommitHash,
    statusLastDeployedCommit: null,
    matchingCustomerTurnCommitHash: null,
    spaceGitHeadCommitHash: null,
    spaceGitReadState: "NOT_REQUIRED",
    committedHeadVerified,
    workingTreeDirty: null,
    baselineKnown,
  };
}

/**
 * Compare an independently parsed runtime revision to the native owner
 * snapshot. A known null/null baseline is a valid match before first use.
 */
export function runtimeRevisionMatchesSnapshot(runtimeRevision, revisionSnapshot) {
  if (runtimeRevision?.valid !== true
    || runtimeRevision?.httpStatus !== 200
    || runtimeRevision?.schemaValid !== true
    || revisionSnapshot?.baselineKnown !== true) {
    return false;
  }

  const revisionPairIsValid = (runtimeRevision.branch === null
    && runtimeRevision.commitHash === null)
    || (typeof runtimeRevision.branch === "string"
      && runtimeRevision.branch.trim().length > 0
      && typeof runtimeRevision.commitHash === "string"
      && COMMIT_HASH.test(runtimeRevision.commitHash));
  if (!revisionPairIsValid) return false;
  if (runtimeRevision.branch !== revisionSnapshot.branch) return false;

  const snapshotHead = revisionSnapshot.headCommitHash;
  if (runtimeRevision.commitHash === null) {
    return snapshotHead === null && revisionSnapshot.committedHeadVerified === false;
  }
  return typeof snapshotHead === "string"
    && COMMIT_HASH.test(snapshotHead)
    && revisionSnapshot.committedHeadVerified === true
    && runtimeRevision.commitHash.toLowerCase() === snapshotHead.toLowerCase();
}
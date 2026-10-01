import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOwnerRevision,
  runtimeRevisionMatchesSnapshot,
  summarizeNativeRevision,
  summarizeNativeStatus,
  validateDurableSelectResult,
  validateFreshProjectPreflight,
  validateOwnerProjectMapping,
} from "./lib/task13-owner-contracts.mjs";

const IDLE_STATUS = {
  nativeThink: true,
  runtimeStatus: "ready",
  connected: true,
  state: {
    shouldBeGenerating: false,
    generation: { status: "idle" },
  },
};
const COMMIT = "a".repeat(40);
const OWNED_PROJECT = { id: 7, userId: "test-owner", agentId: "test-agent" };
const OWNED_LINK = {
  user_id: "test-owner", agent_id: "test-agent",
  status: "ready", initialization_status: "ready",
};

test("owner project and runtime mapping fail closed on missing or conflicting state", () => {
  const args = {
    httpStatus: 200, detail: OWNED_PROJECT, projectId: 7,
    ownerId: "test-owner", row: OWNED_LINK, expectedAgentId: "test-agent",
  };
  assert.deepEqual(validateOwnerProjectMapping(args),
    { ready: true, agentId: "test-agent" });
  for (const mismatch of [
    { httpStatus: 404 },
    { detail: null },
    { detail: { ...OWNED_PROJECT, id: 8 } },
    { detail: { ...OWNED_PROJECT, userId: "other-owner" } },
    { detail: { ...OWNED_PROJECT, agentId: "other-agent" } },
    { row: null },
    { row: { ...OWNED_LINK, user_id: "other-owner" } },
    { row: { ...OWNED_LINK, agent_id: null } },
    { row: { ...OWNED_LINK, agent_id: "other-agent" } },
    { row: { ...OWNED_LINK, initialization_status: "error" } },
    { expectedAgentId: "other-agent" },
  ]) {
    assert.throws(() => validateOwnerProjectMapping({ ...args, ...mismatch }), TypeError);
  }
  assert.deepEqual(validateOwnerProjectMapping({
    ...args, expectedAgentId: undefined,
    detail: { ...OWNED_PROJECT, agentId: null },
    row: { ...OWNED_LINK, status: "initializing",
      initialization_status: "initializing", agent_id: null },
  }), { ready: false, agentId: null });
});

test("fresh-project preflight rejects an existing preview, deployment, or release", () => {
  assert.equal(validateFreshProjectPreflight({
    ...OWNED_PROJECT, previewUrl: null, deploymentUrl: null,
  }, 0), true);
  for (const [detail, releaseCount] of [
    [{ ...OWNED_PROJECT, previewUrl: "existing-preview" }, 0],
    [{ ...OWNED_PROJECT, deploymentUrl: "existing-release" }, 0],
    [OWNED_PROJECT, 1],
    [OWNED_PROJECT, undefined],
    [null, 0],
  ]) {
    assert.throws(() => validateFreshProjectPreflight(detail, releaseCount), TypeError);
  }
});

test("a fresh owner with no workspace or revision has a known null baseline", () => {
  const ownerRevision = parseOwnerRevision({
    status: 200,
    data: { branch: null, commitHash: null },
  });
  const revision = summarizeNativeRevision(ownerRevision);
  const status = summarizeNativeStatus(IDLE_STATUS, { ownerMappingVerified: true });

  assert.equal(ownerRevision.valid, true);
  assert.equal(revision.baselineKnown, true);
  assert.equal(revision.branch, null);
  assert.equal(revision.headCommitHash, null);
  assert.equal(revision.committedHeadVerified, false);
  assert.equal(revision.spaceGitReadState, "NOT_REQUIRED");
  assert.equal(status.idleNoGeneration, true);
  assert.equal(status.terminalNoGeneration, true);
  assert.equal(runtimeRevisionMatchesSnapshot(ownerRevision, revision), true);
});

test("an established owner revision is the verified authoritative head", () => {
  const ownerRevision = parseOwnerRevision({
    status: 200,
    data: { branch: "main", commitHash: COMMIT },
  });
  const revision = summarizeNativeRevision(ownerRevision);

  assert.equal(revision.baselineKnown, true);
  assert.equal(revision.headCommitHash, COMMIT);
  assert.equal(revision.branch, "main");
  assert.equal(revision.committedHeadVerified, true);
  assert.equal(revision.statusLastDeployedCommit, null);
  assert.equal(revision.matchingCustomerTurnCommitHash, null);
  assert.equal(revision.spaceGitHeadCommitHash, null);
  assert.equal(revision.workingTreeDirty, null);
  assert.equal(runtimeRevisionMatchesSnapshot(ownerRevision, revision), true);
  assert.equal(runtimeRevisionMatchesSnapshot({
    ...ownerRevision,
    commitHash: "b".repeat(40),
  }, revision), false);
  assert.equal(runtimeRevisionMatchesSnapshot({
    ...ownerRevision,
    branch: "other",
  }, revision), false);
});

test("native idle requires complete native readiness and separately verified ownership", () => {
  const status = summarizeNativeStatus({
    ...IDLE_STATUS,
    // These legacy values are not owner proof and may be stale.
    configured: true,
    provider: "vibesdk",
    agentId: "old-agent",
  }, { ownerMappingVerified: true });
  assert.equal(status.state, "idle");
  assert.equal(status.agentMatched, true);
  assert.equal(status.idleNoGeneration, true);

  const mismatch = summarizeNativeStatus(IDLE_STATUS, { ownerMappingVerified: false });
  assert.equal(mismatch.agentMatched, false);
  assert.equal(mismatch.idleNoGeneration, false);
  assert.equal(summarizeNativeStatus(IDLE_STATUS).idleNoGeneration, false);

  const missingProject = summarizeNativeStatus(IDLE_STATUS, { ownerMappingVerified: false });
  const missingMapping = summarizeNativeStatus(IDLE_STATUS, { ownerMappingVerified: undefined });
  assert.equal(missingProject.idleNoGeneration, false);
  assert.equal(missingMapping.idleNoGeneration, false);
  assert.equal(summarizeNativeStatus({
    configured: true,
    provider: "vibesdk",
    agentId: "old-agent",
    connected: true,
    state: IDLE_STATUS.state,
  }, { ownerMappingVerified: true }).idleNoGeneration, false);
});

test("active, malformed, disconnected, or non-native runtime status is not idle", () => {
  const active = summarizeNativeStatus({
    ...IDLE_STATUS,
    state: {
      shouldBeGenerating: true,
      generation: { status: "running" },
    },
  }, { ownerMappingVerified: true });
  assert.equal(active.state, "generating");
  assert.equal(active.idleNoGeneration, false);

  for (const data of [
    { ...IDLE_STATUS, connected: false },
    { ...IDLE_STATUS, nativeThink: false },
    { ...IDLE_STATUS, runtimeStatus: "starting" },
    { ...IDLE_STATUS, state: { shouldBeGenerating: false, generation: {} } },
  ]) {
    assert.equal(summarizeNativeStatus(data, { ownerMappingVerified: true }).idleNoGeneration, false);
  }
  assert.throws(() => summarizeNativeStatus({
    error: "runtime unavailable",
  }, { ownerMappingVerified: true }), TypeError);

  assert.equal(parseOwnerRevision({
    status: 503,
    data: { branch: "main", commitHash: COMMIT },
  }).valid, false);
});

test("owner revision requires a root-level, matching branch and commit hash pair", () => {
  const established = parseOwnerRevision({
    status: 200,
    data: { branch: "main", commitHash: COMMIT.toUpperCase() },
  });
  assert.equal(established.valid, true);
  assert.equal(established.commitHash, COMMIT);
  assert.equal(established.source, "branch+commitHash");

  const noRevision = parseOwnerRevision({
    status: 200,
    data: { branch: null, commitHash: null },
  });
  assert.equal(noRevision.valid, true);
  assert.equal(noRevision.source, "NULL");

  for (const response of [
    { status: 200, data: { branch: "main", commitHash: null } },
    { status: 200, data: { branch: null, commitHash: COMMIT } },
    { status: 200, data: { branch: "", commitHash: COMMIT } },
    { status: 200, data: { branch: 7, commitHash: null } },
    { status: 200, data: { revision: { branch: "main", commitHash: COMMIT } } },
    { status: 200, data: { branch: "main", commitHash: COMMIT,
      revision: { commitHash: "b".repeat(40) } } },
    { status: 200, data: { branch: "../private", commitHash: COMMIT } },
    { status: 200, data: { commitHash: null } },
    { status: 500, data: { branch: null, commitHash: null } },
    { status: 200, data: null },
  ]) {
    assert.equal(parseOwnerRevision(response).valid, false);
  }

  const malformed = parseOwnerRevision({
    status: 200,
    data: { branch: "main", commitHash: "not-a-commit" },
  });
  assert.equal(malformed.schemaValid, false);
  assert.equal(summarizeNativeRevision(malformed).baselineKnown, false);
});

test("Durable Object SELECT accepts absent nested success but rejects errors and writes", () => {
  assert.equal(validateDurableSelectResult({
    results: [
      { columns: [], rows: [], error: null, meta: { rows_written: 0 } },
      { columns: [], rows: [], success: true, error: null, meta: { rows_written: 0 } },
    ],
  }, 2), true);
  assert.equal(validateDurableSelectResult({
    success: true,
    results: [{ columns: [], rows: [], success: undefined, meta: { rows_written: 0 } }],
  }, 1), true);

  for (const result of [
    { results: [{ columns: [], rows: [], success: false, meta: { rows_written: 0 } }] },
    { results: [{ columns: [], rows: [], error: "SpaceDO read failed", meta: { rows_written: 0 } }] },
    { results: [{ columns: [], rows: [], meta: { rows_written: 1 } }] },
    { results: [{ columns: [], rows: [], meta: { rows_written: "0" } }] },
    { results: [{ columns: [], rows: [], meta: {} }] },
    { results: [{ columns: [], rows: [], meta: null }] },
    { results: [{ columns: [], rows: [], meta: { rows_written: 0 } }], error: "query failed" },
    { results: [{ columns: [], rows: [[1]], meta: { rows_written: 0 } }] },
    { results: [{ meta: { rows_written: 0 } }] },
    { results: "malformed" },
  ]) {
    assert.throws(() => validateDurableSelectResult(result, 1), TypeError);
  }
  assert.throws(() => validateDurableSelectResult({
    results: [{ columns: [], rows: [], meta: { rows_written: 0 } }],
  }, 2), /count/);
  assert.throws(() => validateDurableSelectResult({
    results: [{ columns: [], rows: [], meta: { rows_written: 0 } }],
  }, 0), /positive integer/);
});

test("status rejects explicit error alongside valid-looking idle fields", () => {
  assert.throws(() => summarizeNativeStatus({
    ...IDLE_STATUS, error: { code: "RUNTIME_ERROR" },
  }, { ownerMappingVerified: true }), TypeError);
});

test("status rejects success:false alongside valid-looking idle fields", () => {
  assert.throws(() => summarizeNativeStatus({
    ...IDLE_STATUS, success: false,
  }, { ownerMappingVerified: true }), TypeError);
});

test("revision rejects explicit error alongside a valid-looking revision", () => {
  assert.equal(parseOwnerRevision({
    status: 200, data: { branch: "main", commitHash: COMMIT, error: "RUNTIME_ERROR" },
  }).valid, false);
});

test("revision rejects success:false alongside a valid-looking revision", () => {
  assert.equal(parseOwnerRevision({
    status: 200, data: { branch: null, commitHash: null, success: false },
  }).valid, false);
});

test("fresh fixture rejects a preserved native preview URL", () => {
  const status = summarizeNativeStatus({
    ...IDLE_STATUS, previewUrl: "https://fixture.invalid/preview?t=private-capability",
  }, { ownerMappingVerified: true });
  assert.equal(status.previewUrl, "https://fixture.invalid/preview");
  assert.throws(() => validateFreshProjectPreflight({
    ...OWNED_PROJECT, previewUrl: null, deploymentUrl: null,
  }, 0, status), TypeError);
});

test("fresh fixture rejects a preserved native deployment URL", () => {
  const status = summarizeNativeStatus({
    ...IDLE_STATUS, deploymentUrl: "https://fixture.invalid/deployment",
  }, { ownerMappingVerified: true });
  assert.equal(status.deploymentUrl, "https://fixture.invalid/deployment");
  assert.throws(() => validateFreshProjectPreflight({
    ...OWNED_PROJECT, previewUrl: null, deploymentUrl: null,
  }, 0, status), TypeError);
});

test("explicit failed product-detail readiness is rejected", () => {
  for (const field of ["status", "runtimeStatus"]) {
    assert.throws(() => validateOwnerProjectMapping({
      httpStatus: 200, detail: { ...OWNED_PROJECT, [field]: "failed" },
      projectId: 7, ownerId: "test-owner", row: OWNED_LINK, expectedAgentId: "test-agent",
    }), TypeError);
  }
});

test("normal legitimate fresh fixture still passes all three corrected gates", () => {
  assert.equal(validateOwnerProjectMapping({
    httpStatus: 200,
    detail: { ...OWNED_PROJECT, status: "ready", runtimeStatus: "ready" },
    projectId: 7, ownerId: "test-owner", row: OWNED_LINK, expectedAgentId: "test-agent",
  }).ready, true);
  const status = summarizeNativeStatus({
    ...IDLE_STATUS, previewUrl: null, deploymentUrl: null,
  }, { ownerMappingVerified: true });
  assert.equal(status.idleNoGeneration, true);
  assert.equal(validateFreshProjectPreflight({
    ...OWNED_PROJECT, previewUrl: null, deploymentUrl: null,
  }, 0, status), true);
  assert.equal(parseOwnerRevision({
    status: 200, data: { branch: null, commitHash: null },
  }).valid, true);
});
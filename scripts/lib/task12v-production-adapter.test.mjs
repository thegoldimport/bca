import assert from "node:assert/strict";
import test from "node:test";
import {
  createTask12VProductionAdapter,
  registrationCsrfEvidence,
  sendTask12VMatrixRequest,
} from "./task12v-production-adapter.mjs";

test("matrix request varies Origin and CSRF header while retaining the CSRF cookie", async () => {
  const observed = [];
  for (const originState of ["valid", "invalid", "missing"]) {
    for (const csrfState of ["valid", "missing", "invalid"]) {
      await sendTask12VMatrixRequest({
        fetchImpl: async (url, init) => {
          observed.push({ url, init });
          return { status: 400, text: async () => '{"message":"ORIGIN_REJECTED"}' };
        },
        originState,
        csrfState,
        csrf: registrationCsrfEvidence({
          state: csrfState, token: "valid-csrf-fixture", cookie: "browser-csrf-fixture",
        }),
        payload: { email: "not-an-email" },
      });
    }
  }

  assert.equal(observed.length, 9);
  for (const { url, init } of observed) {
    assert.equal(url, "https://app.buildcustom.ai/api/auth/register");
    assert.equal(init.headers.Cookie, "csrf-token=browser-csrf-fixture");
  }
  for (let index = 0; index < observed.length; index += 1) {
    const originState = ["valid", "invalid", "missing"][Math.floor(index / 3)];
    const csrfState = ["valid", "missing", "invalid"][index % 3];
    const headers = observed[index].init.headers;
    assert.equal(headers.Origin,
      originState === "valid" ? "https://app.buildcustom.ai"
        : originState === "invalid" ? "https://not-buildcustom.example" : undefined);
    assert.equal(headers["X-CSRF-Token"],
      csrfState === "valid" ? "valid-csrf-fixture"
        : csrfState === "invalid" ? "invalid-task12v-csrf" : undefined);
  }
});

test("inert adapter diagnostic emitter preserves required context and sanitized errors", async () => {
  const io = createTask12VProductionAdapter();
  const originalWrite = process.stderr.write;
  let written = "";
  process.stderr.write = chunk => {
    written += String(chunk);
    return true;
  };
  try {
    await io.emitDiagnostic({
      type: "artifact-write-failure",
      phase: "acceptance",
      caseName: "single-public-ui-signup",
      operation: "checkpoint",
      status: "FAIL",
      originalResult: {
        name: "SignupFailure",
        message: "Signup failed for user@example.net",
        stack: "private stack",
        cause: null,
      },
      artifactWriteError: Object.assign(new Error("disk write failed"), { name: "EIO" }),
    });
  } finally {
    process.stderr.write = originalWrite;
  }

  const record = JSON.parse(written);
  assert.equal(record.type, "artifact-write-failure");
  assert.equal(record.phase, "acceptance");
  assert.equal(record.caseName, "single-public-ui-signup");
  assert.equal(record.operation, "checkpoint");
  assert.equal(record.status, "FAIL");
  assert.equal(record.originalResult.name, "SignupFailure");
  assert.match(record.originalResult.message, /\[EMAIL\]/);
  assert.equal(record.artifactWriteError.name, "EIO");
  assert.match(record.artifactWriteError.message, /disk write failed/);
});
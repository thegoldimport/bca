import assert from "node:assert/strict";
import { test } from "node:test";
import { createTailCorrelation, evaluateCapability } from "./lib/task12n-tail-correlation.mjs";

const worker = "buildcustom-vibesdk-launch";
const version = "accepted";
const prefix = "1790624205210-1-";
const base = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev/api/auth/providers?task12n_observation=";
function fixture() {
  return createTailCorrelation({ worker, markerPrefix: prefix });
}
function event(marker, opts = {}) {
  return { scriptName: opts.scriptName ?? worker,
    scriptVersion: opts.missingVersion ? {} : { id: opts.version ?? version },
    eventTimestamp: Date.now(),
    event: { request: { url: opts.url ?? base + marker } } };
}
function row(result, tail) {
  return { response: { status: 200, redactedRawBody: '{"registrationEnabled":false}',
    parsed: { registrationEnabled: false, email: true } },
  tail: tail ? { scriptName: tail.scriptName, versionId: tail.scriptVersion?.id ?? null } : null,
  correlation: result };
}

test("targeted and ordinary events correlate independently, even out of order", async () => {
  const c = fixture(), t = prefix + "targeted", o = prefix + "ordinary";
  const targeted = c.watch(base + t, 100), ordinary = c.watch(base + o, 100);
  c.ingest(event(o)); c.ingest(event(t));
  assert.equal((await targeted).event.request.url, base + t);
  assert.equal((await ordinary).event.request.url, base + o);
  assert.equal(c.snapshot(t).ownMarkerEvents.length, 1);
  assert.equal(c.snapshot(o).ownMarkerEvents.length, 1);
});
test("unrelated, redacted, and mismatched URLs cannot correlate", async () => {
  const c = fixture(), marker = prefix + "ordinary";
  const observed = c.watch(base + marker, 5);
  c.ingest(event("unrelated"));
  c.ingest(event(marker, { url: base + "[redacted]" }));
  c.ingest(event(marker, { url: base + marker + "-changed" }));
  assert.equal(await observed, null);
  assert.equal(c.snapshot(marker).metrics.matchedEvents, 0);
});
test("an event after HTTP response remains observable while collection is open", async () => {
  const c = fixture(), marker = prefix + "ordinary";
  const observed = c.watch(base + marker, 100);
  const httpCompleted = row(null, null);
  assert.equal(httpCompleted.response.status, 200);
  await new Promise(resolve => setTimeout(resolve, 5));
  c.ingest(event(marker));
  assert.equal(evaluateCapability(row(null, await observed), worker, version, false).version, "PASS");
});
test("missing event or missing version is UNKNOWN, never PASS; HTTP body remains", async () => {
  const c = fixture(), marker = prefix + "targeted";
  const missing = await c.watch(base + marker, 5);
  assert.equal(evaluateCapability(row(c.snapshot(marker), missing), worker, version, false).version, "UNKNOWN");
  assert.equal(row(null, missing).response.redactedRawBody, '{"registrationEnabled":false}');
  const observed = c.watch(base + marker, 50);
  c.ingest(event(marker, { missingVersion: true }));
  assert.equal(evaluateCapability(row(null, await observed), worker, version, false).version, "UNKNOWN");
});
test("wrong script or version fails, regardless of HTTP success", async () => {
  const c = fixture(), marker = prefix + "targeted";
  const first = c.watch(base + marker, 50);
  c.ingest(event(marker, { scriptName: "other-worker" }));
  assert.equal(evaluateCapability(row(null, await first), worker, version, false).version, "FAIL");
  const second = c.watch(base + marker, 50);
  c.ingest(event(marker, { version: "wrong-version" }));
  assert.equal(evaluateCapability(row(null, await second), worker, version, false).version, "FAIL");
});
test("HTTP behavior is evaluated separately from version evidence", () => {
  const accepted = row(null, event(prefix + "ordinary"));
  accepted.response.parsed.registrationEnabled = true;
  assert.deepEqual(evaluateCapability(accepted, worker, version, false),
    { http: "FAIL", version: "PASS" });
});
import test from "node:test";
import assert from "node:assert/strict";
import { ProjectOperationDO } from "../cloudflare/staging/project-do";

function state() {
  const values = new Map<string, unknown>();
  let alarmAt = 0;
  return {
    storage: {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => void values.set(key, value),
      delete: async (key: string) => void values.delete(key),
      setAlarm: async (at: number) => void (alarmAt = at),
    },
    get alarmAt() { return alarmAt; },
  } as any;
}

test("project DO serializes leases and recovers stale locks", async () => {
  const durableState = state();
  const operation = new ProjectOperationDO(durableState);
  const acquire = (id: string) => operation.fetch(new Request("https://do/acquire", { method: "POST", body: JSON.stringify({ operationId: id }) }));
  assert.equal((await acquire("one")).status, 200);
  assert.equal((await acquire("two")).status, 409);
  assert.ok(durableState.alarmAt > Date.now());
  assert.equal((await operation.fetch(new Request("https://do/release", { method: "POST", body: JSON.stringify({ operationId: "one" }) }))).status, 200);
  assert.equal((await acquire("two")).status, 200);
  await durableState.storage.put("lease", { operationId: "stale", expiresAt: Date.now() - 1 });
  await operation.alarm();
  assert.equal((await operation.fetch(new Request("https://do/lease"))).status, 200);
  assert.equal(await (await operation.fetch(new Request("https://do/lease"))).text(), "null");
});
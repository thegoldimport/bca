import assert from "node:assert/strict";
import test from "node:test";
import { readSavedAgentTurns } from "../client/src/hooks/use-saved-native-conversation";

const turn = {
  id: 1, mode: "build", prompt: "Offline owner request",
  response: "**Exact saved response.**\nWhich columns?\nReply in chat.",
  changedFiles: [], activity: [], commitHash: null, createdAt: "2026-11-10T17:00:00Z",
};

test("saved conversation accepts both authorized API snapshot envelopes without rewriting native text", () => {
  assert.deepEqual(readSavedAgentTurns({ turns: [turn] }), [turn]);
  assert.equal(readSavedAgentTurns([turn])[0].response, turn.response);
});

test("replayed saved IDs render once, retaining the latest record for that ID", () => {
  const final = { ...turn, response: `${turn.response}\nFinal persisted question?` };
  assert.deepEqual(readSavedAgentTurns({ turns: [turn, final] }), [final]);
});

test("separate turns with identical text retain their separate stable identities", () => {
  assert.deepEqual(readSavedAgentTurns([turn, { ...turn, id: 2 }]), [turn, { ...turn, id: 2 }]);
});

test("invalid saved history fails explicitly rather than clearing a previously loaded conversation", () => {
  for (const invalid of [{}, { turns: {} }, { turns: null }, [{ ...turn, response: null }],
    [{ ...turn, id: "secret-looking-invalid-id" }], [{ ...turn, mode: "unknown" }]]) {
    assert.throws(() => readSavedAgentTurns(invalid));
  }
  assert.deepEqual(readSavedAgentTurns({ turns: [] }), []);
});

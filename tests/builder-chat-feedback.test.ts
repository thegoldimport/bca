import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCompletionSynopsis } from "../server/runtime-adapter";

test("build completion synopsis preserves a meaningful agent response", () => {
  assert.equal(
    buildCompletionSynopsis("Added drag-and-drop image attachments and verified the composer.", ["client/src/pages/app-dashboard.tsx"]),
    "Added drag-and-drop image attachments and verified the composer.",
  );
});

test("build completion synopsis replaces the generic fallback with changed areas", () => {
  assert.equal(
    buildCompletionSynopsis("Agent completed the request.", [
      { path: "client/src/pages/app-dashboard.tsx" },
      { path: "server/runtime-adapter.ts" },
      { path: "tests/builder-chat-feedback.test.ts" },
      { path: "server/routes.ts" },
    ]),
    "Completed your request. Updated client/src/pages/app-dashboard.tsx, server/runtime-adapter.ts, tests/builder-chat-feedback.test.ts and 1 more file.",
  );
});

test("Builder composer exposes a shared picker and drop attachment path", () => {
  const source = readFileSync(new URL("../client/src/pages/app-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /const addAttachmentFiles = async \(selected: File\[\]\)/);
  assert.match(source, /onDrop=\{handleAttachmentDrop\}/);
  assert.match(source, /data-testid="editor-chat-dropzone"/);
  assert.match(source, /data-testid="editor-chat-drop-overlay"/);
  assert.match(source, /await addAttachmentFiles\(selected\)/);
  assert.match(source, /await addAttachmentFiles\(dropped\)/);
  assert.match(source, /retainedImages\.length \+ imageFiles\.length > 4/);
});
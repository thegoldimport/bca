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

test("Builder composer renders removable thumbnails with an expanded preview", () => {
  const source = readFileSync(new URL("../client/src/pages/app-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="composer-attachment-previews"/);
  assert.match(source, /data-testid=\{`preview-attachment-\$\{file\.id\}`\}/);
  assert.match(source, /setPreviewAttachmentId\(file\.id\)/);
  assert.match(source, /data-testid="image-attachment-preview"/);
  assert.match(source, /aria-label=\{`Remove \$\{file\.filename\}`\}/);
  assert.match(source, /aria-label=\{`Remove \$\{previewAttachment\.filename\} from attachments`\}/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /setPreviewAttachmentId\(\(current\) => current === id \? null : current\)/);
});

test("Builder chat follows assistant responses and live activity", () => {
  const source = readFileSync(new URL("../client/src/pages/app-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /const chatScrollRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(source, /data-testid="builder-chat-scroll"/);
  assert.match(source, /chat\.scrollTo\(\{ top: chat\.scrollHeight, behavior \}\)/);
  assert.match(source, /\[turns\.length, messages\.length, messages\.at\(-1\)\?\.content, runtimeError, sending, chatCollapsed\]/);
  assert.match(source, /new MutationObserver\(\(\) => scrollChatToBottom\("smooth"\)\)/);
  assert.match(source, /observer\.observe\(chat, \{ childList: true, subtree: true, characterData: true \}\)/);
});

test("Builder progress omits the workspace inventory and puts checkpoints before build replies", () => {
  const source = readFileSync(new URL("../client/src/pages/app-dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /queryKey: \["runtime-files", projectId\]/);
  assert.doesNotMatch(source, /data-testid=\{`button-file-\$\{file\.path\}`\}/);
  assert.match(source, /Loading current code…/);
  const checkpoint = source.indexOf("builder-turn-checkpoint-");
  const buildResponse = source.indexOf("builder-turn-build-response-");
  assert.ok(checkpoint >= 0);
  assert.ok(buildResponse > checkpoint);
  assert.match(source, /builder-turn-plan-response-/);
});
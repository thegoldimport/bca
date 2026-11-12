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

test("Builder chat follows new activity only while the reader is at the latest message", () => {
  const source = readFileSync(new URL("../client/src/pages/app-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /const chatScrollRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(source, /data-testid="builder-chat-scroll"/);
  assert.match(source, /chat\.scrollTo\(\{ top: chat\.scrollHeight, behavior \}\)/);
  assert.match(source, /\[turns\.length, messages\.length, messages\.at\(-1\)\?\.content, nativeProgress\.length, runtimeError, sending, chatCollapsed\]/);
  assert.match(source, /if \(!force && !chatFollowLatestRef\.current\)/);
  assert.match(source, /onScroll=\{handleChatScroll\}/);
  assert.match(source, /chat\.scrollHeight - chat\.clientHeight - chat\.scrollTop <= 24/);
  assert.match(source, /onPointerDownCapture=\{pauseChatFollow\}/);
  assert.match(source, /if \(event\.deltaY < 0\) pauseChatFollow\(\)/);
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /observer\.observe\(content\)/);
  assert.doesNotMatch(source, /new MutationObserver/);
  assert.match(source, /data-testid="button-jump-to-latest-chat"/);
});

test("Native build chat keeps drafts editable and locks the editor viewport", () => {
  const source = readFileSync(new URL("../client/src/pages/app-dashboard.tsx", import.meta.url), "utf8");
  assert.match(source, /data-testid="native-composer-draft-hint"/);
  const inputMarker = source.indexOf('data-testid="input-editor-chat"');
  const composerStart = source.lastIndexOf("<textarea", inputMarker);
  const composerEnd = source.indexOf("/>", inputMarker);
  assert.ok(inputMarker >= 0 && composerStart >= 0 && composerEnd > inputMarker,
    "the chat composer remains available while status loads");
  const composer = source.slice(composerStart, composerEnd + 2);
  assert.doesNotMatch(composer, /\bdisabled\b/, "runtime or planning status must not prevent drafting");
  assert.match(source, /disabled=\{!currentRuntimeCapability \|\| !planningLoaded \|\| planningSaving/);
  assert.match(source, /const isEditorRoute = location === "\/app\/editor" \|\| location\.startsWith\("\/app\/editor\/"\)/);
  assert.match(source, /isEditorRoute \? "overflow-hidden" : "overflow-y-auto"/);
  assert.match(source, /className="flex h-full min-h-0 overflow-hidden"/);
  assert.match(source, /isEditorRoute \? "fixed inset-0" : ""/);
});

test("Builder progress omits the workspace inventory and puts checkpoints before build replies", () => {
  const source = readFileSync(new URL("../client/src/pages/app-dashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /data-testid=\{`button-file-\$\{file\.path\}`\}/);
  assert.match(source, /Loading current code…/);
  const checkpoint = source.indexOf("builder-turn-checkpoint-");
  const buildResponse = source.indexOf("builder-turn-build-response-");
  assert.ok(checkpoint >= 0);
  assert.ok(buildResponse > checkpoint);
  assert.match(source, /builder-turn-plan-response-/);
});
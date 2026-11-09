import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  MAX_NATIVE_ACTIVITY_EVENTS,
  readNativeActivitySnapshot,
  writeNativeActivitySnapshot,
} from "../client/src/lib/native-activity";
import { projectCollectionFromResponse } from "../client/src/lib/project-collections";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function installSessionStorage(t: any) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  return values;
}

test("project activity snapshots are project-scoped and omit malformed events", (t) => {
  const storage = installSessionStorage(t);
  writeNativeActivitySnapshot(10, {
    startedAt: 1_800_000_000_000,
    events: [
      { id: "valid", label: "Agent started the build", observedAt: 1_800_000_000_001, status: "active" },
      { id: "bad-status", label: "Invalid", observedAt: 1_800_000_000_002, status: "secret" as any },
      { id: "bad-time", label: "Invalid", observedAt: Number.MAX_VALUE, status: "error" },
      { id: "bad-path", label: "Invalid", observedAt: 1_800_000_000_003, status: "info", path: "x".repeat(501) },
    ],
  });

  assert.deepEqual(readNativeActivitySnapshot(10), {
    startedAt: 1_800_000_000_000,
    events: [
      { id: "valid", label: "Agent started the build", observedAt: 1_800_000_000_001, status: "active" },
    ],
  });
  assert.deepEqual(readNativeActivitySnapshot(11), { events: [], startedAt: null });
  assert.ok(storage.has("buildcustom:native-activity:10"));
});

test("project activity preserves the newest bounded event history", (t) => {
  installSessionStorage(t);
  const events = Array.from({ length: MAX_NATIVE_ACTIVITY_EVENTS + 5 }, (_, index) => ({
    id: `event-${index}`,
    label: `Event ${index}`,
    observedAt: 1_800_000_000_000 + index,
    status: "info" as const,
  }));

  writeNativeActivitySnapshot(22, { events, startedAt: events[0].observedAt });
  const snapshot = readNativeActivitySnapshot(22);
  assert.equal(snapshot.events.length, MAX_NATIVE_ACTIVITY_EVENTS);
  assert.equal(snapshot.events[0].id, "event-5");
  assert.equal(snapshot.events.at(-1)?.id, `event-${MAX_NATIVE_ACTIVITY_EVENTS + 4}`);
});

test("project collections accept arrays and named envelopes but reject error objects", () => {
  const rows = [{ id: 1 }];
  assert.deepEqual(projectCollectionFromResponse(rows, ["pages"]), rows);
  assert.deepEqual(projectCollectionFromResponse({ posts: rows }, ["posts", "items"]), rows);
  assert.throws(() => projectCollectionFromResponse({ message: "Unauthorized" }, ["pages"]), /unexpected list response/);
});

test("builder activity opens the full project activity tab in a separate window", async () => {
  const [builder, projectDetail, builderExperience] = await Promise.all([
    readFile(path.join(root, "client/src/pages/app-dashboard.tsx"), "utf8"),
    readFile(path.join(root, "client/src/pages/project-detail.tsx"), "utf8"),
    readFile(path.join(root, "client/src/components/customer-experience/BuilderExperience.tsx"), "utf8"),
  ]);

  assert.match(builder, /window\.open\(activityHref, "_blank"\)/);
  assert.match(builder, /activityWindow\.opener = null/);
  assert.match(builder, /else \{\s*navigate\(activityHref\)/);
  assert.doesNotMatch(builder, /getElementById\("build-activity-timeline-toggle"\)/);
  assert.match(projectDetail, /\{ id: "activity", label: "Activity", icon: Activity \}/);
  assert.match(projectDetail, /new URLSearchParams\(window\.location\.search\)\.get\("tab"\) === "activity"/);
  assert.match(projectDetail, /data-testid="project-activity-page"/);
  assert.match(projectDetail, /\/api\/projects\/\$\{projectId\}\/build-activity/);
  assert.match(projectDetail, /Persistent build attempts/);
  assert.match(projectDetail, /prompts, source files, and credentials are not included/i);
  assert.match(projectDetail, /lastSuccessfulStage/);
  assert.match(builder, /activityParams\.set\("attempt"/);
  assert.match(projectDetail, /Pages could not be loaded:[\s\S]*Try again/);
  assert.match(projectDetail, /Blog posts could not be loaded:[\s\S]*Try again/);
  assert.match(projectDetail, /class ProjectTabErrorBoundary/);
  assert.match(projectDetail, /data-testid="project-tab-error"/);
  assert.match(projectDetail, /Unable to load Auto-Blogger settings\./);
  assert.match(projectDetail, /Unable to load SEO settings\./);
  assert.match(projectDetail, /value=\{project\.status \|\| "draft"\}/);
  assert.doesNotMatch(projectDetail, /form\.name !== project\.name \|\| form\.description !== project\.description \? form\.framework/);
  assert.match(builder, /safeBuildErrorMessage\(errorCode\)/);
  assert.match(builder, /attemptId/);
  assert.match(builderExperience, /data-testid="builder-build-failure-details"/);
  assert.match(builderExperience, /Detailed runtime diagnostics were not saved/);
  assert.match(builderExperience, /data-testid="button-continue-after-build-failure"/);
  assert.match(builderExperience, /Continue in chat/);
});

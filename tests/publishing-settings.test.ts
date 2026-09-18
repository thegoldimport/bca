import assert from "node:assert/strict";
import test from "node:test";
import type { SeoSettings } from "../shared/schema";
import { savePublishingSettings } from "../server/publishing-settings";

const settings = {
  projectId: 7,
  metaTitle: "Ready before generation",
  metaDescription: "",
  focusKeyword: "",
  schemaJson: "{}",
  faviconData: "",
  canonicalUrl: "",
  ogTitle: "",
  ogDescription: "",
  ogImageUrl: "",
  allowIndexing: true,
} as SeoSettings;

test("new projects save publishing settings before Agent generation", async () => {
  let saved: Partial<SeoSettings> | undefined;
  const result = await savePublishingSettings(7, { metaTitle: settings.metaTitle }, {
    upsertSettings: async (_projectId, update) => {
      saved = update;
      return settings;
    },
    getRuntimeLink: async () => undefined,
    setPublishedRoute: async () => { throw new Error("must not publish without a runtime link"); },
  });

  assert.deepEqual(saved, { metaTitle: "Ready before generation" });
  assert.equal(result, settings);
});
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("native editor publish flow sends an authenticated project-scoped deployment without agent identifiers", async () => {
  const source = await readSource("client/src/pages/app-dashboard.tsx");
  const start = source.indexOf("const publishNativeProject = async () =>");
  const end = source.indexOf("const restoreReleaseToDevelopment", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const publishFlow = source.slice(start, end);

  assert.match(publishFlow, /if \(!canPublishNative \|\| !projectId \|\| publishing \|\| nativePublishingRef\.current\) return/);
  assert.match(publishFlow, /authHeaders\(\)/);
  assert.match(publishFlow, /const token = await csrfToken\(\)/);
  assert.match(publishFlow, /"X-CSRF-Token": token/);
  assert.match(publishFlow, /runtime\/publishing-capabilities/);
  assert.match(publishFlow, /capability\.buildId !== "immutable-v2"/);
  assert.match(publishFlow, /capability\.publishProtocol !== "immutable-v2"/);
  assert.match(publishFlow, /"X-Publish-Protocol": capability\.publishProtocol/);
  assert.match(publishFlow, /method: "PUT"[\s\S]*subdomainSlug: safeSlug[\s\S]*hostingProvider: "buildcustom"[\s\S]*customDomain: ""/);
  assert.match(publishFlow, /fetch\(`\/api\/projects\/\$\{projectId\}\/runtime\/publish-immutable-v2`, \{[\s\S]*method: "POST"[\s\S]*body: JSON\.stringify\(\{\}\)/);
  assert.match(publishFlow, /typeof data\.publicAvailable === "boolean"/);
  assert.match(publishFlow, /setNativeDeploymentComplete\(true\)/);
  assert.match(publishFlow, /Published internally; public apps are not enabled yet/);
  assert.doesNotMatch(publishFlow, /agentId|agent_id|scriptName|VibeSDK|Cloudflare/);
  assert.match(source, /disabled=\{publishing\}[\s\S]*data-testid="button-publish-native"/);
  assert.match(source, /data-testid="native-publish-status"/);
  assert.match(source, /data-testid="link-native-public-url"/);
  assert.match(source, /setPublishFlow\(\{ status: "failed", message: error\.message/);
});

test("native published address survives editor refresh and project details avoid domain controls", async () => {
  const editor = await readSource("client/src/pages/app-dashboard.tsx");
  const detail = await readSource("client/src/pages/project-detail.tsx");

  assert.match(editor, /if \(isNativeThink\) \{[\s\S]*setProductionUrl\(""\)/);
  assert.match(editor, /if \(status\.deploymentUrl \|\| status\.publicAvailable === true/);
  assert.match(editor, /const \{ deploymentUrl: _privateDeploymentUrl, \.\.\.safeRelease \} = release/);
  assert.match(editor, /if \(activeProjectIdRef\.current === projectId && releaseRows\.length > 0\) \{[\s\S]*setNativeDeploymentComplete\(true\)/);
  assert.match(editor, /publicGeneratedAppUrl\([\s\S]*publicGeneratedAppsEnabled && nativePublicAvailable !== false/);
  assert.match(editor, /publishDrawerOpen && \(canManageProduction \|\| canPublishNative\)/);
  assert.match(editor, /\{nativeThink \? \([\s\S]*data-testid="native-publish-panel"[\s\S]*\) : \(/);

  assert.match(detail, /data-testid="native-public-address"/);
  assert.match(detail, /data-testid="button-native-publish-link"/);
  assert.match(detail, /activeTab === "domain" && \(nativeThink \? \([\s\S]*data-testid="native-domain-public-url"[\s\S]*: <DomainTab/);
  assert.match(detail, /publicGeneratedAppUrl\(publishingQuery\.data\?\.subdomainSlug, publicGeneratedAppsEnabled\)/);
});
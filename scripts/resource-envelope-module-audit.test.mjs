import assert from "node:assert/strict";
import test from "node:test";
import { auditModuleSets } from "./resource-envelope-module-audit.mjs";

const js = (name, source) => ({ name, bytes: Buffer.from(source) });
const wasm = (name, value) => ({ name, bytes: Buffer.from(value) });

const oldModules = () => [
  js("index.js", `// old build path
    const run = () => {};
    export { run as execute };
    export const state = 1;
    import("./assets/hook-proxy-Aaaaaaaa.js");`),
  js("assets/hook-proxy-Aaaaaaaa.js", `// old source root: /tmp/old/
    import { marker } from "./version-Bbbbbbbb.js";
    export const run = () => marker("keep this literal");`),
  js("assets/mimetext.browser.es-oCtx9-6c.js", `// old build comment
    export const mime = "stable";`),
  js("assets/version-Bbbbbbbb.js", `export const marker = value => value;`),
  js("assets/rolldown-runtime-Cccccccc.js", `/* bundler runtime */\nexport const runtime = 1;`),
  wasm("assets/esbuild-Dddddddd.wasm", [0, 1, 2, 3]),
];

const candidateModules = () => [
  js("index.js", `// new build path
    const run = () => {};
    export { run as execute };
    export const state = 1;
    import("./assets/hook-proxy-Eeeeeeee.js");`),
  js("assets/hook-proxy-Eeeeeeee.js", `// candidate source root: /tmp/new/
    import { marker } from "./version-Ffffffff.js";
    export const run = () => marker("keep this literal");`),
  js("assets/mimetext.browser.es-zCtx9-6c.js", `// candidate build comment
    export const mime = "stable";`),
  js("assets/version-Ffffffff.js", `export const marker = value => value;`),
  js("assets/rolldown-runtime-Gggggggg.js", `/* bundler runtime */\nexport const runtime = 1;`),
  wasm("assets/esbuild-Hhhhhhhh.wasm", [0, 1, 2, 3]),
];

test("accepts hashed sibling chunks with comment and import-reference churn only", () => {
  const report = auditModuleSets(oldModules(), candidateModules(), "index.js");
  assert.equal(report.status, "PASS");
  assert.equal(report.modules.filter(item => item.result === "EXECUTABLE_AST_EQUAL").length, 2);
  assert.deepEqual(report.mainExports, [
    { local: "run", exported: "execute" },
    { local: "state", exported: "state" },
  ]);
});

test("rejects executable literal and identifier changes", () => {
  const changedLiteral = candidateModules();
  changedLiteral[1] = js(changedLiteral[1].name,
    changedLiteral[1].bytes.toString().replace("keep this literal", "changed literal"));
  assert.throws(() => auditModuleSets(oldModules(), changedLiteral, "index.js"), /Executable AST changed/);

  const changedIdentifier = candidateModules();
  changedIdentifier[1] = js(changedIdentifier[1].name,
    changedIdentifier[1].bytes.toString().replace("marker(\"keep", "other(\"keep"));
  assert.throws(() => auditModuleSets(oldModules(), changedIdentifier, "index.js"), /Executable AST changed/);
});

test("does not normalize arbitrary strings that resemble chunk references", () => {
  const changed = candidateModules();
  changed[1] = js(changed[1].name,
    changed[1].bytes.toString().replace("keep this literal", "./version-Aaaaaaaa.js"));
  assert.throws(() => auditModuleSets(oldModules(), changed, "index.js"), /Executable AST changed/);
});

test("rejects a same-family-looking import basename absent from both audited manifests", () => {
  const changed = candidateModules();
  changed[1] = js(changed[1].name,
    changed[1].bytes.toString().replace("version-Ffffffff.js", "version-Zzzzzzzz.js"));
  assert.throws(() => auditModuleSets(oldModules(), changed, "index.js"), /Executable AST changed/);
});

test("requires exact WASM and bundler-runtime bytes and preserves main exports", () => {
  const changedWasm = candidateModules();
  const wasmIndex = changedWasm.findIndex(item => item.name.endsWith(".wasm"));
  changedWasm[wasmIndex] = wasm(changedWasm[wasmIndex].name, [0, 1, 2, 4]);
  assert.throws(() => auditModuleSets(oldModules(), changedWasm, "index.js"), /Byte-exact module changed/);

  const changedRuntime = candidateModules();
  const runtimeIndex = changedRuntime.findIndex(item => item.name.includes("rolldown-runtime"));
  changedRuntime[runtimeIndex] = js(changedRuntime[runtimeIndex].name, "export const runtime = 2;");
  assert.throws(() => auditModuleSets(oldModules(), changedRuntime, "index.js"), /Byte-exact module changed/);

  const changedExports = candidateModules();
  changedExports[0] = js("index.js", `const run = () => {}; export { run as invoke }; export const state = 1;`);
  assert.throws(() => auditModuleSets(oldModules(), changedExports, "index.js"), /Main module export pairs changed/);
});

test("requires a unique one-to-one mapping for every module family", () => {
  const duplicatedFamily = candidateModules();
  duplicatedFamily.push(js("assets/hook-proxy-Iiiiiiii.js", "export const another = true;"));
  assert.throws(() => auditModuleSets(oldModules(), duplicatedFamily, "index.js"), /Ambiguous JavaScript module family/);

  const unknownOld = [...oldModules(), js("assets/unreviewed-Abcdefgh.js", "export const value = 1;")];
  const unknownNew = [...candidateModules(), js("assets/unreviewed-Ijklmnop.js", "export const value = 1;")];
  assert.throws(() => auditModuleSets(unknownOld, unknownNew, "index.js"), /module families differ/);
});
import assert from "node:assert/strict";
import { parse } from "@babel/parser";
import path from "node:path";

const knownHashedFamilies = new Set([
  "hook-proxy",
  "mimetext.browser.es",
  "NodeWebSocketTransport",
  "version",
  "rolldown-runtime",
  "esbuild",
]);

const withoutFingerprint = name => {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  for (const family of knownHashedFamilies) {
    const prefix = `${family}-`;
    if (!stem.startsWith(prefix)) continue;
    const suffix = stem.slice(prefix.length);
    if (/^[A-Za-z0-9_-]{8}(?:-[A-Za-z0-9_-]{8})*$/.test(suffix)) {
      return `${path.dirname(name) === "." ? "" : `${path.dirname(name)}/`}${family}${extension}`;
    }
  }
  return name;
};

const moduleIdentity = item => /\.(js|wasm)$/.test(item.name) ? withoutFingerprint(item.name) : item.name;

const moduleIndex = modules => {
  const byName = new Map();
  const byFamily = new Map();
  const byActualBasename = new Map();
  const byIdentity = new Map();
  for (const item of modules) {
    assert(!byName.has(item.name), `Duplicate module name: ${item.name}`);
    byName.set(item.name, item);
    const basename = path.posix.basename(item.name);
    assert(!byActualBasename.has(basename), `Ambiguous module basename: ${basename}`);
    byActualBasename.set(basename, item);
    const identity = moduleIdentity(item);
    const identities = byIdentity.get(identity) ?? [];
    identities.push(item);
    byIdentity.set(identity, identities);
    if (item.name.endsWith(".js")) {
      const family = withoutFingerprint(item.name);
      const items = byFamily.get(family) ?? [];
      items.push(item);
      byFamily.set(family, items);
    }
  }
  for (const [family, items] of byFamily) {
    assert(items.length === 1, `Ambiguous JavaScript module family: ${family}`);
  }
  for (const [identity, items] of byIdentity) {
    assert(items.length === 1, `Ambiguous module identity: ${identity}`);
  }
  return { byName, byFamily, byActualBasename, byIdentity };
};

function parseModule(item) {
  return parse(item.bytes.toString("utf8"), {
    sourceType: "unambiguous",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    plugins: ["jsx"],
  });
}

const literalName = node => node && (node.type === "StringLiteral" || node.type === "Literal")
  && typeof node.value === "string" ? node.value : null;

function normalizeReference(value, oldIndex, newIndex) {
  const basename = path.posix.basename(value);
  const target = oldIndex.byActualBasename.get(basename) ?? newIndex.byActualBasename.get(basename);
  if (!target) return value;
  const family = moduleIdentity(target);
  assert(oldIndex.byIdentity.has(family) && newIndex.byIdentity.has(family),
    `Import basename is not in a corresponding old/new module family: ${basename}`);
  if (!target.name.endsWith(".js")) return value;
  const canonicalBasename = path.posix.basename(family);
  return value.slice(0, value.length - basename.length) + canonicalBasename;
}

function cleanAst(node, oldIndex, newIndex) {
  if (Array.isArray(node)) return node.map(value => cleanAst(value, oldIndex, newIndex));
  if (!node || typeof node !== "object") return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (["comments", "leadingComments", "innerComments", "trailingComments", "loc", "start", "end", "tokens", "errors", "extra"].includes(key)) continue;
    let cleaned = cleanAst(value, oldIndex, newIndex);
    if (key === "source" && (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration"
      || node.type === "ExportAllDeclaration")) {
      const specifier = literalName(value);
      if (specifier !== null) {
        cleaned = { ...cleaned, value: normalizeReference(specifier, oldIndex, newIndex) };
        const newValue = normalizeReference(specifier, oldIndex, newIndex);
        assert.equal(cleaned.value, newValue, `Import target is not a corresponding known module: ${specifier}`);
      }
    }
    if (node.type === "ImportExpression" && key === "source") {
      const specifier = literalName(value);
      if (specifier !== null) {
        cleaned = { ...cleaned, value: normalizeReference(specifier, oldIndex, newIndex) };
        const newValue = normalizeReference(specifier, oldIndex, newIndex);
        assert.equal(cleaned.value, newValue, `Dynamic import target is not a corresponding known module: ${specifier}`);
      }
    }
    if (node.type === "CallExpression" && node.callee?.type === "Import" && key === "arguments"
      && Array.isArray(value) && value.length === 1) {
      const specifier = literalName(value[0]);
      if (specifier !== null) {
        const oldValue = normalizeReference(specifier, oldIndex, newIndex);
        const newValue = normalizeReference(specifier, oldIndex, newIndex);
        assert.equal(oldValue, newValue, `Dynamic import target is not a corresponding known module: ${specifier}`);
        cleaned = [{ ...cleaned[0], value: oldValue }];
      }
    }
    result[key] = cleaned;
  }
  return result;
}

function exportedPairs(ast) {
  const pairs = [];
  const nameOf = node => {
    if (!node) return null;
    return node.name ?? node.value ?? null;
  };
  const declaredNames = node => {
    if (!node) return [];
    if (node.type === "Identifier") return [node.name];
    if (node.type === "RestElement") return declaredNames(node.argument);
    if (node.type === "AssignmentPattern") return declaredNames(node.left);
    if (node.type === "ArrayPattern") return node.elements.flatMap(declaredNames);
    if (node.type === "ObjectPattern") return node.properties.flatMap(property =>
      property.type === "RestElement" ? declaredNames(property.argument) : declaredNames(property.value));
    return [];
  };
  for (const statement of ast.program.body) {
    if (statement.type === "ExportNamedDeclaration") {
      for (const specifier of statement.specifiers) {
        pairs.push({ local: nameOf(specifier.local), exported: nameOf(specifier.exported) });
      }
      const declaration = statement.declaration;
      if (declaration?.type === "VariableDeclaration") {
        for (const item of declaration.declarations) {
          for (const local of declaredNames(item.id)) pairs.push({ local, exported: local });
        }
      } else if (declaration?.id?.name) {
        pairs.push({ local: declaration.id.name, exported: declaration.id.name });
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      const declaration = statement.declaration;
      pairs.push({ local: declaration.id?.name ?? "default", exported: "default" });
    } else if (statement.type === "ExportAllDeclaration") {
      pairs.push({ local: "*", exported: nameOf(statement.exported) ?? "*" });
    }
  }
  return pairs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const bytesEqual = (left, right) => Buffer.from(left).equals(Buffer.from(right));

export function auditModuleSets(oldModules, newModules, mainModule) {
  assert(Array.isArray(oldModules) && Array.isArray(newModules), "Module sets must be arrays");
  const oldIndex = moduleIndex(oldModules);
  const newIndex = moduleIndex(newModules);
  assert(oldIndex.byName.has(mainModule) && newIndex.byName.has(mainModule), "Main module is absent or renamed");

  const oldByIdentity = new Map();
  const newByIdentity = new Map();
  for (const item of oldModules) {
    const key = moduleIdentity(item);
    assert(!oldByIdentity.has(key), `Ambiguous old module identity: ${key}`);
    oldByIdentity.set(key, item);
  }
  for (const item of newModules) {
    const key = moduleIdentity(item);
    assert(!newByIdentity.has(key), `Ambiguous candidate module identity: ${key}`);
    newByIdentity.set(key, item);
  }
  assert.deepEqual([...oldByIdentity.keys()].sort(), [...newByIdentity.keys()].sort(),
    "Old and candidate module families differ");

  const modules = [];
  let mainExports;
  for (const identity of [...oldByIdentity.keys()].sort()) {
    const before = oldByIdentity.get(identity);
    const after = newByIdentity.get(identity);
    if (identity === moduleIdentity(oldIndex.byName.get(mainModule))) {
      assert.equal(after.name, mainModule, "Main module filename changed");
      const oldExports = exportedPairs(parseModule(before));
      const newExports = exportedPairs(parseModule(after));
      assert.deepEqual(newExports, oldExports, "Main module export pairs changed");
      mainExports = oldExports;
      modules.push({ family: identity, old: before.name, candidate: after.name, result: "MAIN_EXPORTS_EQUAL" });
      continue;
    }
    if (before.name.endsWith(".wasm") || /(?:^|\/)rolldown-runtime(?:-[^/]*)?\.js$/.test(before.name)) {
      assert(bytesEqual(before.bytes, after.bytes), `Byte-exact module changed: ${before.name}`);
      modules.push({ family: identity, old: before.name, candidate: after.name, result: "BYTE_IDENTICAL" });
      continue;
    }
    assert(before.name.endsWith(".js") && after.name.endsWith(".js"), `Unsupported module type: ${before.name}`);
    const oldAst = cleanAst(parseModule(before), oldIndex, newIndex);
    const newAst = cleanAst(parseModule(after), oldIndex, newIndex);
    assert.deepEqual(newAst, oldAst, `Executable AST changed for module family ${identity}`);
    modules.push({
      family: identity, old: before.name, candidate: after.name,
      result: bytesEqual(before.bytes, after.bytes) ? "BYTE_IDENTICAL" : "EXECUTABLE_AST_EQUAL",
    });
  }
  return { status: "PASS", mainModule, mainExports, modules };
}
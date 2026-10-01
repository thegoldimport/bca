import { parse } from "@babel/parser";

type PreviewCapability = {
  agentId: string;
  branch: string;
  token?: string;
};

type SourceLocation = {
  start?: number | null;
  end?: number | null;
  value?: unknown;
};

function isStringLiteral(value: unknown): value is SourceLocation & { value: string } {
  if (!value || typeof value !== "object") return false;
  const node = value as { type?: unknown; value?: unknown };
  return node.type === "StringLiteral" && typeof node.value === "string";
}

/** Rewrites only AST module-specifier nodes, preserving all other source spans. */
export function rewritePreviewModuleSpecifiers(
  source: string,
  rewrite: (specifier: string) => string,
): string {
  let ast: unknown;
  try {
    ast = parse(source, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      plugins: ["jsx", "typescript", "decorators-legacy"],
    });
  } catch {
    // Invalid/incomplete generated source remains byte-for-byte unchanged.
    return source;
  }

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const node = value as Record<string, unknown>;
    let specifier: unknown;
    if (node.type === "ImportDeclaration" || node.type === "ExportNamedDeclaration"
      || node.type === "ExportAllDeclaration") {
      specifier = node.source;
    } else if (node.type === "ImportExpression") {
      specifier = node.source;
    } else if (node.type === "CallExpression"
      && (node.callee as { type?: unknown } | null)?.type === "Import") {
      specifier = (node.arguments as unknown[] | undefined)?.[0];
    }

    if (isStringLiteral(specifier)) {
      const start = specifier.start;
      const end = specifier.end;
      if (typeof start === "number" && typeof end === "number") {
        const next = rewrite(specifier.value);
        if (next !== specifier.value) {
          replacements.push({ start, end, value: JSON.stringify(next) });
        }
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "extra"
        || key.endsWith("Comments") || key === "comments" || key === "tokens") continue;
      visit(child);
    }
  };

  try {
    visit(ast);
  } catch {
    return source;
  }
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    source = `${source.slice(0, replacement.start)}${replacement.value}${source.slice(replacement.end)}`;
  }
  return source;
}

/** Inline closure installed before generated scripts in a preview document. */
export function previewRequestSinkBootstrap(
  origin: string,
  branchPrefix: string,
  token: string,
): string {
  const options = JSON.stringify({ origin, branchPrefix, token });
  return `(function(){const k=Symbol.for("buildcustom.preview.request-sink");if(window[k])return;Object.defineProperty(window,k,{value:true});const c=${options};const scope=function(v){let raw;`
    + `if(typeof v==="string")raw=v;else if(v instanceof URL)raw=v.href;`
    + `else if(typeof Request!=="undefined"&&v instanceof Request)raw=v.url;else return null;`
    + `if(typeof raw!=="string"||!raw||raw.length>4096||raw!==raw.trim()||/[\\u0000-\\u001f\\u007f\\\\]/.test(raw))return null;`
    + `if(/^(?:data:|blob:)/i.test(raw)||raw.startsWith("//")||/%(?![0-9a-f]{2})/i.test(raw))return null;`
    + `const current=new URL(c.branchPrefix).pathname.replace(/\\/+$/,"")+"/";let u;`
    + `const scheme=raw.match(/^([a-z][a-z0-9+.-]*):/i);`
    + `if(scheme){if(!/^https?:$/i.test(scheme[0]))return null;try{u=new URL(raw)}catch{return null}`
    + `if(u.origin!==c.origin||!u.pathname.startsWith(current))return null}`
    + `else{const rawPath=raw.split(/[?#]/,1)[0];const path=rawPath.startsWith(current)?rawPath.slice(current.length):rawPath;const parts=path.split("/");if(!path||parts.some(function(s,i){try{const d=decodeURIComponent(s);return (!s&&!(i===0&&path.startsWith("/")))||d===".."||d.includes("/")||d.includes("\\\\")||/[\\u0000-\\u001f\\u007f]/.test(d)}catch{return true}}))return null;`
     + `try{if(raw.startsWith("//"))return null;if(raw.startsWith("/")){u=new URL(raw,c.origin);if(u.pathname==="/cdn-cgi/rum")return null;if(u.pathname.startsWith("/_private_preview/")){if(!u.pathname.startsWith(current))return null}else if(u.pathname==="/_private_preview"||u.pathname==="/space"||u.pathname.startsWith("/space/"))return null;else{const p=u.pathname.replace(/^\\/+/,"");if(!p)return null;u=new URL(current+p+u.search+u.hash,c.origin)}}else{u=new URL(raw,document.baseURI);if(u.origin!==c.origin||!u.pathname.startsWith(current))return null}}catch{return null}}`
    + `const rest=u.pathname.slice(current.length);if(rest.split("/").some(function(s){try{const d=decodeURIComponent(s);return !s||d===".."||d.includes("/")||d.includes("\\\\")||/[\\u0000-\\u001f\\u007f]/.test(d)}catch{return true}})||!rest)return null;`
    + `u.searchParams.delete("t");u.searchParams.delete("__bc_preview_source");u.searchParams.append("t",c.token);return u.href};`
    + `const f=window.fetch;window.fetch=function(input,init){const url=scope(input);if(!url)return f.call(this,input,init);`
    + `if(typeof Request!=="undefined"&&input instanceof Request){try{return f.call(this,new Request(url,new Request(input,init)))}catch(error){return Promise.reject(error)}}return f.call(this,url,init)};`
    + `if(window.XMLHttpRequest){const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){const scoped=scope(url);`
    + `const args=Array.prototype.slice.call(arguments);if(scoped)args[1]=scoped;return open.apply(this,args)}}})();`;
}

export function previewBranchPrefix(origin: string, capability: PreviewCapability): string {
  return `${origin}/_private_preview/${encodeURIComponent(capability.agentId)}/${encodeURIComponent(capability.branch)}`;
}
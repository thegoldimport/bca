import { createHash } from "crypto";

type ProjectContext = {
  name: string;
  type: string;
  description?: string | null;
};

export type SeoSuggestionSet = {
  projectSummary: string;
  metaTitle: string[];
  metaDescription: string[];
  focusKeyword: string[];
  ogTitle: string[];
  ogDescription: string[];
  schemaJson: string;
};

const cache = new Map<string, { expiresAt: number; value: SeoSuggestionSet }>();

function cleanSequence(value: unknown, maxLength: number) {
  if (!Array.isArray(value)) return [];
  const unique = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
  return unique.filter((item, index) => index === 0 || item.toLowerCase().startsWith(unique[index - 1].toLowerCase()));
}

function progressiveSummary(summary: string, maxLength: number) {
  const words = summary.replace(/\s+/g, " ").trim().split(" ");
  const targets = maxLength <= 160 ? [65, 110, maxLength] : [110, 240, maxLength];
  const results: string[] = [];
  for (const target of targets) {
    let candidate = "";
    for (const word of words) {
      const expanded = candidate ? `${candidate} ${word}` : word;
      if (expanded.length > target) break;
      candidate = expanded;
    }
    candidate = candidate.replace(/[,:;]$/, "");
    if (candidate && candidate.length > (results.at(-1)?.length || 0)) results.push(candidate);
  }
  return results;
}

export function isSeoContextPath(path: string) {
  const normalized = path.toLowerCase();
  if (
    normalized.includes("node_modules/") ||
    normalized.includes(".git/") ||
    normalized.includes("dist/") ||
    normalized.includes("build/") ||
    normalized.includes("/.env") ||
    normalized.endsWith(".env") ||
    normalized.includes("secret") ||
    normalized.includes("credential") ||
    normalized.endsWith(".lock") ||
    normalized.endsWith("-lock.json")
  ) return false;
  return /\.(?:tsx?|jsx?|html?|md|json|css|vue|svelte)$/i.test(path);
}

export function rankSeoContextPath(path: string) {
  const normalized = path.toLowerCase();
  if (/(?:^|\/)readme\.md$/.test(normalized)) return 100;
  if (/(?:^|\/)(?:app|page|home|index)\.(?:tsx?|jsx?|html?|vue|svelte)$/.test(normalized)) return 95;
  if (normalized.includes("/pages/") || normalized.includes("/components/")) return 80;
  if (normalized.endsWith("package.json")) return 70;
  if (normalized.endsWith(".json")) return 40;
  if (normalized.endsWith(".css")) return 20;
  return 50;
}

export async function generateSeoSuggestions(
  project: ProjectContext,
  deploymentUrl: string | undefined,
  files: Array<{ path: string; content: string }>,
) {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY;
  if (!apiKey) throw new Error("Project-aware SEO suggestions are not configured.");

  const context = files.map(({ path, content }) => `FILE: ${path}\n${content}`).join("\n\n");
  const fingerprint = createHash("sha256").update(JSON.stringify({ project, deploymentUrl, context })).digest("hex");
  const cached = cache.get(fingerprint);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const prompt = `Analyze the generated application source below and identify what the product actually does.
Do not describe its framework, programming language, visual style, or the fact that it was generated.
Write specific, natural SEO copy based on the product's real screens, features, audience, and purpose.

Return JSON only with:
- projectSummary: one factual sentence describing the actual product
- metaTitle: 2-3 progressively longer suggestions, each beginning exactly with the previous suggestion, maximum 60 characters each
- metaDescription: 2-3 progressively longer suggestions, each beginning exactly with the previous suggestion, maximum 160 characters each
- focusKeyword: 2-3 progressively longer suggestions, each beginning exactly with the previous suggestion, maximum 120 characters each
- ogTitle: 2-3 progressively longer suggestions, each beginning exactly with the previous suggestion, maximum 120 characters each
- ogDescription: 2-3 progressively longer suggestions, each beginning exactly with the previous suggestion, maximum 500 characters each
- schemaJson: a valid JSON-LD object encoded as a JSON string, describing the actual product

Project name: ${project.name}
Project type: ${project.type}
Known project description: ${project.description || "None"}
Published URL: ${deploymentUrl || "Not published"}

GENERATED PROJECT FILES:
${context}`;

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });
  if (!response.ok) throw new Error("Unable to analyze the generated project right now.");
  const payload: any = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "";
  const parsed = JSON.parse(text);
  const schema = typeof parsed.schemaJson === "string" ? parsed.schemaJson : JSON.stringify(parsed.schemaJson || {});
  JSON.parse(schema);
  const projectSummary = typeof parsed.projectSummary === "string" ? parsed.projectSummary.trim().slice(0, 500) : "";
  const descriptionSequence = progressiveSummary(projectSummary, 160);
  const socialDescriptionSequence = progressiveSummary(projectSummary, 500);
  const value: SeoSuggestionSet = {
    projectSummary,
    metaTitle: cleanSequence(parsed.metaTitle, 60),
    metaDescription: descriptionSequence.length > 1 ? descriptionSequence : cleanSequence(parsed.metaDescription, 160),
    focusKeyword: cleanSequence(parsed.focusKeyword, 120),
    ogTitle: cleanSequence(parsed.ogTitle, 120),
    ogDescription: socialDescriptionSequence.length > 1 ? socialDescriptionSequence : cleanSequence(parsed.ogDescription, 500),
    schemaJson: schema.slice(0, 50_000),
  };
  if (!value.projectSummary || !value.metaTitle.length || !value.metaDescription.length) {
    throw new Error("The generated project could not be summarized.");
  }
  cache.set(fingerprint, { expiresAt: Date.now() + 15 * 60_000, value });
  return value;
}
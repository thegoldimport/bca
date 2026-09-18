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

function completeValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return [...value].reverse().find((item) => typeof item === "string")?.trim() || "";
  return "";
}

function completeMetaDescription(candidate: string, summary: string) {
  const endings = [
    " Stay organized.",
    " Get started today.",
    " Keep work moving.",
    " Explore the key features.",
    " Simplify your daily workflow.",
    " Plan clearly and get more done.",
    " Built to keep your work on track.",
  ];
  for (const source of [candidate, summary]) {
    const base = source.replace(/\s+/g, " ").trim();
    if (base.length >= 150 && base.length <= 160 && /[.!?]$/.test(base)) return base;
    const withoutPeriod = base.replace(/[.!?]+$/, "");
    for (const ending of endings) {
      const completed = `${withoutPeriod}${ending}`;
      if (completed.length >= 150 && completed.length <= 160) return completed;
    }
  }
  return "";
}

function completeTitle(candidate: string, projectName: string, focusKeyword: string) {
  if (candidate.length >= 25 && candidate.length <= 60 && candidate.toLowerCase() !== projectName.toLowerCase()) return candidate;
  const keyword = focusKeyword
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return `${projectName} | ${keyword || "Helpful Online Software"}`.slice(0, 60).trim();
}

function fallbackSeoSuggestions(project: ProjectContext, deploymentUrl: string | undefined, context: string): SeoSuggestionSet {
  const source = context.toLowerCase();
  let keyword = "online software";
  let summary = `${project.name} helps users access and manage the core tools and features available throughout the application.`;
  let description = "";

  if (/\b(task|tasks|subtask|priority|priorities|due date|to-do|kanban)\b/.test(source)) {
    keyword = "task management software";
    summary = `${project.name} is a task management app for organizing projects, priorities, due dates, subtasks, categories, and daily work.`;
    description = `${project.name} helps you manage tasks, priorities, due dates, and subtasks. Organize projects with clear categories and flexible views to stay focused every day.`;
  } else if (/\b(cart|checkout|products?|inventory|shop|storefront)\b/.test(source)) {
    keyword = "online shopping platform";
    summary = `${project.name} is an online shopping experience for browsing products, comparing options, managing a cart, and completing purchases.`;
  } else if (/\b(workout|fitness|exercise|training|calorie)\b/.test(source)) {
    keyword = "fitness tracking app";
    summary = `${project.name} is a fitness app for planning workouts, tracking activity, monitoring progress, and supporting healthier daily routines.`;
  } else if (/\b(appointment|booking|reservation|availability|schedule)\b/.test(source)) {
    keyword = "online booking software";
    summary = `${project.name} is a booking app for checking availability, scheduling appointments, managing reservations, and keeping plans organized.`;
  } else if (/\b(invoice|budget|expense|transaction|finance|payment)\b/.test(source)) {
    keyword = "financial management software";
    summary = `${project.name} is a financial management app for tracking money, reviewing activity, organizing records, and making informed decisions.`;
  } else if (/\b(portfolio|case studies|experience|skills|resume)\b/.test(source)) {
    keyword = "professional portfolio";
    summary = `${project.name} is a professional portfolio showcasing selected work, practical skills, project experience, and ways to get in touch.`;
  }

  description ||= completeMetaDescription(summary, summary);
  if (!description) {
    const base = summary.replace(/[.!?]+$/, "");
    description = `${base}. Explore its practical features and get started today.`;
    if (description.length > 160) description = completeMetaDescription("", summary) || summary.slice(0, 156).replace(/\s+\S*$/, "") + ".";
  }
  const title = completeTitle("", project.name, keyword);
  const schemaJson = JSON.stringify({
    "@context": "https://schema.org",
    "@type": project.type === "website" ? "WebSite" : "SoftwareApplication",
    name: project.name,
    description,
    ...(deploymentUrl ? { url: deploymentUrl } : {}),
  }, null, 2);
  return {
    projectSummary: summary,
    metaTitle: [title],
    metaDescription: [description],
    focusKeyword: [keyword],
    ogTitle: [title],
    ogDescription: [description],
    schemaJson,
  };
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
- metaTitle: one complete SEO title, 25-60 characters. Use a natural keyword-focused format such as "Product Name | Primary Search Benefit". Never return only the product name
- metaDescription: one complete, grammatical description between 150 and 160 characters inclusive. Finish the sentence naturally; never truncate a word or thought
- focusKeyword: one specific primary search phrase, maximum 120 characters
- ogTitle: one complete social title, 35-80 characters
- ogDescription: one complete social description, 120-200 characters
- schemaJson: a valid JSON-LD object encoded as a JSON string, describing the actual product

Project name: ${project.name}
Project type: ${project.type}
Known project description: ${project.description || "None"}
Published URL: ${deploymentUrl || "Not published"}

GENERATED PROJECT FILES:
${context}`;

  let parsed: any;
  let lastParsed: any;
  for (let attempt = 0; attempt < 1; attempt++) {
    const correction = attempt
      ? "\nYour previous response missed a strict length or completeness requirement. Recount every character and return corrected, complete values."
      : "";
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt + correction }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("Unable to analyze the generated project right now.");
      const payload: any = await response.json();
      const text = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("") || "";
      lastParsed = JSON.parse(text);
      const summary = completeValue(lastParsed.projectSummary);
      const description = completeMetaDescription(completeValue(lastParsed.metaDescription), summary);
      const title = completeTitle(completeValue(lastParsed.metaTitle), project.name, completeValue(lastParsed.focusKeyword));
      if (title.length >= 25 && description) {
        parsed = { ...lastParsed, metaTitle: title, metaDescription: description };
        break;
      }
    } catch {
      // Fall back to source-derived templates below.
    }
  }
  if (!parsed && lastParsed) {
    const summary = completeValue(lastParsed.projectSummary);
    const description = completeMetaDescription(completeValue(lastParsed.metaDescription), summary);
    const title = completeTitle(completeValue(lastParsed.metaTitle), project.name, completeValue(lastParsed.focusKeyword));
    if (description) parsed = { ...lastParsed, metaTitle: title, metaDescription: description };
  }
  if (!parsed) {
    const value = fallbackSeoSuggestions(project, deploymentUrl, context);
    cache.set(fingerprint, { expiresAt: Date.now() + 15 * 60_000, value });
    return value;
  }
  const schema = typeof parsed.schemaJson === "string" ? parsed.schemaJson : JSON.stringify(parsed.schemaJson || {});
  JSON.parse(schema);
  const projectSummary = typeof parsed.projectSummary === "string" ? parsed.projectSummary.trim().slice(0, 500) : "";
  const metaTitle = completeValue(parsed.metaTitle);
  const metaDescription = completeValue(parsed.metaDescription);
  const focusKeyword = completeValue(parsed.focusKeyword);
  const ogTitle = completeValue(parsed.ogTitle);
  const ogDescription = completeValue(parsed.ogDescription);
  const value: SeoSuggestionSet = {
    projectSummary,
    metaTitle: metaTitle ? [metaTitle] : [],
    metaDescription: metaDescription ? [metaDescription] : [],
    focusKeyword: focusKeyword ? [focusKeyword.slice(0, 120)] : [],
    ogTitle: ogTitle ? [ogTitle.slice(0, 120)] : [],
    ogDescription: ogDescription ? [ogDescription.slice(0, 500)] : [],
    schemaJson: schema.slice(0, 50_000),
  };
  if (!value.projectSummary || !value.metaTitle.length || !value.metaDescription.length) {
    throw new Error("The generated project could not be summarized.");
  }
  cache.set(fingerprint, { expiresAt: Date.now() + 15 * 60_000, value });
  return value;
}
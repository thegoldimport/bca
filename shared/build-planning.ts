export type PlanningMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type PlanningQuestion = {
  id: "idea" | "audience" | "outcomes";
  prompt: string;
  options: string[];
  multiple: boolean;
  helperText?: string;
};

export type PlanningSession = {
  version: 1;
  mode: "build" | "plan";
  phase: "clarifying" | "awaiting_approval" | "submitted";
  originalPrompt: string;
  audience: string | null;
  outcomes: string[];
  skipped: string[];
  questionsAsked: number;
  messages: PlanningMessage[];
  currentQuestion: PlanningQuestion | null;
  planSummary: string | null;
};

export type PlanningStart =
  | { kind: "build"; prompt: string; acknowledgement: string }
  | { kind: "planning"; session: PlanningSession };

export type PlanningAdvance =
  | { kind: "question"; session: PlanningSession }
  | { kind: "approval"; session: PlanningSession }
  | { kind: "build"; session: PlanningSession; buildPrompt: string; acknowledgement: string };

const LEAD_GENERATION_AUDIENCE = [
  "Local businesses",
  "B2B companies",
  "Marketing agencies",
  "Real estate",
  "All industries",
  "Something else",
];

const LEAD_GENERATION_OUTCOMES = [
  "Find potential customers",
  "Capture website leads",
  "Manage leads in a CRM",
  "Enrich contact information",
  "Run outreach campaigns",
  "All of the above",
  "Something else",
];

const CATEGORY_CHOICES: Record<string, { audience: string[]; outcomes: string[] }> = {
  ecommerce: {
    audience: ["Direct shoppers", "Wholesale buyers", "Local customers", "A niche community", "Something else"],
    outcomes: ["Browse products", "Manage inventory", "Take orders", "Offer subscriptions", "Something else"],
  },
  marketplace: {
    audience: ["Buyers", "Sellers or providers", "Local communities", "Businesses", "Something else"],
    outcomes: ["Discover listings", "Book services", "Compare options", "Manage transactions", "Something else"],
  },
  game: {
    audience: ["Casual players", "Competitive players", "Families", "A specific community", "Something else"],
    outcomes: ["Explore a world", "Solve challenges", "Compete with others", "Create or share levels", "Something else"],
  },
  website: {
    audience: ["Potential customers", "Existing customers", "Community members", "Employers or clients", "Something else"],
    outcomes: ["Explain an offering", "Capture inquiries", "Book appointments", "Publish useful content", "Something else"],
  },
  dashboard: {
    audience: ["Owners", "Operations teams", "Analysts", "Customers", "Something else"],
    outcomes: ["Monitor metrics", "Track work", "Compare performance", "Manage records", "Something else"],
  },
  crm: {
    audience: ["Sales teams", "Service businesses", "Marketing agencies", "Real estate teams", "Something else"],
    outcomes: ["Manage contacts", "Track a pipeline", "Schedule follow-ups", "Measure performance", "Something else"],
  },
  generic: {
    audience: ["Customers", "An internal team", "A local community", "Creators or professionals", "Something else"],
    outcomes: ["Discover information", "Create or manage records", "Book or schedule something", "Communicate with others", "Something else"],
  },
};

const MODE_DIRECTIVE = /\b(?:let'?s\s+)?(?:plan|outline)\s+(?:this\s+)?(?:first|before\s+building|before\s+i\s+build)\b|\bplan\s+this\s+before\s+building\b/i;
const SKIP_DIRECTIVE = /\b(?:just\s+build(?:\s+it)?|you\s+decide|skip\s+the\s+questions?|make\s+the\s+decisions?)\b/i;
const DETAIL_TERMS = [
  /\b(?:lead|contact|customer|user|product|order|appointment|booking|calendar|pipeline|stage|campaign|workflow|task|metric|report|dashboard|profile|message|chat|review|checkout|inventory|catalog|gallery|portfolio|lesson|level|challenge|leaderboard|map|search|filter|subscription|payment|invoice|form|notification|analytics|listing|marketplace)s?\b/gi,
  /\b(?:track|manage|schedule|book|capture|sell|compare|discover|enrich|publish|monitor|organize|create|measure|review|message|play|learn|explore|submit|approve|assign|report|analyze|share)\b/gi,
];
const ATOMIC_PROJECTS = /\b(?:calculator|unit converter|countdown timer|stopwatch|pomodoro timer|qr code generator|color palette generator|single-page portfolio|link-in-bio page)\b/i;

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").slice(0, 6000);
}

function stripModeDirective(prompt: string): string {
  return normalizePrompt(prompt.replace(MODE_DIRECTIVE, "").replace(/\b(?:let'?s\s+)?plan\s+this\s+before\s+building\b/i, ""));
}

function categoryFor(prompt: string): keyof typeof CATEGORY_CHOICES {
  const value = prompt.toLowerCase();
  if (/\b(?:lead gen|lead generation|prospect|outreach)\b/.test(value)) return "generic";
  if (/\b(?:e-?commerce|online store|shop|shopping cart|product catalog)\b/.test(value)) return "ecommerce";
  if (/\bmarketplace\b/.test(value)) return "marketplace";
  if (/\b(?:game|gaming|player|level|puzzle)\b/.test(value)) return "game";
  if (/\b(?:crm|sales pipeline|customer relationship)\b/.test(value)) return "crm";
  if (/\b(?:dashboard|analytics|reporting)\b/.test(value)) return "dashboard";
  if (/\b(?:website|landing page|portfolio|business site|blog)\b/.test(value)) return "website";
  return "generic";
}

function hasAudience(prompt: string): boolean {
  if (/\b(?:for lead gen|for lead generation|for tracking|for managing|for finding|for capturing|for booking|for selling|for monitoring)\b/i.test(prompt)) {
    return /\b(?:for|targeting|serving)\s+(?:my|our|the)?\s*(?:business(?:es)?|customers?|users?|teams?|contractors?|agenc(?:y|ies)|companies|shops?|owners?|students?|parents?|players?|shoppers?|buyers?|sellers?|creators?|professionals?|members?|employees?|freelancers?|artists?|restaurants?|salons?|clinics?|coaches?|teachers?)\b/i.test(prompt);
  }
  return /\b(?:for|targeting|serving|built for|used by)\s+(?:my|our|the|a|an)?\s*(?:[a-z][\w-]*\s+){0,3}(?:business(?:es)?|customers?|users?|teams?|contractors?|agenc(?:y|ies)|companies|shops?|owners?|students?|parents?|players?|shoppers?|buyers?|sellers?|creators?|professionals?|members?|employees?|freelancers?|artists?|restaurants?|salons?|clinics?|coaches?|teachers?)\b/i.test(prompt);
}

function detailCount(prompt: string): number {
  const terms = DETAIL_TERMS
    .map((pattern) => prompt.match(pattern)?.[0]?.toLowerCase())
    .filter((term): term is string => Boolean(term));
  const uniqueTerms = new Set(terms);
  const clauses = prompt
    .split(/[,;]|\band\b|\bwith\b/gi)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).filter(Boolean).length >= 2);
  return Math.max(uniqueTerms.size, clauses.length);
}

function sufficientlyDetailed(prompt: string): boolean {
  if (ATOMIC_PROJECTS.test(prompt)) return true;
  const words = prompt.split(/\s+/).filter(Boolean).length;
  const details = detailCount(prompt);
  if (hasAudience(prompt) && details >= 2) return true;
  return words >= 18 && details >= 4;
}

function newMessage(role: PlanningMessage["role"], content: string, now: number): PlanningMessage {
  return { id: `${role}-${now}-${Math.random().toString(36).slice(2, 8)}`, role, content, createdAt: now };
}

function questionFor(id: PlanningQuestion["id"], prompt: string): PlanningQuestion {
  const category = categoryFor(prompt);
  if (id === "idea") {
    return {
      id,
      prompt: "What would you like to build?",
      options: [],
      multiple: false,
      helperText: "A short description is enough to get started.",
    };
  }
  if (id === "audience") {
    const leadGen = /\b(?:lead gen|lead generation|prospect|outreach)\b/i.test(prompt);
    return {
      id,
      prompt: leadGen
        ? "Love the idea. Before I start, who are we building this for?"
        : "Before I start, who will use this first?",
      options: leadGen ? LEAD_GENERATION_AUDIENCE : CATEGORY_CHOICES[category].audience,
      multiple: false,
      helperText: "Choose an option or tell me in your own words.",
    };
  }
  const leadGen = /\b(?:lead gen|lead generation|prospect|outreach)\b/i.test(prompt);
  return {
    id,
    prompt: leadGen
      ? "What should the platform actually help customers do?"
      : "What should people be able to do first?",
    options: leadGen ? LEAD_GENERATION_OUTCOMES : CATEGORY_CHOICES[category].outcomes,
    multiple: true,
    helperText: "Select any that matter for the first version.",
  };
}

function planSummary(session: PlanningSession): string {
  const audience = session.audience || "the audience implied by your request";
  const outcomes = session.outcomes.length
    ? session.outcomes.join(", ")
    : "the main workflow in your request";
  return `I'll build a first version for ${audience}, focused on ${outcomes}. I'll start with the core experience and use sensible defaults for technical and visual details.`;
}

export function buildPromptFromPlanningSession(session: PlanningSession): string {
  const audience = session.audience ? `Target users: ${session.audience}.` : "Use the audience implied by the request.";
  const outcomes = session.outcomes.length ? `Core outcomes: ${session.outcomes.join(", ")}.` : "Choose a useful core workflow from the request.";
  const transcript = session.messages
    .map((message) => `${message.role === "user" ? "Customer" : "BuildCustom"}: ${message.content}`)
    .join("\n");
  return `${session.originalPrompt}\n\nConfirmed build context:\n${audience}\n${outcomes}\n\nPlanning conversation:\n${transcript}`;
}

function createSession(prompt: string, mode: PlanningSession["mode"], now: number): PlanningSession {
  const cleanedPrompt = stripModeDirective(prompt);
  const isDetailed = sufficientlyDetailed(cleanedPrompt);
  const session: PlanningSession = {
    version: 1,
    mode,
    phase: isDetailed ? "awaiting_approval" : "clarifying",
    originalPrompt: cleanedPrompt,
    audience: null,
    outcomes: [],
    skipped: [],
    questionsAsked: 0,
    messages: [],
    currentQuestion: null,
    planSummary: null,
  };

  if (cleanedPrompt) session.messages.push(newMessage("user", cleanedPrompt, now));

  if (isDetailed) {
    session.planSummary = planSummary(session);
    session.messages.push(newMessage("assistant", `Here's a first-pass plan. ${session.planSummary}`, now + 1));
    return session;
  }

  const firstQuestion = questionFor(cleanedPrompt ? (hasAudience(cleanedPrompt) ? "outcomes" : "audience") : "idea", cleanedPrompt);
  session.currentQuestion = firstQuestion;
  session.questionsAsked = 1;
  session.messages.push(newMessage("assistant", firstQuestion.prompt, now + 1));
  return session;
}

function nextQuestion(session: PlanningSession): PlanningQuestion | null {
  if (!session.originalPrompt) return questionFor("idea", session.originalPrompt);
  if (!session.audience && !session.skipped.includes("audience")) {
    return questionFor("audience", session.originalPrompt);
  }
  if (!session.outcomes.length && !session.skipped.includes("outcomes")) {
    return questionFor("outcomes", session.originalPrompt);
  }
  return null;
}

export function startBuildPlanning(prompt: string, planFirst = false, now = Date.now()): PlanningStart {
  const originalPrompt = normalizePrompt(prompt);
  const cleanedPrompt = stripModeDirective(originalPrompt);
  if (!cleanedPrompt && !planFirst && !MODE_DIRECTIVE.test(originalPrompt)) {
    return {
      kind: "build",
      prompt: originalPrompt,
      acknowledgement: "Tell me what you want to build, and I'll help shape the first version.",
    };
  }
  if (SKIP_DIRECTIVE.test(originalPrompt)) {
    return {
      kind: "build",
      prompt: cleanedPrompt || originalPrompt,
      acknowledgement: "I'll make sensible assumptions for the details you left open and start with a useful first version.",
    };
  }
  if (planFirst || MODE_DIRECTIVE.test(originalPrompt)) {
    return { kind: "planning", session: createSession(originalPrompt, "plan", now) };
  }
  if (sufficientlyDetailed(cleanedPrompt)) {
    return {
      kind: "build",
      prompt: cleanedPrompt,
      acknowledgement: "I have enough detail to start. I'll focus the first version on the users and workflows you described, then prepare it for review.",
    };
  }
  return { kind: "planning", session: createSession(originalPrompt, "build", now) };
}

export function answerPlanningQuestion(
  current: PlanningSession,
  answer: string,
  selectedOptions: string[] = [],
  action: "answer" | "skip" | "decide" = "answer",
  now = Date.now(),
): PlanningAdvance {
  if (action === "answer" && /\b(?:you decide|just build(?: it)?|skip (?:this|the question|questions?))\b/i.test(answer)) {
    action = /\bskip\b/i.test(answer) ? "skip" : "decide";
  }
  const session: PlanningSession = {
    ...current,
    messages: [...current.messages],
    outcomes: [...current.outcomes],
    skipped: [...current.skipped],
  };
  const normalizedAnswer = normalizePrompt(answer).slice(0, 1000);
  const responseText = action === "decide"
    ? "You decide"
    : action === "skip"
      ? "Skip"
      : selectedOptions.length
        ? selectedOptions.join(", ")
        : normalizedAnswer;
  if (responseText) session.messages.push(newMessage("user", responseText, now));

  if (action === "decide") {
    session.currentQuestion = null;
    session.phase = session.mode === "plan" ? "awaiting_approval" : "awaiting_approval";
    session.planSummary = planSummary(session);
    const acknowledgement = "I'll use sensible defaults for anything still open and start with the core experience.";
    session.messages.push(newMessage("assistant", acknowledgement, now + 1));
    if (session.mode === "plan") return { kind: "approval", session };
    return {
      kind: "build",
      session,
      buildPrompt: buildPromptFromPlanningSession(session),
      acknowledgement,
    };
  }

  if (action === "skip" && session.currentQuestion) {
    if (!session.skipped.includes(session.currentQuestion.id)) session.skipped.push(session.currentQuestion.id);
  } else if (session.currentQuestion?.id === "idea") {
    session.originalPrompt = normalizedAnswer;
  } else if (session.currentQuestion?.id === "audience") {
    session.audience = normalizedAnswer || selectedOptions[0] || null;
  } else if (session.currentQuestion?.id === "outcomes") {
    const selected = selectedOptions.length ? selectedOptions : normalizedAnswer.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
    session.outcomes = selected.filter((item) => item && item !== "Something else" && item !== "All of the above").slice(0, 8);
    if (selected.includes("All of the above")) {
      session.outcomes = session.currentQuestion.options.filter((item) => item !== "Something else" && item !== "All of the above");
    }
  }

  const question = nextQuestion(session);
  if (question && session.questionsAsked < 3) {
    session.currentQuestion = question;
    session.questionsAsked += 1;
    session.messages.push(newMessage("assistant", question.prompt, now + 1));
    return { kind: "question", session };
  }

  session.currentQuestion = null;
  session.planSummary = planSummary(session);
  if (session.mode === "plan") {
    session.phase = "awaiting_approval";
    session.messages.push(newMessage("assistant", `Here's a first-pass plan. ${session.planSummary}`, now + 1));
    return { kind: "approval", session };
  }
  session.phase = "awaiting_approval";
  const acknowledgement = `Got it. ${session.planSummary}`;
  session.messages.push(newMessage("assistant", acknowledgement, now + 1));
  return {
    kind: "build",
    session,
    buildPrompt: buildPromptFromPlanningSession(session),
    acknowledgement,
  };
}

export function approveBuildPlan(session: PlanningSession, now = Date.now()): PlanningSession {
  return {
    ...session,
    phase: "awaiting_approval",
    currentQuestion: null,
    messages: [...session.messages, newMessage("user", "Approve and build", now)],
  };
}

export function isValidPlanningSession(value: unknown): value is PlanningSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<PlanningSession>;
  if (session.version !== 1
    || (session.mode !== "build" && session.mode !== "plan")
    || (session.phase !== "clarifying" && session.phase !== "awaiting_approval" && session.phase !== "submitted")
    || typeof session.originalPrompt !== "string" || session.originalPrompt.length > 6000
    || !(session.audience === null || typeof session.audience === "string")
    || !Array.isArray(session.outcomes) || session.outcomes.length > 8
    || !session.outcomes.every((item) => typeof item === "string" && item.length <= 200)
    || !Array.isArray(session.skipped) || session.skipped.length > 3
    || !Number.isInteger(session.questionsAsked) || (session.questionsAsked ?? 0) < 0 || (session.questionsAsked ?? 0) > 3
    || !Array.isArray(session.messages) || session.messages.length > 16
    || !session.messages.every((message) => message && typeof message.id === "string"
      && (message.role === "user" || message.role === "assistant")
      && typeof message.content === "string" && message.content.length <= 6000
      && Number.isFinite(message.createdAt))
    || !(session.currentQuestion === null || (session.currentQuestion && typeof session.currentQuestion === "object"
      && ["idea", "audience", "outcomes"].includes(session.currentQuestion.id)
      && typeof session.currentQuestion.prompt === "string"
      && Array.isArray(session.currentQuestion.options)
      && session.currentQuestion.options.length <= 12
      && session.currentQuestion.options.every((option) => typeof option === "string" && option.length <= 120)
      && typeof session.currentQuestion.multiple === "boolean"))
    || !(session.planSummary === null || (typeof session.planSummary === "string" && session.planSummary.length <= 2000))) {
    return false;
  }
  return true;
}


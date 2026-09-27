import { z } from 'zod';
import log from './logger.js';

// Intent routing. Two engines pick a model category for a prompt:
// - 'llm': an OpenAI-compatible chat model answers with a JSON decision.
// - 'jev': TypeSafe Jev answers one typed Choice question over the configured categories.
// Jev is opt-in (it is a cloud API); the LLM router stays the default and the fallback.

export type RouterEngine = 'llm' | 'jev';

export const ROUTER_ENGINES = ['llm', 'jev'] as const;
export const DEFAULT_ROUTER_ENGINE: RouterEngine = 'llm';

export const ROUTER_TIMEOUT_MS = 30_000;
export const FALLBACK_CATEGORY = 'GENERAL';
/** Categories that only make sense when the user attached files. */
export const ATTACHMENT_ONLY_CATEGORIES = new Set(['VISION', 'DOCUMENT']);

export const JEV_API_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
/** Below this Choice confidence, Jev's pick is replaced by FALLBACK_CATEGORY (when configured). */
export const JEV_MIN_CONFIDENCE = 0.5;
/** Jev accepts 32k tokens of state; long pastes are cut so routing stays cheap and in bounds. */
export const JEV_MAX_PROMPT_CHARS = 20_000;
const JEV_QUESTION_ID = 'category';
const PERCENT = 100;

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_OVERLOADED = 529;

/** What each built-in category is for. Shared by the LLM prompt and the Jev criteria. */
export const CATEGORY_DEFINITIONS: Record<string, string> = {
  CODING: 'Writing, debugging, reviewing, or explaining code. Any request involving programming languages, scripts, algorithms, or software development.',
  REASONING: 'Complex analysis, comparisons, multi-step logic, math, science explanations, strategic thinking, or anything requiring deep thought.',
  CREATIVE: 'Writing stories, poems, marketing copy, brainstorming, humor, or any open-ended creative task.',
  VISION: 'ONLY when the user has attached an image and wants it analyzed, described, or interpreted.',
  DOCUMENT: 'ONLY when the user has attached a document (PDF, text file) and wants it summarized, analyzed, or queried.',
  FAST: 'ONLY for pure micro-interactions with no knowledge retrieval: greetings ("hi", "thanks"), single-word acknowledgements, or trivial arithmetic ("what is 2+2"). Any question about the world, a concept, a fact, a person, or a technology is NOT FAST.',
  SECURITY: 'Security analysis, vulnerability assessment, threat modeling, CTF challenges, penetration testing, malware analysis, or cybersecurity topics.',
  GENERAL: 'The default for conversational queries, factual questions, explanations, summaries, and anything that does not clearly fit a more specific category.',
};

const ROUTING_RULES = [
  'Only select VISION or DOCUMENT if the user has attachments.',
  'Prefer REASONING over GENERAL for questions that require explanation, comparison, or analysis.',
  'Prefer CODING over GENERAL for anything code-related, even if the question is simple.',
  'Prefer SECURITY over GENERAL for anything security, hacking, or CTF related.',
  'Default to GENERAL over FAST. Only use FAST for greetings, one-word replies, or arithmetic with no explanation needed.',
  'If the answer requires retrieving, explaining, or describing any fact or concept, use GENERAL not FAST.',
];

export type CategoryModelEntry = string | { name: string; providerUrl?: string };

export interface RoutingCategory {
  models: CategoryModelEntry[];
  provider: 'local' | 'cloud';
}

export interface RouterSettings {
  engine?: RouterEngine;
  model: string;
  url: string;
  key: string;
  jevKey?: string;
}

export interface RouteRequest {
  prompt: string;
  hasAttachments: boolean;
  availableModels: string[];
}

export interface RouteContext {
  router: RouterSettings;
  categories: Record<string, RoutingCategory>;
  /** Used by the LLM engine when router.url is blank. */
  localProvider: { url: string; key: string };
  /** Server-level TypeSafe key, used when the user has not stored one. */
  defaultJevKey: string;
}

export interface RouteDecision {
  category: string;
  model: string;
  provider: 'local' | 'cloud';
  reasoning: string;
  confidence: number;
  routerModel: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export function categoryModelName(entry: CategoryModelEntry | undefined): string {
  if (!entry) return '';
  return typeof entry === 'string' ? entry : entry.name;
}

function categoryDefinition(category: string): string {
  return CATEGORY_DEFINITIONS[category] ?? `Requests best served by the user's custom "${category}" category.`;
}

/** Categories Jev may pick: at least one model assigned, and attachment-only ones only with attachments. */
export function eligibleCategories(categories: Record<string, RoutingCategory>, hasAttachments: boolean): string[] {
  return Object.entries(categories)
    .filter(([, cfg]) => cfg.models.length > 0)
    .filter(([name]) => hasAttachments || !ATTACHMENT_ONLY_CATEGORIES.has(name))
    .map(([name]) => name);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROUTER_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Router request timed out after ${ROUTER_TIMEOUT_MS / 1000} seconds.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Jev engine ───

export function buildJevRequest(request: RouteRequest, categories: string[]) {
  return {
    model: JEV_MODEL,
    state: {
      user_prompt: request.prompt.slice(0, JEV_MAX_PROMPT_CHARS),
      has_attachments: request.hasAttachments,
    },
    questions: {
      [JEV_QUESTION_ID]: {
        type: 'choice',
        instructions: {
          task: 'Pick the model category that should answer `user_prompt`.',
          rules: ROUTING_RULES,
        },
        criteria: Object.fromEntries(categories.map(name => [name, categoryDefinition(name)])),
      },
    },
  };
}

const jevResponseSchema = z.object({
  model: z.string(),
  answers: z.object({
    [JEV_QUESTION_ID]: z.object({
      choice: z.string(),
      confidence: z.number(),
      probabilities: z.record(z.string(), z.number()),
    }),
  }),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).optional(),
});

function jevErrorMessage(status: number, body: string): string {
  switch (status) {
    case HTTP_UNAUTHORIZED:
      return 'Router (Jev) Authentication Error (401). Check your TypeSafe API key.';
    case HTTP_UNPROCESSABLE:
      return `Router (Jev) Invalid Request (422): ${body}`;
    case HTTP_TOO_MANY_REQUESTS:
      return 'Router (Jev) Rate Limited (429). Try again shortly.';
    case HTTP_OVERLOADED:
      return 'Router (Jev) Overloaded (529). Try again shortly.';
    default:
      return `Router (Jev) error (${status}): ${body || 'No error body'}`;
  }
}

function formatShare(probability: number): string {
  return `${Math.round(probability * PERCENT)}%`;
}

export type JevAnswer = z.infer<typeof jevResponseSchema>['answers'][typeof JEV_QUESTION_ID];

export interface JevResult {
  model: string;
  answer: JevAnswer;
  candidates: string[];
  usage?: { input_tokens: number; output_tokens: number };
}

/** Sends the routing question to Jev and returns its raw typed answer. */
export async function askJev(request: RouteRequest, context: RouteContext): Promise<JevResult> {
  const apiKey = context.router.jevKey || context.defaultJevKey;
  if (!apiKey) {
    throw new Error('Router (Jev) has no TypeSafe API key. Add one in Router settings or set TYPESAFE_API_KEY.');
  }
  const candidates = eligibleCategories(context.categories, request.hasAttachments);
  if (candidates.length === 0) {
    throw new Error('Router (Jev) has no categories with models assigned.');
  }

  const response = await fetchWithTimeout(JEV_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(buildJevRequest(request, candidates)),
  });
  if (!response.ok) {
    throw new Error(jevErrorMessage(response.status, await response.text()));
  }

  const parsed = jevResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error('Router (Jev) returned an unexpected response shape.');
  }
  const { model, answers, usage } = parsed.data;
  return { model, answer: answers[JEV_QUESTION_ID], candidates, usage };
}

/** Applies the confidence policy: an uncertain pick becomes FALLBACK_CATEGORY when that category is available. */
export function resolveJevCategory(answer: JevAnswer, candidates: string[], minConfidence = JEV_MIN_CONFIDENCE): string {
  const isUncertain = answer.confidence < minConfidence && candidates.includes(FALLBACK_CATEGORY);
  return isUncertain ? FALLBACK_CATEGORY : answer.choice;
}

export async function routeWithJev(request: RouteRequest, context: RouteContext): Promise<RouteDecision> {
  const { model, answer, candidates, usage } = await askJev(request, context);
  const category = resolveJevCategory(answer, candidates);

  const shares = Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, p]) => `${name} ${formatShare(p)}`)
    .join(', ');
  const summary = `${shares}; confidence ${formatShare(answer.confidence)}`;
  const reasoning = category === answer.choice
    ? `Jev picked ${answer.choice} (${summary}).`
    : `Jev was uncertain (${summary}), so ${FALLBACK_CATEGORY} was used.`;

  const categoryConfig = context.categories[category];
  return {
    category,
    model: categoryModelName(categoryConfig.models[0]),
    provider: categoryConfig.provider,
    reasoning,
    confidence: answer.confidence,
    routerModel: model,
    ...(usage && {
      usage: {
        prompt_tokens: usage.input_tokens,
        completion_tokens: usage.output_tokens,
        total_tokens: usage.input_tokens + usage.output_tokens,
      },
    }),
  };
}

// ─── LLM engine ───

export function buildLlmRouterPrompt(request: RouteRequest, categories: Record<string, RoutingCategory>): string {
  const configured = Object.entries(categories)
    .map(([name, cfg]) => `- ${name}: ${cfg.models.map(categoryModelName).join(', ')} (${cfg.provider})`)
    .join('\n');
  const definitions = Object.keys(categories)
    .map(name => `- ${name}: ${categoryDefinition(name)}`)
    .join('\n');

  return `Analyze this user prompt and decide which model category is best.
Prompt: "${request.prompt}"
Has Attachments: ${request.hasAttachments}

Available Models on User's System: ${request.availableModels.join(', ') || 'unknown'}

Category Definitions (use these to decide):
${definitions}

Configured Categories and Models:
${configured}

Rules:
${[...ROUTING_RULES, 'Only use categories that appear in the configured list above.'].map(r => `- ${r}`).join('\n')}

Return ONLY a JSON object with the following structure:
{
  "category": "ONE_OF_THE_CATEGORIES",
  "model": "specific_model_name",
  "provider": "local" | "cloud",
  "reasoning": "short explanation",
  "confidence": 0.0-1.0
}`;
}

/** Appends /v1/chat/completions unless the URL already ends with a chat completions path. */
export function chatCompletionsUrl(baseUrl: string): string {
  let url = baseUrl.replace(/\/$/, '');
  if (url.endsWith('/chat/completions')) return url;
  if (!url.endsWith('/v1')) url += '/v1';
  return `${url}/chat/completions`;
}

const llmDecisionSchema = z.object({
  category: z.string().transform(c => c.trim().toUpperCase()),
  model: z.string().optional().default(''),
  provider: z.enum(['local', 'cloud']).optional(),
  reasoning: z.string().optional().default(''),
  confidence: z.coerce.number().optional().default(0),
});

/** Parses the router model's reply. Tolerates markdown code fences around the JSON. */
export function parseLlmDecision(content: string): z.infer<typeof llmDecisionSchema> {
  const jsonText = content.replace(/```(?:json)?\n?|```/g, '').trim();
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    log.error({ content }, 'Router returned invalid JSON');
    throw new Error('Router model returned invalid JSON format. Ensure the model is capable of JSON output.');
  }
  const parsed = llmDecisionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('Router model returned JSON without a valid "category" field.');
  }
  return parsed.data;
}

function llmErrorMessage(status: number, statusText: string, body: string, model: string, url: string): string {
  switch (status) {
    case HTTP_NOT_FOUND:
      return `Router Model Not Found (404). Ensure the model ID "${model}" is correct and available at ${url}.`;
    case HTTP_BAD_REQUEST:
      return `Router Invalid Request (400). The model ID "${model}" might be incorrect; use the provider's full model ID. Details: ${body}`;
    case HTTP_UNAUTHORIZED:
    case HTTP_FORBIDDEN:
      return `Router Authentication Error (${status}). Check your API Key for the router.`;
    case HTTP_TOO_MANY_REQUESTS:
      return 'Router Quota Exceeded (429). Your provider quota has been reached. Consider a local router model to avoid costs and limits.';
    default:
      return `Router provider error (${status} ${statusText}): ${body || 'No error body'}`;
  }
}

export async function routeWithLlm(request: RouteRequest, context: RouteContext): Promise<RouteDecision> {
  const { router, categories, localProvider } = context;
  const url = chatCompletionsUrl(router.url || localProvider.url);
  const key = router.url ? router.key : (router.key || localProvider.key);

  log.info({ url, model: router.model }, 'Router routing request');
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({
      model: router.model,
      messages: [
        { role: 'system', content: 'You are a routing orchestrator. You must respond with valid JSON ONLY. Structure: {"category": "...", "model": "...", "provider": "...", "reasoning": "...", "confidence": 0.0-1.0}' },
        { role: 'user', content: buildLlmRouterPrompt(request, categories) },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(llmErrorMessage(response.status, response.statusText, await response.text(), router.model, url));
  }

  const data = await response.json();
  const decision = parseLlmDecision(data.choices?.[0]?.message?.content ?? '');
  const categoryConfig = categories[decision.category];
  return {
    category: decision.category,
    model: decision.model || categoryModelName(categoryConfig?.models[0]),
    provider: decision.provider ?? categoryConfig?.provider ?? 'local',
    reasoning: decision.reasoning,
    confidence: decision.confidence,
    routerModel: router.model,
    ...(data.usage && {
      usage: {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        total_tokens: data.usage.total_tokens,
      },
    }),
  };
}

// ─── Dispatcher ───

/** Routes with the configured engine. A failed Jev call falls back to the LLM router when one is set. */
export async function routeIntent(request: RouteRequest, context: RouteContext): Promise<RouteDecision> {
  if ((context.router.engine ?? DEFAULT_ROUTER_ENGINE) === 'llm') {
    return routeWithLlm(request, context);
  }
  try {
    return await routeWithJev(request, context);
  } catch (err: any) {
    if (!context.router.model) throw err;
    log.warn({ err }, 'Jev routing failed — falling back to LLM router');
    const decision = await routeWithLlm(request, context);
    return { ...decision, reasoning: `${decision.reasoning} (LLM fallback: ${err.message})` };
  }
}

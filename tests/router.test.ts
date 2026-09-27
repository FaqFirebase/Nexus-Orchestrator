import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  eligibleCategories,
  buildJevRequest,
  buildLlmRouterPrompt,
  chatCompletionsUrl,
  parseLlmDecision,
  routeWithJev,
  resolveJevCategory,
  routeIntent,
  JEV_API_URL,
  JEV_MODEL,
  JEV_MAX_PROMPT_CHARS,
  type RouteContext,
  type RouteRequest,
  type RoutingCategory,
} from '../router.js';

const JEV_KEY = 'ts-test-key';
const LOCAL_URL = 'http://ollama.test:11434';

function categories(): Record<string, RoutingCategory> {
  return {
    CODING: { models: [{ name: 'qwen-coder', providerUrl: LOCAL_URL }, { name: 'codellama', providerUrl: LOCAL_URL }], provider: 'local' },
    GENERAL: { models: ['llama3.1'], provider: 'local' },
    VISION: { models: ['llava'], provider: 'local' },
    DOCUMENT: { models: ['mistral'], provider: 'cloud' },
    CREATIVE: { models: [], provider: 'local' },
  };
}

function context(overrides: Partial<RouteContext['router']> = {}): RouteContext {
  return {
    router: { engine: 'jev', model: '', url: '', key: '', jevKey: JEV_KEY, ...overrides },
    categories: categories(),
    localProvider: { url: LOCAL_URL, key: '' },
    defaultJevKey: '',
  };
}

const request: RouteRequest = { prompt: 'fix my python loop', hasAttachments: false, availableModels: ['qwen-coder', 'llama3.1'] };

function jevResponse(choice: string, confidence: number, probabilities: Record<string, number>) {
  return new Response(JSON.stringify({
    model: 'jev-1.13.0',
    answers: { category: { type: 'choice', choice, confidence, probabilities } },
    usage: { input_tokens: 300, output_tokens: 0 },
  }), { status: 200 });
}

function llmResponse(content: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 },
  }), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('eligibleCategories', () => {
  it('drops categories without models and attachment-only categories when there are no attachments', () => {
    expect(eligibleCategories(categories(), false)).toEqual(['CODING', 'GENERAL']);
  });

  it('keeps attachment-only categories when attachments are present', () => {
    expect(eligibleCategories(categories(), true)).toEqual(['CODING', 'GENERAL', 'VISION', 'DOCUMENT']);
  });
});

describe('buildJevRequest', () => {
  it('asks one choice question whose options are the eligible categories', () => {
    const body = buildJevRequest(request, ['CODING', 'GENERAL', 'MUSIC']);
    expect(body.model).toBe(JEV_MODEL);
    expect(body.state).toEqual({ user_prompt: request.prompt, has_attachments: false });
    expect(body.questions.category.type).toBe('choice');
    expect(Object.keys(body.questions.category.criteria)).toEqual(['CODING', 'GENERAL', 'MUSIC']);
    expect(body.questions.category.criteria.MUSIC).toContain('custom "MUSIC"');
  });

  it('truncates very long prompts', () => {
    const body = buildJevRequest({ ...request, prompt: 'x'.repeat(JEV_MAX_PROMPT_CHARS * 2) }, ['GENERAL']);
    expect(body.state.user_prompt).toHaveLength(JEV_MAX_PROMPT_CHARS);
  });
});

describe('routeWithJev', () => {
  it('returns the top category, its first model, and mapped usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jevResponse('CODING', 0.9, { CODING: 0.93, GENERAL: 0.07 }));
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeWithJev(request, context());

    expect(fetchMock).toHaveBeenCalledWith(JEV_API_URL, expect.objectContaining({ method: 'POST' }));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${JEV_KEY}`);
    expect(decision).toMatchObject({
      category: 'CODING',
      model: 'qwen-coder',
      provider: 'local',
      confidence: 0.9,
      routerModel: 'jev-1.13.0',
      usage: { prompt_tokens: 300, completion_tokens: 0, total_tokens: 300 },
    });
    expect(decision.reasoning).toContain('CODING 93%');
  });

  it('falls back to GENERAL when confidence is low', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevResponse('CODING', 0.2, { CODING: 0.55, GENERAL: 0.45 })));
    const decision = await routeWithJev(request, context());
    expect(decision.category).toBe('GENERAL');
    expect(decision.model).toBe('llama3.1');
    expect(decision.reasoning).toContain('uncertain');
  });

  it('keeps a low-confidence pick when GENERAL has no models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jevResponse('CODING', 0.2, { CODING: 1 })));
    const ctx = context();
    ctx.categories.GENERAL.models = [];
    const decision = await routeWithJev(request, ctx);
    expect(decision.category).toBe('CODING');
  });

  it('uses the server-level key when the user has none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jevResponse('GENERAL', 0.9, { GENERAL: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await routeWithJev(request, { ...context({ jevKey: '' }), defaultJevKey: 'env-key' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer env-key');
  });

  it('rejects when no key is available', async () => {
    await expect(routeWithJev(request, context({ jevKey: '' }))).rejects.toThrow('no TypeSafe API key');
  });

  it('explains a 401 from TypeSafe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad key', { status: 401 })));
    await expect(routeWithJev(request, context())).rejects.toThrow('Check your TypeSafe API key');
  });

  it('rejects an unexpected response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"answers":{}}', { status: 200 })));
    await expect(routeWithJev(request, context())).rejects.toThrow('unexpected response shape');
  });
});

describe('resolveJevCategory', () => {
  const answer = { choice: 'CODING', confidence: 0.4, probabilities: { CODING: 0.6, GENERAL: 0.4 } };

  it('respects a custom confidence limit', () => {
    expect(resolveJevCategory(answer, ['CODING', 'GENERAL'], 0.3)).toBe('CODING');
    expect(resolveJevCategory(answer, ['CODING', 'GENERAL'], 0.5)).toBe('GENERAL');
  });
});

describe('routeIntent', () => {
  it('uses the LLM router when the engine is llm', async () => {
    const fetchMock = vi.fn().mockResolvedValue(llmResponse('{"category":"coding","model":"qwen-coder","reasoning":"code","confidence":0.8}'));
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeIntent(request, context({ engine: 'llm', model: 'gemma3:4b' }));

    expect(fetchMock.mock.calls[0][0]).toBe(`${LOCAL_URL}/v1/chat/completions`);
    expect(decision).toMatchObject({ category: 'CODING', model: 'qwen-coder', provider: 'local', routerModel: 'gemma3:4b' });
  });

  it('falls back to the LLM router when Jev fails and a router model is set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('overloaded', { status: 529 }))
      .mockResolvedValueOnce(llmResponse('{"category":"GENERAL","reasoning":"chat"}'));
    vi.stubGlobal('fetch', fetchMock);

    const decision = await routeIntent(request, context({ model: 'gemma3:4b' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decision.category).toBe('GENERAL');
    expect(decision.model).toBe('llama3.1');
    expect(decision.reasoning).toContain('LLM fallback');
  });

  it('surfaces the Jev error when no fallback router model is set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('slow down', { status: 429 })));
    await expect(routeIntent(request, context())).rejects.toThrow('Rate Limited');
  });
});

describe('LLM router helpers', () => {
  it('builds chat completions URLs', () => {
    expect(chatCompletionsUrl('http://host:11434/')).toBe('http://host:11434/v1/chat/completions');
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(chatCompletionsUrl('http://host/v1/chat/completions')).toBe('http://host/v1/chat/completions');
  });

  it('parses JSON wrapped in markdown fences', () => {
    expect(parseLlmDecision('```json\n{"category":"security","confidence":"0.7"}\n```')).toMatchObject({
      category: 'SECURITY',
      confidence: 0.7,
    });
  });

  it('rejects replies that are not JSON', () => {
    expect(() => parseLlmDecision('I think CODING')).toThrow('invalid JSON');
  });

  it('rejects JSON without a category', () => {
    expect(() => parseLlmDecision('{"model":"x"}')).toThrow('valid "category"');
  });

  it('puts definitions, configured models, and rules in the prompt', () => {
    const prompt = buildLlmRouterPrompt(request, categories());
    expect(prompt).toContain('Prompt: "fix my python loop"');
    expect(prompt).toContain('- CODING: qwen-coder, codellama (local)');
    expect(prompt).toContain('Available Models on User\'s System: qwen-coder, llama3.1');
    expect(prompt).toContain('Prefer CODING over GENERAL');
  });
});

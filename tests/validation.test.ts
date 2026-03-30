import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  configSchema,
  routerSchema,
  chatSchema,
  createConversationSchema,
  updateConversationSchema,
} from '../validation.js';

describe('loginSchema', () => {
  it('accepts valid credentials', () => {
    expect(loginSchema.safeParse({ username: 'admin', password: 'my-secret' }).success).toBe(true);
  });

  it('rejects empty username', () => {
    expect(loginSchema.safeParse({ username: '', password: 'secret' }).success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(loginSchema.safeParse({}).success).toBe(false);
  });
});

describe('configSchema', () => {
  it('accepts valid config', () => {
    const result = configSchema.safeParse({
      localUrl: 'http://localhost:11434',
      localKey: '',
      cloudUrl: '',
      cloudKey: '',
      router: { provider: 'openai', model: 'gpt-4', url: '', key: '' },
      categories: {
        CODING: { models: ['model-a'], provider: 'local' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty config with defaults', () => {
    expect(configSchema.safeParse({}).success).toBe(true);
  });

  it('rejects invalid provider in category', () => {
    const result = configSchema.safeParse({
      categories: { CODING: { models: [], provider: 'invalid' } },
    });
    expect(result.success).toBe(false);
  });
});

describe('routerSchema', () => {
  it('accepts valid prompt', () => {
    expect(routerSchema.safeParse({ prompt: 'hello' }).success).toBe(true);
  });

  it('rejects empty prompt', () => {
    expect(routerSchema.safeParse({ prompt: '' }).success).toBe(false);
  });

  it('rejects missing prompt', () => {
    expect(routerSchema.safeParse({}).success).toBe(false);
  });
});

describe('chatSchema', () => {
  const validDecision = {
    category: 'GENERAL',
    model: 'llama3',
    provider: 'local' as const,
  };

  it('accepts valid chat request', () => {
    const result = chatSchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
      decision: validDecision,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty messages array', () => {
    const result = chatSchema.safeParse({
      messages: [],
      decision: validDecision,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing decision', () => {
    const result = chatSchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role', () => {
    const result = chatSchema.safeParse({
      messages: [{ role: 'admin', content: 'hello' }],
      decision: validDecision,
    });
    expect(result.success).toBe(false);
  });

  it('accepts multimodal content array', () => {
    const result = chatSchema.safeParse({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      decision: validDecision,
    });
    expect(result.success).toBe(true);
  });

  it('accepts fallbackModels in decision', () => {
    const result = chatSchema.safeParse({
      messages: [{ role: 'user', content: 'hello' }],
      decision: { ...validDecision, fallbackModels: ['model-b', 'model-c'] },
    });
    expect(result.success).toBe(true);
  });
});

describe('createConversationSchema', () => {
  it('accepts title and messages', () => {
    expect(
      createConversationSchema.safeParse({ title: 'Test', messages: [] }).success
    ).toBe(true);
  });

  it('accepts empty body', () => {
    expect(createConversationSchema.safeParse({}).success).toBe(true);
  });
});

describe('updateConversationSchema', () => {
  it('accepts partial update', () => {
    expect(
      updateConversationSchema.safeParse({ title: 'New Title' }).success
    ).toBe(true);
  });
});

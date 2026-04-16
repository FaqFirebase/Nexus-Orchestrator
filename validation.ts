import { z } from 'zod';

// Auth
export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, hyphens, and underscores'),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const adminCreateUserSchema = z.object({
  username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  password: passwordSchema,
  role: z.enum(['admin', 'user']).optional().default('user'),
});

export const adminResetPasswordSchema = z.object({
  password: passwordSchema,
});

// Config
const localProviderSchema = z.object({
  name: z.string().optional().default('Local'),
  url: z.string().optional().default(''),
  key: z.string().optional().default(''),
});

// Accept both legacy string format and new CategoryModel object format to handle
// stale browser sessions that may still send the old format before a page reload.
const categoryModelSchema = z.union([
  z.string(),
  z.object({ name: z.string(), providerUrl: z.string().optional().default('') }),
]);

const categorySchema = z.object({
  models: z.array(categoryModelSchema),
  provider: z.enum(['local', 'cloud']),
});

export const configSchema = z.object({
  localProviders: z.array(localProviderSchema).optional(),
  // Legacy fields kept for backward-compat migration — overridden by localProviders on read
  localUrl: z.string().optional().default(''),
  localKey: z.string().optional().default(''),
  cloudUrl: z.string().optional().default(''),
  cloudKey: z.string().optional().default(''),
  router: z.object({
    provider: z.literal('openai'),
    model: z.string().optional().default(''),
    url: z.string().optional().default(''),
    key: z.string().optional().default(''),
  }).optional(),
  categories: z.record(z.string(), categorySchema).optional(),
  routerCacheEnabled: z.boolean().optional(),
  showThinking: z.boolean().optional(),
  searxng: z.object({
    url: z.string().optional().default(''),
    alwaysOn: z.boolean().optional().default(false),
  }).optional(),
});

// Router
export const routerSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
});

// Chat
const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.union([z.string(), z.array(z.any())]),
});

const decisionSchema = z.object({
  category: z.string(),
  model: z.string(),
  providerUrl: z.string().optional(),
  fallbackModels: z.array(z.string()).optional(),
  fallbackProviderUrls: z.array(z.string()).optional(),
  provider: z.enum(['local', 'cloud', 'gemini']),
  reasoning: z.string().optional(),
  confidence: z.number().optional(),
  routerModel: z.string().optional(),
});

export const chatSchema = z.object({
  messages: z.array(messageSchema).min(1, 'At least one message is required'),
  decision: decisionSchema,
  webSearchEnabled: z.boolean().optional().default(false),
  showThinkingEnabled: z.boolean().optional().default(false),
});

// Conversations
export const createConversationSchema = z.object({
  title: z.string().optional(),
  messages: z.array(z.any()).optional(),
});

export const updateConversationSchema = z.object({
  title: z.string().optional(),
  messages: z.array(z.any()).optional(),
});

// Projects
export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  collapsed: z.boolean().optional(),
});

export const assignConversationSchema = z.object({
  projectId: z.string().nullable(),
});

// Admin settings
export const adminSettingsSchema = z.object({
  registrationEnabled: z.boolean().optional(),
}).strict();

// Middleware helper
import type { Request, Response, NextFunction } from 'express';

export function validate(schema: z.ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return res.status(400).json({ error: `Validation failed: ${errors}` });
    }
    req.body = result.data;
    next();
  };
}

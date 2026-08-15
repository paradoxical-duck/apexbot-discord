import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_TEST_GUILD_ID: z.string().optional(),
  DISCORD_REDIRECT_URI: z.string().url().default('http://localhost:8080/api/auth/discord/callback'),
  DASHBOARD_URL: z.string().url().default('http://localhost:5173'),
  API_BASE_URL: z.string().url().default('http://localhost:8080'),
  OAUTH_BRIDGE_TARGET: z.string().url().optional(),
  COOKIE_SECRET: z.string().min(16).default('development-only-change-me-now'),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  AI_PROVIDER: z.enum(['gemini', 'nvidia', 'disabled']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-flash-latest'),
  NVIDIA_API_KEY: z.string().optional(),
  NVIDIA_MODEL: z.string().default('openai/gpt-oss-120b'),
  NVIDIA_BASE_URL: z.string().url().default('https://integrate.api.nvidia.com/v1'),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
export const hasDiscordCredentials = Boolean(env.DISCORD_TOKEN && env.DISCORD_CLIENT_ID);
export const hasAiCredentials =
  (env.AI_PROVIDER === 'gemini' && Boolean(env.GEMINI_API_KEY)) ||
  (env.AI_PROVIDER === 'nvidia' && Boolean(env.NVIDIA_API_KEY));

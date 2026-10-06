import { z } from 'zod';

export const PUBLIC_ENV_KEYS = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SEP10_AUTH_PATH',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
  'NEXT_PUBLIC_NETWORK',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID',
] as const;

export type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number];
export type PublicEnvInput = Partial<Record<PublicEnvKey, string | undefined>>;

const defaults = {
  NEXT_PUBLIC_API_URL: 'http://localhost:4000',
  NEXT_PUBLIC_SEP10_AUTH_PATH: '/auth/sep10',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  NEXT_PUBLIC_NETWORK: 'testnet',
  NEXT_PUBLIC_SENTRY_DSN: '',
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: '',
} as const;

const schema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default(defaults.NEXT_PUBLIC_API_URL),
  NEXT_PUBLIC_SEP10_AUTH_PATH: z
    .string()
    .refine((value) => value.startsWith('/'), 'must start with "/"')
    .default(defaults.NEXT_PUBLIC_SEP10_AUTH_PATH),
  NEXT_PUBLIC_SOROBAN_RPC_URL: z
    .string()
    .url()
    .default(defaults.NEXT_PUBLIC_SOROBAN_RPC_URL),
  NEXT_PUBLIC_NETWORK: z
    .enum(['testnet', 'futurenet', 'mainnet'])
    .default(defaults.NEXT_PUBLIC_NETWORK),
  NEXT_PUBLIC_SENTRY_DSN: z
    .union([z.literal(''), z.string().url()])
    .default(defaults.NEXT_PUBLIC_SENTRY_DSN),
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: z
    .string()
    .default(defaults.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID),
});

const REQUIRED_KEYS = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
  'NEXT_PUBLIC_NETWORK',
] as const satisfies readonly PublicEnvKey[];

export type PublicEnv = z.infer<typeof schema>;

export function validatePublicEnv(
  input: PublicEnvInput,
  options: { requireConfigured?: boolean } = {},
): PublicEnv {
  if (options.requireConfigured) {
    const missing = REQUIRED_KEYS.filter((key) => !input[key]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `[env] Missing required public environment variables: ${missing.join(', ')}`,
      );
    }
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n');
    throw new Error(`[env] Invalid public environment variables:\n${details}`);
  }

  return parsed.data;
}

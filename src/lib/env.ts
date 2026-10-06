import { z } from 'zod';

export const PUBLIC_ENV_KEYS = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SEP10_AUTH_PATH',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
  'NEXT_PUBLIC_SOROBAN_NETWORK',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID',
] as const;

export const REQUIRED_PUBLIC_ENV_KEYS = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
  'NEXT_PUBLIC_SOROBAN_NETWORK',
] as const;

export type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number];
export type PublicEnvSource = Partial<Record<PublicEnvKey, string | undefined>>;

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().trim().url(),
  NEXT_PUBLIC_SEP10_AUTH_PATH: z.string().trim().startsWith('/').default('/auth/sep10'),
  NEXT_PUBLIC_SOROBAN_RPC_URL: z.string().trim().url(),
  NEXT_PUBLIC_SOROBAN_NETWORK: z.enum(['testnet', 'futurenet', 'mainnet']),
  NEXT_PUBLIC_SENTRY_DSN: z.union([z.string().trim().url(), z.literal('')]).default(''),
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: z.string().trim().default(''),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

const DEFAULT_PUBLIC_ENV: PublicEnv = {
  NEXT_PUBLIC_API_URL: 'http://localhost:4000',
  NEXT_PUBLIC_SEP10_AUTH_PATH: '/auth/sep10',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  NEXT_PUBLIC_SOROBAN_NETWORK: 'testnet',
  NEXT_PUBLIC_SENTRY_DSN: '',
  NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: '',
};

function selectPublicEnv(source: PublicEnvSource): PublicEnvSource {
  return {
    NEXT_PUBLIC_API_URL: source.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SEP10_AUTH_PATH: source.NEXT_PUBLIC_SEP10_AUTH_PATH,
    NEXT_PUBLIC_SOROBAN_RPC_URL: source.NEXT_PUBLIC_SOROBAN_RPC_URL,
    NEXT_PUBLIC_SOROBAN_NETWORK: source.NEXT_PUBLIC_SOROBAN_NETWORK,
    NEXT_PUBLIC_SENTRY_DSN: source.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: source.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
  };
}

function parsePublicEnv(source: PublicEnvSource): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (result.success) return result.data;

  const missing = REQUIRED_PUBLIC_ENV_KEYS.filter((key) => !source[key]?.trim());
  const invalid = Array.from(
    new Set(
      result.error.issues
        .map((issue) => issue.path[0])
        .filter(
          (key): key is PublicEnvKey =>
            typeof key === 'string' && PUBLIC_ENV_KEYS.includes(key as PublicEnvKey),
        ),
    ),
  ).filter(
    (key) => !missing.includes(key as (typeof REQUIRED_PUBLIC_ENV_KEYS)[number]),
  );

  const details: string[] = [];
  if (missing.length > 0) {
    details.push(`Missing required public environment variables: ${missing.join(', ')}`);
  }
  if (invalid.length > 0) {
    details.push(`Invalid public environment variables: ${invalid.join(', ')}`);
  }

  throw new Error(`[env] ${details.join('; ')}`);
}

/**
 * Strict build/deployment validation. Required variables must be provided.
 * next.config.ts invokes this before Next.js compilation starts.
 */
export function validatePublicEnv(source: PublicEnvSource = process.env): PublicEnv {
  return parsePublicEnv(selectPublicEnv(source));
}

/**
 * Typed application access. Defaults preserve local/test ergonomics; production
 * builds still pass through validatePublicEnv() first and therefore cannot
 * silently ship with a missing required variable.
 */
export function getPublicEnv(source: PublicEnvSource = process.env): PublicEnv {
  const selected = selectPublicEnv(source);
  return parsePublicEnv({
    NEXT_PUBLIC_API_URL:
      selected.NEXT_PUBLIC_API_URL ?? DEFAULT_PUBLIC_ENV.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SEP10_AUTH_PATH:
      selected.NEXT_PUBLIC_SEP10_AUTH_PATH ?? DEFAULT_PUBLIC_ENV.NEXT_PUBLIC_SEP10_AUTH_PATH,
    NEXT_PUBLIC_SOROBAN_RPC_URL:
      selected.NEXT_PUBLIC_SOROBAN_RPC_URL ?? DEFAULT_PUBLIC_ENV.NEXT_PUBLIC_SOROBAN_RPC_URL,
    NEXT_PUBLIC_SOROBAN_NETWORK:
      selected.NEXT_PUBLIC_SOROBAN_NETWORK ?? DEFAULT_PUBLIC_ENV.NEXT_PUBLIC_SOROBAN_NETWORK,
    NEXT_PUBLIC_SENTRY_DSN:
      selected.NEXT_PUBLIC_SENTRY_DSN ?? DEFAULT_PUBLIC_ENV.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID:
      selected.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID ??
      DEFAULT_PUBLIC_ENV.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID,
  });
}

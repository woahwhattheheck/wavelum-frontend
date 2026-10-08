import { describe, expect, it } from 'vitest';

import { getPublicEnv, validatePublicEnv } from './env';

const validRequiredEnv = {
  NEXT_PUBLIC_API_URL: 'https://api.example.test',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://rpc.example.test',
  NEXT_PUBLIC_SOROBAN_NETWORK: 'testnet',
} as const;

describe('validatePublicEnv', () => {
  it('accepts the minimal required environment and applies optional defaults', () => {
    expect(validatePublicEnv(validRequiredEnv)).toEqual({
      ...validRequiredEnv,
      NEXT_PUBLIC_SEP10_AUTH_PATH: '/auth/sep10',
      NEXT_PUBLIC_SENTRY_DSN: '',
      NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID: '',
    });
  });

  it('lists every missing required variable in one failure', () => {
    expect(() => validatePublicEnv({})).toThrowError(
      '[env] Missing required public environment variables: NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SOROBAN_RPC_URL, NEXT_PUBLIC_SOROBAN_NETWORK',
    );
  });

  it('rejects unsafe schemes and credentials in browser-visible service endpoints', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///tmp/wallet',
      'ftp://backend.example.test',
      'https://user:secret@api.example.test',
    ]) {
      expect(() =>
        validatePublicEnv({ ...validRequiredEnv, NEXT_PUBLIC_API_URL: url }),
      ).toThrowError(/NEXT_PUBLIC_API_URL/);
    }

    expect(() =>
      validatePublicEnv({
        ...validRequiredEnv,
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://user:pass@rpc.example.test',
      }),
    ).toThrowError(/NEXT_PUBLIC_SOROBAN_RPC_URL/);

    expect(() =>
      validatePublicEnv({
        ...validRequiredEnv,
        NEXT_PUBLIC_SENTRY_DSN: 'file:///tmp/sentry',
      }),
    ).toThrowError(/NEXT_PUBLIC_SENTRY_DSN/);

    expect(validatePublicEnv({
      ...validRequiredEnv,
      NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://rpc.example.test',
    }).NEXT_PUBLIC_API_URL).toBe('http://localhost:4000');
  });

  it('rejects invalid values and keeps local/test defaults typed', () => {
    expect(() =>
      validatePublicEnv({
        ...validRequiredEnv,
        NEXT_PUBLIC_SOROBAN_NETWORK: 'devnet',
      }),
    ).toThrowError(
      '[env] Invalid public environment variables: NEXT_PUBLIC_SOROBAN_NETWORK',
    );

    expect(getPublicEnv({})).toMatchObject({
      NEXT_PUBLIC_API_URL: 'http://localhost:4000',
      NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      NEXT_PUBLIC_SOROBAN_NETWORK: 'testnet',
    });
  });
});

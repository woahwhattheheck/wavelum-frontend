import fs from 'node:fs';

const EXPECTED_PUBLIC_ENV = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_SEP10_AUTH_PATH',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
  'NEXT_PUBLIC_NETWORK',
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID',
];

const lines = fs.readFileSync('.env.example', 'utf8').split(/\r?\n/);
const found = [];

for (let index = 0; index < lines.length; index += 1) {
  const match = lines[index].match(/^(NEXT_PUBLIC_[A-Z0-9_]+)=/);
  if (!match) continue;

  const key = match[1];
  found.push(key);

  const previous = lines[index - 1]?.trim() ?? '';
  if (!previous.startsWith('# Type: ')) {
    throw new Error(
      `${key} must have an immediately preceding "# Type:" annotation in .env.example`,
    );
  }
}

const missing = EXPECTED_PUBLIC_ENV.filter((key) => !found.includes(key));
const undocumented = found.filter((key) => !EXPECTED_PUBLIC_ENV.includes(key));

if (missing.length || undocumented.length) {
  throw new Error(
    [
      missing.length ? `Missing documented variables: ${missing.join(', ')}` : '',
      undocumented.length ? `Undeclared public variables: ${undocumented.join(', ')}` : '',
    ].filter(Boolean).join('\n'),
  );
}

console.log(`Validated ${found.length} documented NEXT_PUBLIC_* variables.`);

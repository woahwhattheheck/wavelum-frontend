#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const messagesDir = path.join(root, 'messages');
const sourceRoots = ['app', 'src', 'i18n'];
const referenceLocale = 'en';
const minimumCoverage = 0.9;

function flattenMessages(value, prefix = '', output = new Map()) {
  if (typeof value === 'string') {
    output.set(prefix, value);
    return output;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    output.set(prefix, value);
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    flattenMessages(child, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function listCodeFiles(directory, output = []) {
  if (!fs.existsSync(directory)) return output;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      listCodeFiles(fullPath, output);
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) {
      output.push(fullPath);
    }
  }
  return output;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

const localeFiles = fs
  .readdirSync(messagesDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

if (!localeFiles.includes(`${referenceLocale}.json`)) {
  console.error(`Missing reference locale: ${referenceLocale}.json`);
  process.exit(1);
}

const catalogs = new Map();
let failed = false;

for (const file of localeFiles) {
  const locale = path.basename(file, '.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(messagesDir, file), 'utf8'));
    catalogs.set(locale, flattenMessages(parsed));
  } catch (error) {
    console.error(`[${locale}] invalid JSON: ${error.message}`);
    failed = true;
  }
}

const reference = catalogs.get(referenceLocale);
if (!reference) process.exit(1);
const referenceKeys = [...reference.keys()].sort();
const referenceKeySet = new Set(referenceKeys);

for (const [locale, catalog] of catalogs) {
  const keys = new Set(catalog.keys());
  const missing = referenceKeys.filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !referenceKeySet.has(key)).sort();
  const invalid = referenceKeys.filter((key) => {
    if (!catalog.has(key)) return false;
    const value = catalog.get(key);
    return typeof value !== 'string' || value.trim().length === 0;
  });
  const translated = referenceKeys.length - missing.length - invalid.length;
  const coverage = referenceKeys.length === 0 ? 1 : translated / referenceKeys.length;

  console.log(
    `[${locale}] ${translated}/${referenceKeys.length} translated (${(
      coverage * 100
    ).toFixed(1)}%)`,
  );

  if (missing.length > 0) {
    console.error(`[${locale}] missing keys: ${missing.join(', ')}`);
    failed = true;
  }
  if (extra.length > 0) {
    console.error(`[${locale}] extra keys: ${extra.join(', ')}`);
    failed = true;
  }
  if (invalid.length > 0) {
    console.error(`[${locale}] empty/non-string values: ${invalid.join(', ')}`);
    failed = true;
  }
  if (coverage < minimumCoverage) {
    console.error(
      `[${locale}] coverage ${(coverage * 100).toFixed(1)}% is below ${(
        minimumCoverage * 100
      ).toFixed(0)}%`,
    );
    failed = true;
  }
}

const usedKeys = new Set();
const dynamicNamespaces = new Set();
const codeFiles = sourceRoots.flatMap((directory) =>
  listCodeFiles(path.join(root, directory)),
);

for (const file of codeFiles) {
  const source = fs.readFileSync(file, 'utf8');

  for (const key of referenceKeys) {
    if (
      source.includes(`'${key}'`) ||
      source.includes(`"${key}"`) ||
      source.includes(`\`${key}\``)
    ) {
      usedKeys.add(key);
    }
  }

  const bindings = [];
  const hookPattern =
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*useTranslations\(\s*(?:['"]([^'"]+)['"])?\s*\)/g;
  const serverStringPattern =
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?getTranslations\(\s*['"]([^'"]+)['"]\s*\)/g;
  const serverObjectPattern =
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?getTranslations\(\s*\{[\s\S]*?namespace\s*:\s*['"]([^'"]+)['"][\s\S]*?\}\s*\)/g;

  for (const pattern of [hookPattern, serverStringPattern, serverObjectPattern]) {
    for (const match of source.matchAll(pattern)) {
      bindings.push({ name: match[1], namespace: match[2] ?? '' });
    }
  }

  for (const { name, namespace } of bindings) {
    const literalCall = new RegExp(
      `\\b${escapeRegExp(name)}(?:\\.(?:rich|raw|markup|has))?\\(\\s*['"]([^'"]+)['"]`,
      'g',
    );
    for (const match of source.matchAll(literalCall)) {
      usedKeys.add(namespace ? `${namespace}.${match[1]}` : match[1]);
    }

    const anyCall = new RegExp(
      `\\b${escapeRegExp(name)}(?:\\.(?:rich|raw|markup|has))?\\(\\s*([^'"])`,
      'g',
    );
    if ([...source.matchAll(anyCall)].length > 0) {
      dynamicNamespaces.add(namespace);
    }
  }
}

const unused = referenceKeys.filter((key) => {
  const namespace = key.includes('.') ? key.slice(0, key.indexOf('.')) : '';
  return !usedKeys.has(key) && !dynamicNamespaces.has(namespace);
});

if (unused.length > 0) {
  console.warn(
    `Unused translation keys (warning only, static scan):\n  ${unused.join('\n  ')}`,
  );
} else {
  console.log('No statically unused translation keys detected.');
}

if (dynamicNamespaces.size > 0) {
  console.warn(
    `Skipped unused-key warnings for dynamic namespace(s): ${[
      ...dynamicNamespaces,
    ]
      .map((namespace) => namespace || '<root>')
      .join(', ')}`,
  );
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(
    `i18n check passed for ${catalogs.size} locales and ${referenceKeys.length} keys.`,
  );
}

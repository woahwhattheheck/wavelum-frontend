#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const messagesDir = path.join(root, 'messages');
const sourceRoots = ['app', 'src', 'i18n'].map((name) => path.join(root, name));
const referenceLocale = 'en';
const minimumCoverage = 0.9;
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function flattenMessages(value, prefix = '', output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? prefix + '.' + key : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenMessages(child, fullKey, output);
    } else {
      output.set(fullKey, child);
    }
  }
  return output;
}

function readLocale(file) {
  const locale = path.basename(file, '.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { locale, messages: flattenMessages(parsed) };
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectUsedKeys(referenceKeys) {
  const sourceFiles = sourceRoots.flatMap((directory) => walk(directory));
  const used = new Set();

  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');

    // Mark explicit fully-qualified key literals.
    for (const key of referenceKeys) {
      if (
        source.includes("'" + key + "'") ||
        source.includes('"' + key + '"') ||
        source.includes('`' + key + '`')
      ) {
        used.add(key);
      }
    }

    // Track common next-intl patterns:
    //   const t = useTranslations('Namespace')
    //   const t = await getTranslations('Namespace')
    const translators = new Map();
    const translatorPattern =
      /const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(['"])([^'"]+)\2\s*\)/g;

    for (const match of source.matchAll(translatorPattern)) {
      translators.set(match[1], match[3]);
    }

    for (const [variable, namespace] of translators) {
      const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const callPattern = new RegExp(
        '\\b' +
          escaped +
          '(?:\\.(?:rich|raw|markup|has))?\\(\\s*([\'"])([^\'"]+)\\1',
        'g',
      );
      for (const match of source.matchAll(callPattern)) {
        used.add(namespace + '.' + match[2]);
      }
    }
  }

  return used;
}

const localeFiles = fs
  .readdirSync(messagesDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => path.join(messagesDir, name));

if (localeFiles.length === 0) {
  console.error('No locale JSON files found in messages/.');
  process.exit(1);
}

const locales = localeFiles.map(readLocale);
const reference = locales.find(({ locale }) => locale === referenceLocale);
if (!reference) {
  console.error('Reference locale messages/' + referenceLocale + '.json is missing.');
  process.exit(1);
}

const referenceKeys = [...reference.messages.keys()].sort();
const referenceKeySet = new Set(referenceKeys);
let failed = false;

for (const { locale, messages } of locales) {
  const keys = new Set(messages.keys());
  const missing = referenceKeys.filter((key) => !keys.has(key));
  const extra = [...keys].filter((key) => !referenceKeySet.has(key)).sort();

  if (missing.length || extra.length) {
    failed = true;
    for (const key of missing) console.error('[' + locale + '] missing key: ' + key);
    for (const key of extra) console.error('[' + locale + '] extra key: ' + key);
  }

  const translated = referenceKeys.filter((key) => {
    const value = messages.get(key);
    return typeof value === 'string' && value.trim().length > 0;
  }).length;
  const coverage = referenceKeys.length === 0 ? 1 : translated / referenceKeys.length;
  console.log(
    '[' + locale + '] keys=' + messages.size + ' coverage=' + (coverage * 100).toFixed(1) + '%',
  );

  if (coverage < minimumCoverage) {
    failed = true;
    console.error(
      '[' +
        locale +
        '] translation coverage ' +
        (coverage * 100).toFixed(1) +
        '% is below ' +
        minimumCoverage * 100 +
        '%.',
    );
  }
}

const usedKeys = collectUsedKeys(referenceKeys);
const unusedKeys = referenceKeys.filter((key) => !usedKeys.has(key));
for (const key of unusedKeys) {
  console.warn('::warning::Unused translation key: ' + key);
}
console.log(
  'Translation usage: ' +
    (referenceKeys.length - unusedKeys.length) +
    '/' +
    referenceKeys.length +
    ' reference keys detected in source; ' +
    unusedKeys.length +
    ' warning(s).',
);

if (failed) {
  process.exit(1);
}

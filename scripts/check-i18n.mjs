import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const messagesDir = path.join(root, 'messages');
const scanDirs = ['app', 'src'];
const referenceLocale = 'en';
const MIN_COVERAGE = Number.parseFloat(process.env.I18N_MIN_COVERAGE ?? '90');

const TRANSLATOR_BINDING_PATTERN =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(([^)]*)\)/g;
const TRANSLATOR_CALL_PATTERN = (name) =>
  new RegExp(`\\b${name}(?:\\s*\\.\\s*(?:rich|markup|raw))?\\s*\\(\\s*['"]([^'"]+)['"]`, 'g');

function flattenMessages(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenMessages(value, fullKey, out);
    } else {
      out.set(fullKey, value);
    }
  }
  return out;
}

async function loadLocales() {
  const entries = await fs.readdir(messagesDir);
  const locales = new Map();
  for (const file of entries.filter((f) => f.endsWith('.json')).sort()) {
    const locale = path.basename(file, '.json');
    const raw = await fs.readFile(path.join(messagesDir, file), 'utf8');
    locales.set(locale, flattenMessages(JSON.parse(raw), '', new Map()));
  }
  return locales;
}

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function collectUsedKeys(content) {
  const used = new Set();
  const bindings = new Map();
  for (const match of content.matchAll(TRANSLATOR_BINDING_PATTERN)) {
    const args = match[2] ?? '';
    const nsArg = args.match(/['"]([^'"]+)['"]/);
    const nsProp = args.match(/namespace\s*:\s*['"]([^'"]+)['"]/);
    bindings.set(match[1], (nsProp ?? nsArg)?.[1] ?? '');
  }
  for (const [name, namespace] of bindings) {
    for (const call of content.matchAll(TRANSLATOR_CALL_PATTERN(name))) {
      used.add(namespace ? `${namespace}.${call[1]}` : call[1]);
    }
  }
  return used;
}

async function main() {
  const locales = await loadLocales();
  if (!locales.has(referenceLocale)) {
    console.error(`Reference locale messages/${referenceLocale}.json not found.`);
    process.exit(1);
  }

  const failures = [];
  const warnings = [];

  const allKeys = new Set();
  for (const flat of locales.values()) for (const key of flat.keys()) allKeys.add(key);

  console.log(`Locales: ${[...locales.keys()].join(', ')} (${allKeys.size} distinct keys)`);

  for (const [locale, flat] of locales) {
    const missing = [...allKeys].filter((k) => !flat.has(k)).sort();
    if (missing.length > 0) {
      failures.push(`${locale}: ${missing.length} missing key(s): ${missing.join(', ')}`);
    }
  }

  const reference = locales.get(referenceLocale);
  for (const [locale, flat] of locales) {
    if (locale === referenceLocale) continue;
    let untranslated = 0;
    for (const [key, refValue] of reference) {
      if (!flat.has(key)) continue;
      const value = flat.get(key);
      if (String(value).trim() === '' || value === refValue) untranslated += 1;
    }
    const coverage = ((flat.size - untranslated) / flat.size) * 100;
    console.log(`${locale}: ${flat.size} keys, ${untranslated} untranslated, coverage ${coverage.toFixed(1)}%`);
    if (coverage < MIN_COVERAGE) {
      failures.push(`${locale}: translation coverage ${coverage.toFixed(1)}% is below ${MIN_COVERAGE}%`);
    }
  }

  const sourceFiles = (await Promise.all(scanDirs.map((d) => walk(path.join(root, d))))).flat();
  const usedKeys = new Set();
  for (const file of sourceFiles) {
    for (const key of collectUsedKeys(await fs.readFile(file, 'utf8'))) usedKeys.add(key);
  }
  const unused = [...allKeys].filter((k) => !usedKeys.has(k)).sort();
  if (unused.length > 0) {
    warnings.push(`${unused.length} unused key(s) (not referenced by useTranslations/getTranslations call sites): ${unused.join(', ')}`);
  }

  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`error: ${failure}`);
    console.error(`\ni18n check failed: ${failures.length} error(s), ${warnings.length} warning(s).`);
    process.exit(1);
  }
  console.log(`i18n check passed: ${locales.size} locales in parity, ${warnings.length} unused-key warning(s).`);
}

main().catch((err) => {
  console.error('i18n check failed:', err);
  process.exit(1);
});

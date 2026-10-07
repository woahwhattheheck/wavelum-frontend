#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const label = "[i18n:check]";
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const report = (message) => problems.push(message);

function parseSource(file, text, kind = ts.ScriptKind.TS) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );

  if (source.parseDiagnostics.length > 0) {
    const details = source.parseDiagnostics.map((diagnostic) => {
      const position = source.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0,
      );
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      );
      return `${relative(file)}:${position.line + 1}:${position.character + 1}: ${message}`;
    });
    throw new Error(`Source could not be parsed:\n${details.join("\n")}`);
  }

  return source;
}

function unwrap(expression) {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function staticString(expression, description) {
  const value = unwrap(expression);
  if (
    !ts.isStringLiteral(value) &&
    !ts.isNoSubstitutionTemplateLiteral(value)
  ) {
    throw new Error(`${description} must be a static string literal.`);
  }
  return value.text;
}

async function readRouting() {
  const file = path.join(root, "i18n", "routing.ts");
  const source = parseSource(file, await fs.readFile(file, "utf8"));
  const declarations = [];

  for (const statement of source.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === "routing"
        ) {
          declarations.push(declaration);
        }
      }
    }
  }

  if (declarations.length !== 1 || !declarations[0].initializer) {
    throw new Error(
      "i18n/routing.ts must contain one directly exported routing variable.",
    );
  }

  const call = unwrap(declarations[0].initializer);
  if (
    !ts.isCallExpression(call) ||
    !ts.isIdentifier(call.expression) ||
    call.expression.text !== "defineRouting" ||
    call.arguments.length !== 1
  ) {
    throw new Error(
      "routing must call defineRouting with one static object literal.",
    );
  }

  const object = unwrap(call.arguments[0]);
  if (!ts.isObjectLiteralExpression(object)) {
    throw new Error("defineRouting configuration must be an object literal.");
  }

  const properties = new Map();
  for (const property of object.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))
    ) {
      throw new Error(
        "Routing configuration must use explicit, noncomputed properties; spreads and shorthand are unsupported.",
      );
    }
    const name = property.name.text;
    if (properties.has(name)) {
      throw new Error(`Routing configuration repeats property ${name}.`);
    }
    properties.set(name, property.initializer);
  }

  if (!properties.has("locales") || !properties.has("defaultLocale")) {
    throw new Error("Routing must declare locales and defaultLocale.");
  }

  const array = unwrap(properties.get("locales"));
  if (!ts.isArrayLiteralExpression(array) || array.elements.length === 0) {
    throw new Error("Routing locales must be a nonempty static array.");
  }

  const locales = array.elements.map((element, index) =>
    staticString(element, `locales[${index}]`),
  );

  for (const locale of locales) {
    if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(locale)) {
      throw new Error(`Invalid locale filename identifier: ${JSON.stringify(locale)}.`);
    }
  }
  if (new Set(locales).size !== locales.length) {
    throw new Error("Routing locales must not contain duplicates.");
  }

  const defaultLocale = staticString(
    properties.get("defaultLocale"),
    "defaultLocale",
  );
  if (!locales.includes(defaultLocale)) {
    throw new Error("defaultLocale must appear in routing locales.");
  }

  return locales;
}

function flattenMessages(value, locale) {
  const leaves = new Map();

  function addLeaf(parts, valid, reason) {
    const key = parts.join(".");
    if (leaves.has(key)) {
      report(`${locale}: ambiguous dotted message key ${JSON.stringify(key)}.`);
      leaves.set(key, false);
      return;
    }
    leaves.set(key, valid);
    if (!valid) {
      report(`${locale}: ${JSON.stringify(key)} ${reason}.`);
    }
  }

  function visit(node, parts) {
    if (typeof node === "string") {
      addLeaf(parts, node.trim().length > 0, "must not be empty or whitespace");
      return;
    }

    if (node !== null && typeof node === "object" && !Array.isArray(node)) {
      const entries = Object.entries(node);
      if (entries.length === 0) {
        addLeaf(parts, false, "is an empty message object");
        return;
      }
      for (const [key, child] of entries) {
        if (key.length === 0) {
          report(`${locale}: empty property name under ${parts.join(".") || "<root>"}.`);
          continue;
        }
        visit(child, [...parts, key]);
      }
      return;
    }

    addLeaf(parts, false, "must be a string leaf or a nested message object");
  }

  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    report(`${locale}: the JSON root must be a nonempty message object.`);
    return leaves;
  }

  for (const [key, child] of Object.entries(value)) {
    if (key.length === 0) {
      report(`${locale}: the JSON root contains an empty property name.`);
      continue;
    }
    visit(child, [key]);
  }

  return leaves;
}

async function readCatalogues(locales) {
  const directory = path.join(root, "messages");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const expected = new Set(locales.map((locale) => `${locale}.json`));
  const actual = new Map(
    entries
      .filter((entry) => /\.json$/i.test(entry.name))
      .map((entry) => [entry.name, entry]),
  );

  for (const filename of actual.keys()) {
    if (!expected.has(filename)) {
      report(`Extra locale file: messages/${filename}.`);
    }
  }

  const catalogues = new Map();
  for (const locale of locales) {
    const filename = `${locale}.json`;
    const entry = actual.get(filename);
    if (!entry) {
      report(`Missing locale file: messages/${filename}.`);
      catalogues.set(locale, new Map());
      continue;
    }
    if (!entry.isFile()) {
      report(`messages/${filename} must be a regular file.`);
      catalogues.set(locale, new Map());
      continue;
    }

    try {
      const text = await fs.readFile(path.join(directory, filename), "utf8");
      catalogues.set(locale, flattenMessages(JSON.parse(text), locale));
    } catch (error) {
      report(`Cannot read or parse messages/${filename}: ${errorMessage(error)}`);
      catalogues.set(locale, new Map());
    }
  }

  return catalogues;
}

const excludedDirectories = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  "__tests__", "__mocks__", "__stories__", "test", "tests", "stories",
]);

function sourceKind(filename) {
  if (/\.tsx$/i.test(filename)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(filename)) return ts.ScriptKind.JSX;
  if (/\.(?:js|mjs|cjs)$/i.test(filename)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

async function collectSourceLiterals() {
  const literals = new Set();
  let filesScanned = 0;

  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name.toLowerCase())) {
          await walk(file);
        }
        continue;
      }
      if (
        !entry.isFile() ||
        !/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(entry.name) ||
        /\.d\.(?:ts|mts|cts)$/i.test(entry.name) ||
        /\.(?:test|spec|story|stories)\.[^.]+$/i.test(entry.name)
      ) {
        continue;
      }

      const source = parseSource(
        file,
        await fs.readFile(file, "utf8"),
        sourceKind(entry.name),
      );
      filesScanned += 1;
      function visit(node) {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)
        ) {
          literals.add(node.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }

  for (const name of ["app", "src"]) {
    const directory = path.join(root, name);
    let stat;
    try {
      stat = await fs.lstat(directory);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isDirectory()) {
      throw new Error(`${name} exists but is not a regular directory.`);
    }
    await walk(directory);
  }

  return { literals, filesScanned };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const locales = await readRouting();
  const catalogues = await readCatalogues(locales);
  const union = new Set();

  for (const leaves of catalogues.values()) {
    for (const key of leaves.keys()) union.add(key);
  }

  const keys = [...union].sort();
  if (keys.length === 0) {
    report("No message keys were found across the declared locales.");
  }

  for (const locale of locales) {
    const leaves = catalogues.get(locale);
    const missing = keys.filter((key) => !leaves.has(key));
    const nonempty = keys.filter((key) => leaves.get(key) === true).length;
    const coverage = keys.length === 0 ? 0 : (nonempty / keys.length) * 100;

    console.log(
      `${label} ${locale}: ${nonempty}/${keys.length} nonempty keys ` +
      `(${coverage.toFixed(2)}% coverage; required: 100%).`,
    );

    if (missing.length > 0) {
      report(`${locale}: missing union keys: ${missing.map((key) => JSON.stringify(key)).join(", ")}.`);
    }
    if (keys.length > 0 && nonempty !== keys.length) {
      report(`${locale}: nonempty coverage is below the required 100%.`);
    }
  }

  const { literals, filesScanned } = await collectSourceLiterals();
  console.log(`${label} Static literal scan: ${filesScanned} source files in app/src.`);

  if (filesScanned === 0) {
    console.warn(`${label} WARNING: no source files were scanned; unused-key candidates are suppressed.`);
  } else {
    const candidates = keys.filter((key) => {
      const leaf = key.split(".").at(-1);
      return !literals.has(key) && !literals.has(leaf);
    });

    console.warn(
      `${label} Unused-key analysis is heuristic only: full-key and leaf ` +
      `string literals are checked. Dynamic and data-flow uses require human ` +
      `review; candidates are not proof of unused messages and must not be ` +
      `deleted automatically.`,
    );
    for (const key of candidates) {
      console.warn(`${label} WARNING unused-key candidate: ${JSON.stringify(key)}.`);
    }
  }

  for (const problem of problems) {
    console.error(`${label} ERROR: ${problem}`);
  }

  if (problems.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(`${label} Translation structure and nonempty coverage checks passed.`);
  }
}

main().catch((error) => {
  console.error(`${label} FATAL: ${errorMessage(error)}`);
  process.exitCode = 1;
});

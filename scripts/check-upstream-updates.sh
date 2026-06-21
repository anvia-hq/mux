#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM_URL="${MODELS_DEV_API_URL:-https://models.dev/api.json}"
export MODELS_DEV_API_URL="$UPSTREAM_URL"

cd "$ROOT_DIR"

node <<'NODE'
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const vm = require("node:vm");

const upstreamUrl = process.env.MODELS_DEV_API_URL || "https://models.dev/api.json";
const providersDir = "apps/api/src/providers";
const hooksPath = "apps/platform/src/modules/providers/hooks.ts";
const schemaPath = "apps/api/src/modules/providers/schema.ts";
const registryPath = "apps/api/src/providers/registry.ts";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function main() {
  const upstream = await fetchJson(upstreamUrl);
  const upstreamProviderIds = Object.keys(upstream);
  const expectedModelsByProvider = new Map(
    Object.entries(upstream).map(([providerId, provider]) => [
      providerId,
      toExpectedModels(providerId, provider),
    ]),
  );

  const hooks = read(hooksPath);
  const schema = read(schemaPath);
  const registry = read(registryPath);

  const checks = [];
  checks.push(compareLists("platform PROVIDER_NAMES", upstreamProviderIds, extractConstArray(hooks, "PROVIDER_NAMES")));
  checks.push(compareLists("api providerNames", upstreamProviderIds, extractConstArray(schema, "providerNames")));
  checks.push(compareLists("registry adapterFactories", upstreamProviderIds, extractFactoryKeys(registry)));
  checks.push(compareLabels(upstream, extractProviderLabels(hooks)));
  checks.push(compareProviderFiles(upstreamProviderIds));
  checks.push(compareProviderModelCatalogs(expectedModelsByProvider));

  const failures = checks.flat().filter(Boolean);
  const upstreamModelCount = [...expectedModelsByProvider.values()].reduce(
    (sum, models) => sum + models.length,
    0,
  );

  if (failures.length) {
    console.error(`models.dev provider catalog is out of date (${failures.length} issue${failures.length === 1 ? "" : "s"}):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `models.dev provider catalog is up to date: ${upstreamProviderIds.length} providers, ${upstreamModelCount} models.`,
  );
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          reject(new Error(`Failed to fetch ${url}: HTTP ${response.statusCode}`));
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Failed to parse ${url}: ${error.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function toExpectedModels(providerId, provider) {
  return Object.entries(provider.models || {}).map(([modelId, model]) => ({
    id: model.id || modelId,
    name: model.name || model.id || modelId,
    provider: providerId,
    inputPricePer1M: numberOrZero(model.cost?.input),
    outputPricePer1M: numberOrZero(model.cost?.output),
    contextWindow: numberOrZero(model.limit?.context),
    maxOutputTokens: numberOrZero(model.limit?.output),
    inputModalities: stringArray(model.modalities?.input),
    outputModalities: stringArray(model.modalities?.output),
    reasoning: Boolean(model.reasoning),
    toolCall: Boolean(model.tool_call),
    structuredOutput: Boolean(model.structured_output ?? model.structured_outputs),
    weights: model.open_weights ? "open" : "closed",
  }));
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function extractConstArray(source, constName) {
  const match = source.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) {
    throw new Error(`Could not find ${constName}`);
  }

  return [...match[1].matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((match) =>
    JSON.parse(match[0]),
  );
}

function extractProviderLabels(source) {
  const match = source.match(
    /export const PROVIDER_LABELS: Record<ProviderName, string> = \{([\s\S]*?)\};/,
  );
  if (!match) {
    throw new Error("Could not find PROVIDER_LABELS");
  }

  const labels = new Map();
  for (const row of match[1].split("\n")) {
    const quoted = row.match(/^\s*"([^"\\]*(?:\\.[^"\\]*)*)":\s*("[^"\\]*(?:\\.[^"\\]*)*"),/);
    if (quoted) {
      labels.set(JSON.parse(`"${quoted[1]}"`), JSON.parse(quoted[2]));
      continue;
    }

    const identifier = row.match(/^\s*([A-Za-z_$][\w$]*):\s*("[^"\\]*(?:\\.[^"\\]*)*"),/);
    if (identifier) {
      labels.set(identifier[1], JSON.parse(identifier[2]));
    }
  }
  return labels;
}

function extractFactoryKeys(source) {
  const match = source.match(/const adapterFactories:[\s\S]*?= \{([\s\S]*?)\};/);
  if (!match) {
    throw new Error("Could not find adapterFactories");
  }

  const keys = [];
  for (const row of match[1].split("\n")) {
    const quoted = row.match(/^\s*"([^"\\]*(?:\\.[^"\\]*)*)":/);
    if (quoted) {
      keys.push(JSON.parse(`"${quoted[1]}"`));
      continue;
    }

    const identifier = row.match(/^\s*([A-Za-z_$][\w$]*):/);
    if (identifier) {
      keys.push(identifier[1]);
    }
  }
  return keys;
}

function extractProviderModels(providerId) {
  const filePath = path.join(providersDir, `${providerId}.ts`);
  const source = read(filePath);
  const start = source.indexOf("const MODELS: Model[] = ");
  if (start === -1) {
    throw new Error(`${filePath} is missing MODELS`);
  }

  const equals = source.indexOf("=", start);
  const arrayStart = source.indexOf("[", equals);
  if (arrayStart === -1) {
    throw new Error(`${filePath} has an invalid MODELS declaration`);
  }

  const arrayEnd = findMatchingBracket(source, arrayStart);
  const arrayLiteral = source.slice(arrayStart, arrayEnd + 1);
  return vm.runInNewContext(`(${arrayLiteral})`);
}

function findMatchingBracket(source, startIndex) {
  let depth = 0;
  let stringQuote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (stringQuote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        stringQuote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      stringQuote = char;
      continue;
    }

    if (char === "[") depth++;
    if (char === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }

  throw new Error("Could not find closing bracket for MODELS");
}

function compareLists(name, expected, actual) {
  const failures = [];
  if (JSON.stringify(expected) === JSON.stringify(actual)) {
    return failures;
  }

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expectedSet.has(item));
  if (missing.length) failures.push(`${name} missing: ${missing.join(", ")}`);
  if (extra.length) failures.push(`${name} extra: ${extra.join(", ")}`);
  if (!missing.length && !extra.length) failures.push(`${name} has the right ids but the order changed`);
  return failures;
}

function compareLabels(upstream, labels) {
  const failures = [];
  for (const [providerId, provider] of Object.entries(upstream)) {
    if (labels.get(providerId) !== provider.name) {
      failures.push(
        `platform PROVIDER_LABELS mismatch for ${providerId}: expected ${JSON.stringify(provider.name)}, found ${JSON.stringify(labels.get(providerId))}`,
      );
    }
  }

  for (const providerId of labels.keys()) {
    if (!upstream[providerId]) {
      failures.push(`platform PROVIDER_LABELS has extra provider: ${providerId}`);
    }
  }
  return failures;
}

function compareProviderFiles(providerIds) {
  const failures = [];
  for (const providerId of providerIds) {
    if (!fs.existsSync(path.join(providersDir, `${providerId}.ts`))) {
      failures.push(`provider file missing: ${providerId}.ts`);
    }
  }
  return failures;
}

function compareProviderModelCatalogs(expectedModelsByProvider) {
  const failures = [];
  for (const [providerId, expectedModels] of expectedModelsByProvider.entries()) {
    const actualModels = extractProviderModels(providerId);
    if (JSON.stringify(expectedModels) !== JSON.stringify(actualModels)) {
      failures.push(describeModelMismatch(providerId, expectedModels, actualModels));
    }
  }
  return failures;
}

function describeModelMismatch(providerId, expectedModels, actualModels) {
  if (expectedModels.length !== actualModels.length) {
    return `${providerId} model count changed: expected ${expectedModels.length}, found ${actualModels.length}`;
  }

  for (let index = 0; index < expectedModels.length; index++) {
    const expected = expectedModels[index];
    const actual = actualModels[index];
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      return `${providerId} model mismatch at index ${index}: expected ${expected.id}, found ${actual?.id}`;
    }
  }

  return `${providerId} model catalog changed`;
}
NODE

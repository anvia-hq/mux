export type ChannelOverrideRequestContext = {
  apiKey?: string;
  clientHeaders?: Headers | Record<string, string | string[] | undefined> | null;
  originalModel?: string;
  upstreamModel?: string;
  requestPath?: string;
};

export type ChannelOverrideRuntime = {
  apiKey?: string;
  paramOverride?: Record<string, unknown>;
  headerOverride?: Record<string, unknown>;
};

export type ChannelOverrideResult<T extends Record<string, unknown>> = {
  body: T;
  headers: Record<string, string>;
};

type ConditionOperation = {
  path: string;
  mode: string;
  value?: unknown;
  invert?: boolean;
  pass_missing_key?: boolean;
};

type ParamOperation = {
  path?: string;
  mode: string;
  value?: unknown;
  keep_origin?: boolean;
  from?: string;
  to?: string;
  conditions?: unknown;
  logic?: string;
};

type OverrideContext = {
  model?: string;
  upstream_model?: string;
  original_model?: string;
  request_path?: string;
  request_headers: Record<string, unknown>;
  header_override: Record<string, unknown>;
};

type PathSegment = string;

const CLIENT_HEADER_PLACEHOLDER_PREFIX = "{client_header:";
const HEADER_PASSTHROUGH_ALL_KEY = "*";
const HEADER_REGEX_PREFIX = "re:";
const HEADER_REGEX_PREFIX_V2 = "regex:";

const PASSTHROUGH_SKIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "cookie",
  "host",
  "content-length",
  "accept-encoding",
  "authorization",
  "x-api-key",
  "x-goog-api-key",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
]);

export class ChannelParamOverrideError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly type: string;
  readonly skipRetry: boolean;

  constructor(input: {
    message: string;
    statusCode?: number;
    code?: string;
    type?: string;
    skipRetry?: boolean;
  }) {
    super(input.message);
    this.name = "ChannelParamOverrideError";
    this.statusCode = normalizeStatusCode(input.statusCode ?? 400);
    this.code = input.code?.trim() || "invalid_request";
    this.type = input.type?.trim() || "invalid_request_error";
    this.skipRetry = input.skipRetry ?? true;
  }
}

export class ChannelParamOverrideConfigError extends ChannelParamOverrideError {
  constructor(error: unknown) {
    super({
      message: error instanceof Error ? error.message : "channel param override is invalid",
      statusCode: 500,
      code: "channel:param_override_invalid",
      type: "channel:param_override_invalid",
      skipRetry: true,
    });
    this.name = "ChannelParamOverrideConfigError";
  }
}

export class ChannelHeaderOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelHeaderOverrideError";
  }
}

export function applyChannelOverrides<T extends Record<string, unknown>>(
  body: T,
  channel: ChannelOverrideRuntime,
  requestContext: ChannelOverrideRequestContext = {},
): ChannelOverrideResult<T> {
  const effectiveRequestContext = {
    ...requestContext,
    apiKey: requestContext.apiKey ?? channel.apiKey,
  };
  const context = buildOverrideContext(channel, body, effectiveRequestContext);
  try {
    applyParamOverride(body, channel.paramOverride, context);
  } catch (error) {
    if (error instanceof ChannelParamOverrideError) throw error;
    throw new ChannelParamOverrideConfigError(error);
  }
  return {
    body,
    headers: resolveHeaderOverride(context.header_override, context, effectiveRequestContext),
  };
}

export function resolveChannelHeaders(
  channel: ChannelOverrideRuntime,
  requestContext: ChannelOverrideRequestContext = {},
): Record<string, string> {
  const effectiveRequestContext = {
    ...requestContext,
    apiKey: requestContext.apiKey ?? channel.apiKey,
  };
  const context = buildOverrideContext(channel, undefined, effectiveRequestContext);
  return resolveHeaderOverride(context.header_override, context, effectiveRequestContext);
}

function buildOverrideContext(
  channel: ChannelOverrideRuntime,
  body: Record<string, unknown> | undefined,
  requestContext: ChannelOverrideRequestContext,
): OverrideContext {
  const upstreamModel = requestContext.upstreamModel ?? readString(body?.model);
  const originalModel = requestContext.originalModel;
  const model = upstreamModel ?? originalModel;

  return {
    ...(model ? { model } : {}),
    ...(upstreamModel ? { upstream_model: upstreamModel } : {}),
    ...(originalModel ? { original_model: originalModel } : {}),
    ...(requestContext.requestPath ? { request_path: requestContext.requestPath } : {}),
    request_headers: normalizeHeaders(requestContext.clientHeaders),
    header_override: sanitizeHeaderOverride(channel.headerOverride),
  };
}

function applyParamOverride(
  body: Record<string, unknown>,
  paramOverride: Record<string, unknown> | undefined,
  context: OverrideContext,
): void {
  if (!paramOverride || Object.keys(paramOverride).length === 0) return;

  const operations = parseOperations(paramOverride);
  if (!operations) {
    applyLegacyOverride(body, paramOverride);
    return;
  }

  const legacyOverride: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(paramOverride)) {
    if (key.trim().toLowerCase() !== "operations") {
      legacyOverride[key] = value;
    }
  }
  applyLegacyOverride(body, legacyOverride);

  for (const operation of operations) {
    if (!conditionsPass(body, context, operation.conditions, operation.logic)) {
      continue;
    }
    applyOperation(body, context, operation);
  }
}

function applyLegacyOverride(
  body: Record<string, unknown>,
  paramOverride: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(paramOverride)) {
    body[key] = value;
  }
}

function parseOperations(paramOverride: Record<string, unknown>): ParamOperation[] | null {
  const raw = paramOverride.operations;
  if (!Array.isArray(raw)) return null;

  const operations: ParamOperation[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) return null;
    const mode = readString(item.mode);
    if (!mode) return null;
    operations.push({
      path: readString(item.path),
      mode,
      value: item.value,
      keep_origin: typeof item.keep_origin === "boolean" ? item.keep_origin : undefined,
      from: readString(item.from),
      to: readString(item.to),
      conditions: item.conditions,
      logic: readString(item.logic) ?? "OR",
    });
  }
  return operations;
}

function applyOperation(
  body: Record<string, unknown>,
  context: OverrideContext,
  operation: ParamOperation,
): void {
  const mode = operation.mode;
  switch (mode) {
    case "delete":
      for (const path of operationPaths(body, operation.path)) deletePath(body, path);
      return;
    case "set":
      for (const path of operationPaths(body, operation.path)) {
        if (operation.keep_origin && getPath(body, path).exists) continue;
        setPath(body, path, operation.value);
      }
      return;
    case "move":
      movePath(
        body,
        requiredPath(operation.from, "move from is required"),
        requiredPath(operation.to, "move to is required"),
      );
      return;
    case "copy":
      copyPath(
        body,
        requiredPath(operation.from, "copy from/to is required"),
        requiredPath(operation.to, "copy from/to is required"),
      );
      return;
    case "prepend":
    case "append":
      for (const path of operationPaths(body, operation.path)) {
        modifyValue(
          body,
          path,
          operation.value,
          operation.keep_origin === true,
          mode === "prepend",
        );
      }
      return;
    case "trim_prefix":
    case "trim_suffix":
      for (const path of operationPaths(body, operation.path)) {
        trimStringValue(body, path, operation.value, mode === "trim_prefix");
      }
      return;
    case "ensure_prefix":
    case "ensure_suffix":
      for (const path of operationPaths(body, operation.path)) {
        ensureStringAffix(body, path, operation.value, mode === "ensure_prefix");
      }
      return;
    case "trim_space":
      for (const path of operationPaths(body, operation.path))
        transformStringValue(body, path, (value) => value.trim());
      return;
    case "to_lower":
      for (const path of operationPaths(body, operation.path))
        transformStringValue(body, path, (value) => value.toLowerCase());
      return;
    case "to_upper":
      for (const path of operationPaths(body, operation.path))
        transformStringValue(body, path, (value) => value.toUpperCase());
      return;
    case "replace":
      for (const path of operationPaths(body, operation.path))
        replaceStringValue(body, path, operation.from, operation.to ?? "");
      return;
    case "regex_replace":
      for (const path of operationPaths(body, operation.path))
        regexReplaceStringValue(body, path, operation.from, operation.to ?? "");
      return;
    case "return_error":
      throw parseReturnError(operation.value);
    case "prune_objects":
      for (const path of operationPaths(body, operation.path ?? ""))
        pruneObjects(body, path, operation.value, context);
      return;
    case "set_header":
      setHeaderOverrideInContext(
        context,
        requiredPath(operation.path, "header name is required"),
        operation.value,
        operation.keep_origin === true,
      );
      return;
    case "delete_header":
      deleteHeaderOverrideInContext(
        context,
        requiredPath(operation.path, "header name is required"),
      );
      return;
    case "copy_header": {
      const source = operation.from?.trim() || operation.path?.trim() || "";
      const target = operation.to?.trim() || operation.path?.trim() || "";
      try {
        copyHeaderInContext(context, source, target, operation.keep_origin === true);
      } catch (error) {
        if (!(error instanceof HeaderSourceMissingError)) throw error;
      }
      return;
    }
    case "move_header": {
      const source = operation.from?.trim() || operation.path?.trim() || "";
      const target = operation.to?.trim() || operation.path?.trim() || "";
      try {
        moveHeaderInContext(context, source, target, operation.keep_origin === true);
      } catch (error) {
        if (!(error instanceof HeaderSourceMissingError)) throw error;
      }
      return;
    }
    case "pass_headers":
      for (const header of parseHeaderPassThroughNames(operation.value)) {
        try {
          copyHeaderInContext(context, header, header, operation.keep_origin === true);
        } catch (error) {
          if (!(error instanceof HeaderSourceMissingError)) throw error;
        }
      }
      return;
    case "sync_fields":
      syncFields(
        body,
        context,
        requiredPath(operation.from, "sync_fields from is required"),
        requiredPath(operation.to, "sync_fields to is required"),
      );
      return;
    default:
      throw new Error(`unknown operation: ${mode}`);
  }
}

function requiredPath(path: string | undefined, message: string): string {
  const trimmed = path?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function operationPaths(
  body: Record<string, unknown>,
  rawPath: string | undefined,
): PathSegment[][] {
  const path = rawPath?.trim() ?? "";
  if (!path) return [[]];
  const segments = splitPath(path);
  if (!segments.includes("*")) {
    return [resolveNegativeSegments(body, segments)];
  }
  return expandWildcardPaths(body, segments);
}

function splitPath(path: string): PathSegment[] {
  const segments: string[] = [];
  let current = "";
  let escaped = false;
  for (const char of path) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === ".") {
      segments.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments.filter((segment) => segment.trim() !== "");
}

function resolveNegativeSegments(root: unknown, segments: PathSegment[]): PathSegment[] {
  const resolved: string[] = [];
  let node = root;
  for (const segment of segments) {
    let nextSegment = segment;
    if (Array.isArray(node) && /^-\d+$/.test(segment)) {
      const index = node.length + Number(segment);
      if (index >= 0 && index < node.length) {
        nextSegment = String(index);
      }
    }
    resolved.push(nextSegment);
    node = getChild(node, nextSegment).value;
  }
  return resolved;
}

function expandWildcardPaths(root: unknown, segments: PathSegment[]): PathSegment[][] {
  const collect = (
    node: unknown,
    remaining: PathSegment[],
    prefix: PathSegment[],
  ): PathSegment[][] => {
    if (remaining.length === 0) return [prefix];
    const [segment, ...rest] = remaining;
    if (!segment) return [];

    if (segment === "*") {
      if (Array.isArray(node)) {
        return node.flatMap((child, index) => collect(child, rest, [...prefix, String(index)]));
      }
      if (isPlainObject(node)) {
        return Object.keys(node)
          .sort()
          .flatMap((key) => collect(node[key], rest, [...prefix, key]));
      }
      return [];
    }

    const resolved =
      Array.isArray(node) && /^-\d+$/.test(segment)
        ? String(node.length + Number(segment))
        : segment;
    const child = getChild(node, resolved);
    if (!child.exists && rest.length > 0) return [];
    return collect(child.value, rest, [...prefix, resolved]);
  };

  return uniquePaths(collect(root, segments, []));
}

function uniquePaths(paths: PathSegment[][]): PathSegment[][] {
  const seen = new Set<string>();
  const result: PathSegment[][] = [];
  for (const path of paths) {
    const key = path.join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

function getPath(root: unknown, path: PathSegment[]): { exists: boolean; value: unknown } {
  let node = root;
  for (const segment of path) {
    const child = getChild(node, segment);
    if (!child.exists) return { exists: false, value: undefined };
    node = child.value;
  }
  return { exists: true, value: node };
}

function getChild(node: unknown, segment: string): { exists: boolean; value: unknown } {
  if (Array.isArray(node)) {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index >= node.length) {
      return { exists: false, value: undefined };
    }
    return { exists: true, value: node[index] };
  }
  if (isPlainObject(node) && Object.hasOwn(node, segment)) {
    return { exists: true, value: node[segment] };
  }
  return { exists: false, value: undefined };
}

function setPath(root: Record<string, unknown>, path: PathSegment[], value: unknown): void {
  if (path.length === 0) {
    replaceRoot(root, value);
    return;
  }
  const parent = ensureParent(root, path);
  const key = path.at(-1) ?? "";
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) throw new Error(`invalid array index: ${key}`);
    parent[index] = value;
    return;
  }
  parent[key] = value;
}

function deletePath(root: Record<string, unknown>, path: PathSegment[]): void {
  if (path.length === 0) return;
  const parentResult = getPath(root, path.slice(0, -1));
  if (!parentResult.exists) return;
  const parent = parentResult.value;
  const key = path.at(-1) ?? "";
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (Number.isInteger(index) && index >= 0 && index < parent.length) {
      parent.splice(index, 1);
    }
    return;
  }
  if (isPlainObject(parent)) {
    delete parent[key];
  }
}

function ensureParent(
  root: Record<string, unknown>,
  path: PathSegment[],
): Record<string, unknown> | unknown[] {
  let node: Record<string, unknown> | unknown[] = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    if (Array.isArray(node)) {
      const arrayIndex = Number(segment);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0)
        throw new Error(`invalid array index: ${segment}`);
      if (!isContainer(node[arrayIndex])) node[arrayIndex] = /^\d+$/.test(nextSegment) ? [] : {};
      node = node[arrayIndex] as Record<string, unknown> | unknown[];
      continue;
    }
    if (!isContainer(node[segment])) node[segment] = /^\d+$/.test(nextSegment) ? [] : {};
    node = node[segment] as Record<string, unknown> | unknown[];
  }
  return node;
}

function replaceRoot(root: Record<string, unknown>, value: unknown): void {
  for (const key of Object.keys(root)) delete root[key];
  if (isPlainObject(value)) {
    Object.assign(root, value);
    return;
  }
  throw new Error("root replacement requires an object value");
}

function movePath(root: Record<string, unknown>, from: string, to: string): void {
  const fromPath = resolveNegativeSegments(root, splitPath(from));
  const value = getPath(root, fromPath);
  if (!value.exists) throw new Error(`source path does not exist: ${from}`);
  setPath(root, resolveNegativeSegments(root, splitPath(to)), value.value);
  deletePath(root, fromPath);
}

function copyPath(root: Record<string, unknown>, from: string, to: string): void {
  const fromPath = resolveNegativeSegments(root, splitPath(from));
  const value = getPath(root, fromPath);
  if (!value.exists) throw new Error(`source path does not exist: ${from}`);
  setPath(root, resolveNegativeSegments(root, splitPath(to)), structuredCloneSafe(value.value));
}

function modifyValue(
  root: Record<string, unknown>,
  path: PathSegment[],
  value: unknown,
  keepOrigin: boolean,
  isPrepend: boolean,
): void {
  const current = getPath(root, path);
  if (!current.exists) throw new Error("operation not supported for missing value");

  if (Array.isArray(current.value)) {
    const add = Array.isArray(value) ? value : [value];
    setPath(root, path, isPrepend ? [...add, ...current.value] : [...current.value, ...add]);
    return;
  }
  if (typeof current.value === "string") {
    const valueString = String(value ?? "");
    setPath(root, path, isPrepend ? valueString + current.value : current.value + valueString);
    return;
  }
  if (isPlainObject(current.value) && isPlainObject(value)) {
    setPath(
      root,
      path,
      keepOrigin ? { ...value, ...current.value } : { ...current.value, ...value },
    );
    return;
  }
  throw new Error(`operation not supported for type: ${typeof current.value}`);
}

function trimStringValue(
  root: Record<string, unknown>,
  path: PathSegment[],
  value: unknown,
  isPrefix: boolean,
): void {
  if (value === undefined || value === null) throw new Error("trim value is required");
  const current = requireString(root, path);
  const text = String(value);
  setPath(root, path, isPrefix ? trimPrefix(current, text) : trimSuffix(current, text));
}

function ensureStringAffix(
  root: Record<string, unknown>,
  path: PathSegment[],
  value: unknown,
  isPrefix: boolean,
): void {
  if (value === undefined || value === null || String(value) === "") {
    throw new Error("ensure value is required");
  }
  const current = requireString(root, path);
  const text = String(value);
  if (isPrefix) {
    setPath(root, path, current.startsWith(text) ? current : text + current);
    return;
  }
  setPath(root, path, current.endsWith(text) ? current : current + text);
}

function transformStringValue(
  root: Record<string, unknown>,
  path: PathSegment[],
  transform: (value: string) => string,
): void {
  setPath(root, path, transform(requireString(root, path)));
}

function replaceStringValue(
  root: Record<string, unknown>,
  path: PathSegment[],
  from: string | undefined,
  to: string,
): void {
  if (!from) throw new Error("replace from is required");
  setPath(root, path, requireString(root, path).split(from).join(to));
}

function regexReplaceStringValue(
  root: Record<string, unknown>,
  path: PathSegment[],
  pattern: string | undefined,
  replacement: string,
): void {
  if (!pattern) throw new Error("regex pattern is required");
  setPath(root, path, requireString(root, path).replace(new RegExp(pattern, "g"), replacement));
}

function requireString(root: Record<string, unknown>, path: PathSegment[]): string {
  const current = getPath(root, path);
  if (!current.exists || typeof current.value !== "string") {
    throw new Error(`operation not supported for type: ${typeof current.value}`);
  }
  return current.value;
}

function pruneObjects(
  root: Record<string, unknown>,
  path: PathSegment[],
  value: unknown,
  context: OverrideContext,
): void {
  const options = parsePruneOptions(value);
  const target = path.length === 0 ? { exists: true, value: root } : getPath(root, path);
  if (!target.exists) return;
  const cleaned = pruneNode(target.value, options, context, true);
  if (path.length === 0) {
    replaceRoot(root, cleaned);
    return;
  }
  setPath(root, path, cleaned);
}

function parsePruneOptions(value: unknown): {
  logic: string;
  recursive: boolean;
  conditions: ConditionOperation[];
} {
  const options = { logic: "AND", recursive: true, conditions: [] as ConditionOperation[] };
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) throw new Error("prune_objects value is required");
    options.conditions.push({ path: "type", mode: "full", value: text });
    return options;
  }
  if (!isPlainObject(value)) throw new Error("prune_objects value must be string or object");
  const logic = readString(value.logic);
  if (logic) options.logic = logic;
  if (typeof value.recursive === "boolean") options.recursive = value.recursive;
  if (value.conditions !== undefined) options.conditions.push(...parseConditions(value.conditions));
  if (isPlainObject(value.where)) {
    for (const [key, conditionValue] of Object.entries(value.where)) {
      if (key.trim()) options.conditions.push({ path: key, mode: "full", value: conditionValue });
    }
  }
  if (value.type !== undefined)
    options.conditions.push({ path: "type", mode: "full", value: value.type });
  if (options.conditions.length === 0) throw new Error("prune_objects conditions are required");
  return options;
}

function pruneNode(
  node: unknown,
  options: { logic: string; recursive: boolean; conditions: ConditionOperation[] },
  context: OverrideContext,
  isRoot: boolean,
): unknown {
  if (Array.isArray(node)) {
    return node
      .map((item) => pruneNode(item, options, context, false))
      .filter((item) => item !== PRUNED);
  }
  if (!isPlainObject(node)) return node;

  const shouldDrop = conditionsPass(node, context, options.conditions, options.logic);
  if (shouldDrop && !isRoot) return PRUNED;
  if (!options.recursive) return node;

  for (const [key, child] of Object.entries(node)) {
    const next = pruneNode(child, options, context, false);
    if (next === PRUNED) {
      delete node[key];
    } else {
      node[key] = next;
    }
  }
  return node;
}

const PRUNED = Symbol("pruned");

function conditionsPass(
  body: Record<string, unknown>,
  context: OverrideContext,
  rawConditions: unknown,
  logic = "OR",
): boolean {
  if (rawConditions === undefined || (Array.isArray(rawConditions) && rawConditions.length === 0)) {
    return true;
  }
  const conditions = Array.isArray(rawConditions)
    ? parseConditions(rawConditions)
    : parseConditions(rawConditions);
  if (conditions.length === 0) return true;

  const checks = conditions.map((condition) => checkCondition(body, context, condition));
  if (logic.toUpperCase() === "AND") return checks.every(Boolean);
  return checks.some(Boolean);
}

function parseConditions(raw: unknown): ConditionOperation[] {
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (!isPlainObject(item)) throw new Error("condition must be object");
      const path = readString(item.path);
      const mode = readString(item.mode);
      if (!path || !mode) throw new Error("condition path/mode is required");
      return {
        path,
        mode,
        value: item.value,
        invert: typeof item.invert === "boolean" ? item.invert : undefined,
        pass_missing_key:
          typeof item.pass_missing_key === "boolean" ? item.pass_missing_key : undefined,
      };
    });
  }
  if (isPlainObject(raw)) {
    return Object.entries(raw)
      .filter(([path]) => path.trim() !== "")
      .map(([path, value]) => ({ path, mode: "full", value }));
  }
  throw new Error("conditions must be an array or object");
}

function checkCondition(
  body: Record<string, unknown>,
  context: OverrideContext,
  condition: ConditionOperation,
): boolean {
  const path = splitPath(condition.path);
  let current = getPath(body, resolveNegativeSegments(body, path));
  if (!current.exists) {
    current = getPath(context, resolveNegativeSegments(context, path));
  }
  if (!current.exists) {
    return condition.pass_missing_key === true;
  }

  const result = compareConditionValue(
    current.value,
    condition.value,
    condition.mode.toLowerCase(),
  );
  return condition.invert ? !result : result;
}

function compareConditionValue(actual: unknown, expected: unknown, mode: string): boolean {
  switch (mode) {
    case "full":
      return deepEqual(actual, expected);
    case "prefix":
      return String(actual).startsWith(String(expected));
    case "suffix":
      return String(actual).endsWith(String(expected));
    case "contains":
      return String(actual).includes(String(expected));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof expected !== "number") {
        throw new Error("numeric comparison requires both values to be numbers");
      }
      if (mode === "gt") return actual > expected;
      if (mode === "gte") return actual >= expected;
      if (mode === "lt") return actual < expected;
      return actual <= expected;
    }
    default:
      throw new Error(`unsupported comparison mode: ${mode}`);
  }
}

function setHeaderOverrideInContext(
  context: OverrideContext,
  headerName: string,
  value: unknown,
  keepOrigin: boolean,
): void {
  const key = normalizeHeaderName(headerName);
  if (!key) throw new Error("header name is required");
  if (keepOrigin && Object.hasOwn(context.header_override, key)) return;

  const resolved = resolveHeaderOverrideValue(context, key, value);
  if (resolved === undefined) {
    delete context.header_override[key];
    return;
  }
  context.header_override[key] = resolved;
}

function resolveHeaderOverrideValue(
  context: OverrideContext,
  headerName: string,
  value: unknown,
): string | undefined {
  if (isPlainObject(value)) {
    return resolveHeaderOverrideValueByMapping(context, headerName, value);
  }
  const text = String(value ?? "").trim();
  return text === "" ? undefined : text;
}

function resolveHeaderOverrideValueByMapping(
  context: OverrideContext,
  headerName: string,
  mapping: Record<string, unknown>,
): string | undefined {
  if (Object.keys(mapping).length === 0) throw new Error("header value mapping cannot be empty");

  const source = getHeaderValueFromContext(context, headerName);
  const sourceTokens = source ? splitHeaderListValue(source) : [];
  const appendTokens = parseHeaderReplacementTokens(mapping.$append);
  const keepOnlyDeclared = mapping.$keep_only_declared === true;
  const hasWildcard = Object.hasOwn(mapping, "*");
  const wildcard = mapping["*"];
  const result: string[] = [];

  for (const token of sourceTokens) {
    let replacement = mapping[token];
    let hasReplacement = Object.hasOwn(mapping, token);
    if (!hasReplacement && hasWildcard && !keepOnlyDeclared) {
      replacement = wildcard;
      hasReplacement = true;
    }
    if (!hasReplacement) {
      if (!keepOnlyDeclared) result.push(token);
      continue;
    }
    result.push(...parseHeaderReplacementTokens(replacement));
  }
  result.push(...appendTokens);

  const unique = uniqueStrings(result);
  return unique.length > 0 ? unique.join(",") : undefined;
}

function deleteHeaderOverrideInContext(context: OverrideContext, headerName: string): void {
  const key = normalizeHeaderName(headerName);
  if (!key) throw new Error("header name is required");
  delete context.header_override[key];
}

class HeaderSourceMissingError extends Error {}

function copyHeaderInContext(
  context: OverrideContext,
  fromHeader: string,
  toHeader: string,
  keepOrigin: boolean,
): void {
  const from = normalizeHeaderName(fromHeader);
  const to = normalizeHeaderName(toHeader);
  if (!from || !to) throw new Error("copy_header from/to is required");
  const value = getHeaderValueFromContext(context, from);
  if (value === undefined) throw new HeaderSourceMissingError(`source header not found: ${from}`);
  setHeaderOverrideInContext(context, to, value, keepOrigin);
}

function moveHeaderInContext(
  context: OverrideContext,
  fromHeader: string,
  toHeader: string,
  keepOrigin: boolean,
): void {
  const from = normalizeHeaderName(fromHeader);
  const to = normalizeHeaderName(toHeader);
  copyHeaderInContext(context, from, to, keepOrigin);
  if (from !== to) deleteHeaderOverrideInContext(context, from);
}

function getHeaderValueFromContext(
  context: OverrideContext,
  headerName: string,
): string | undefined {
  const key = normalizeHeaderName(headerName);
  const fromOverride = readHeaderValue(context.header_override[key]);
  if (fromOverride !== undefined) return fromOverride;
  return readHeaderValue(context.request_headers[key]);
}

function parseHeaderPassThroughNames(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) throw new Error("pass_headers value is required");
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return parseHeaderPassThroughNames(JSON.parse(trimmed));
      } catch {
        // Treat non-JSON strings as comma-separated header names.
      }
    }
    return validateHeaderNames(trimmed.split(","));
  }
  if (Array.isArray(value)) {
    return validateHeaderNames(value.map((item) => String(item)));
  }
  if (isPlainObject(value)) {
    const names = [
      ...safeHeaderNames(value.headers),
      ...safeHeaderNames(value.names),
      ...safeHeaderNames(value.header),
    ];
    return validateHeaderNames(names);
  }
  throw new Error("pass_headers value must be string, array or object");
}

function safeHeaderNames(value: unknown): string[] {
  try {
    return parseHeaderPassThroughNames(value);
  } catch {
    return [];
  }
}

function validateHeaderNames(values: string[]): string[] {
  const names = uniqueStrings(values.map(normalizeHeaderName).filter(Boolean));
  if (names.length === 0) throw new Error("pass_headers value is invalid");
  return names;
}

function syncFields(
  body: Record<string, unknown>,
  context: OverrideContext,
  fromSpec: string,
  toSpec: string,
): void {
  const from = parseSyncTarget(fromSpec);
  const to = parseSyncTarget(toSpec);
  const fromValue = readSyncTarget(body, context, from);
  const toValue = readSyncTarget(body, context, to);
  if (fromValue.exists && !toValue.exists) writeSyncTarget(body, context, to, fromValue.value);
  if (toValue.exists && !fromValue.exists) writeSyncTarget(body, context, from, toValue.value);
}

function parseSyncTarget(spec: string): { kind: "json" | "header"; key: string } {
  const raw = spec.trim();
  if (!raw) throw new Error("sync_fields target is required");
  const index = raw.indexOf(":");
  if (index < 0) return { kind: "json", key: raw };
  const kind = raw.slice(0, index).trim().toLowerCase();
  const key = raw.slice(index + 1).trim();
  if (!key) throw new Error(`sync_fields target key is required: ${raw}`);
  if (kind === "json" || kind === "body") return { kind: "json", key };
  if (kind === "header") return { kind: "header", key };
  throw new Error(`sync_fields target prefix is invalid: ${raw}`);
}

function readSyncTarget(
  body: Record<string, unknown>,
  context: OverrideContext,
  target: { kind: "json" | "header"; key: string },
): { exists: boolean; value: unknown } {
  if (target.kind === "header") {
    const value = getHeaderValueFromContext(context, target.key);
    return value?.trim() ? { exists: true, value } : { exists: false, value: undefined };
  }
  const value = getPath(body, resolveNegativeSegments(body, splitPath(target.key)));
  if (!value.exists || value.value === null || value.value === undefined)
    return { exists: false, value: undefined };
  if (typeof value.value === "string" && value.value.trim() === "")
    return { exists: false, value: undefined };
  return value;
}

function writeSyncTarget(
  body: Record<string, unknown>,
  context: OverrideContext,
  target: { kind: "json" | "header"; key: string },
  value: unknown,
): void {
  if (target.kind === "header") {
    setHeaderOverrideInContext(context, target.key, value, false);
    return;
  }
  setPath(body, resolveNegativeSegments(body, splitPath(target.key)), value);
}

function resolveHeaderOverride(
  source: Record<string, unknown>,
  context: OverrideContext,
  requestContext: ChannelOverrideRequestContext,
): Record<string, string> {
  const headers: Record<string, string> = {};
  let passAll = false;
  const regexes: RegExp[] = [];

  for (const key of Object.keys(source)) {
    const normalized = key.trim().toLowerCase();
    if (normalized === HEADER_PASSTHROUGH_ALL_KEY) {
      passAll = true;
      continue;
    }
    if (normalized.startsWith(HEADER_REGEX_PREFIX)) {
      regexes.push(
        compileHeaderPassthroughRegex(normalized.slice(HEADER_REGEX_PREFIX.length), key),
      );
      continue;
    }
    if (normalized.startsWith(HEADER_REGEX_PREFIX_V2)) {
      regexes.push(
        compileHeaderPassthroughRegex(normalized.slice(HEADER_REGEX_PREFIX_V2.length), key),
      );
    }
  }

  if (passAll || regexes.length > 0) {
    const clientHeaders = normalizeHeaders(requestContext.clientHeaders);
    for (const [name, value] of Object.entries(clientHeaders)) {
      if (PASSTHROUGH_SKIP_HEADERS.has(name)) continue;
      if (!passAll && !regexes.some((regex) => regex.test(name))) continue;
      const headerValue = readHeaderValue(value);
      if (headerValue !== undefined) headers[name] = headerValue;
    }
  }

  for (const [rawKey, rawValue] of Object.entries(source)) {
    if (isHeaderPassthroughRuleKey(rawKey)) continue;
    const key = normalizeHeaderName(rawKey);
    if (!key) continue;
    if (typeof rawValue !== "string") {
      throw new ChannelHeaderOverrideError(`header override value for ${rawKey} must be a string`);
    }
    const resolved = applyHeaderOverridePlaceholders(rawValue, context, requestContext);
    if (resolved !== undefined) headers[key] = resolved;
  }

  return headers;
}

function compileHeaderPassthroughRegex(pattern: string, sourceKey: string): RegExp {
  const trimmed = pattern.trim();
  if (!trimmed) {
    throw new ChannelHeaderOverrideError(`header passthrough regex pattern is empty: ${sourceKey}`);
  }
  try {
    return new RegExp(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid header passthrough regex";
    throw new ChannelHeaderOverrideError(message);
  }
}

function applyHeaderOverridePlaceholders(
  template: string,
  context: OverrideContext,
  requestContext: ChannelOverrideRequestContext,
): string | undefined {
  const trimmed = template.trim();
  if (trimmed.startsWith(CLIENT_HEADER_PLACEHOLDER_PREFIX)) {
    const afterPrefix = trimmed.slice(CLIENT_HEADER_PLACEHOLDER_PREFIX.length);
    const end = afterPrefix.indexOf("}");
    if (end < 0 || end !== afterPrefix.length - 1) {
      throw new ChannelHeaderOverrideError(
        `client_header placeholder must be the full value: ${template}`,
      );
    }
    const name = afterPrefix.slice(0, end).trim();
    if (!name)
      throw new ChannelHeaderOverrideError(`client_header placeholder name is empty: ${template}`);
    const value = normalizeHeaders(requestContext.clientHeaders)[normalizeHeaderName(name)];
    return readHeaderValue(value);
  }

  const withApiKey = template.includes("{api_key}")
    ? template
        .split("{api_key}")
        .join(requestContext.apiKey ?? contextValue(context, "api_key") ?? "")
    : template;
  const value = withApiKey.trim();
  return value === "" ? undefined : value;
}

function contextValue(context: OverrideContext, key: string): string | undefined {
  const value = (context as unknown as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function sanitizeHeaderOverride(
  source: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!source) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizeHeaderName(key);
    if (normalized) result[normalized] = value;
  }
  return result;
}

function normalizeHeaders(
  source: Headers | Record<string, string | string[] | undefined> | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!source) return result;

  if (source instanceof Headers) {
    for (const [key, value] of source.entries()) {
      const normalized = normalizeHeaderName(key);
      const text = value.trim();
      if (normalized && text) result[normalized] = text;
    }
    return result;
  }

  for (const [key, value] of Object.entries(source)) {
    const normalized = normalizeHeaderName(key);
    if (!normalized) continue;
    const text = Array.isArray(value) ? value.join(",").trim() : value?.trim();
    if (text) result[normalized] = text;
  }
  return result;
}

function parseHeaderReplacementTokens(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return splitHeaderListValue(value);
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => parseHeaderReplacementTokens(item)));
  }
  if (isPlainObject(value))
    throw new Error("header replacement value must be string, array or null");
  const text = String(value).trim();
  return text ? [text] : [];
}

function splitHeaderListValue(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isHeaderPassthroughRuleKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    normalized === HEADER_PASSTHROUGH_ALL_KEY ||
    normalized.startsWith(HEADER_REGEX_PREFIX) ||
    normalized.startsWith(HEADER_REGEX_PREFIX_V2)
  );
}

function normalizeHeaderName(name: string): string {
  return name.trim().toLowerCase();
}

function readHeaderValue(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : undefined;
  return text ? text : undefined;
}

function parseReturnError(value: unknown): ChannelParamOverrideError {
  if (typeof value === "string") {
    const message = value.trim();
    if (!message) throw new Error("return_error message is required");
    return new ChannelParamOverrideError({ message });
  }
  if (!isPlainObject(value)) throw new Error("return_error value must be string or object");

  const message = readString(value.message) ?? readString(value.msg);
  if (!message) throw new Error("return_error message is required");
  const statusRaw = value.status_code ?? value.status;
  const statusCode = statusRaw === undefined ? undefined : parseInteger(statusRaw);
  if (statusRaw !== undefined && statusCode === undefined) {
    throw new Error("return_error status_code must be an integer");
  }
  if (statusCode !== undefined && (statusCode < 100 || statusCode > 511)) {
    throw new Error(`return_error status code out of range: ${statusCode}`);
  }
  return new ChannelParamOverrideError({
    message,
    statusCode,
    code: value.code === undefined ? undefined : String(value.code),
    type: readString(value.type),
    skipRetry: typeof value.skip_retry === "boolean" ? value.skip_retry : undefined,
  });
}

function normalizeStatusCode(statusCode: number): number {
  if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 511) {
    return statusCode;
  }
  return 400;
}

function parseInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value);
  return undefined;
}

function trimPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function trimSuffix(value: string, suffix: string): string {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return isPlainObject(value) || Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function structuredCloneSafe<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const SINGLE_SLUG_PATTERN = /^(?!.*__)[a-z][a-z0-9_-]{0,63}$/;
const UPLOADED_FILE_PATTERN =
  /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:ts|mts|js|mjs|json)$/;

export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginValidationError";
  }
}

export const isSafePluginSlug = (slug: string): boolean => SINGLE_SLUG_PATTERN.test(slug);

export const normalizeRelativeFilePath = (rawPath: string): string => {
  const normalized = rawPath.startsWith("./") ? rawPath.slice(2) : rawPath;

  if (!UPLOADED_FILE_PATTERN.test(normalized)) {
    throw new PluginValidationError(`Invalid plugin file path '${rawPath}'.`);
  }

  for (const segment of normalized.split("/")) {
    if (segment === "." || segment === ".." || segment.length === 0 || segment.startsWith(".")) {
      throw new PluginValidationError(`Invalid plugin file path segment in '${rawPath}'.`);
    }
  }

  return normalized;
};

export const isPathStrictlyInside = (rootPath: string, candidatePath: string): boolean => {
  const rel = relative(rootPath, candidatePath);

  if (rel.length === 0) {
    return false;
  }

  if (isAbsolute(rel)) {
    return false;
  }

  return rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\");
};

export const resolvePathWithinRoot = (rootDir: string, relativeTarget: string): string => {
  if (
    relativeTarget.length === 0 ||
    relativeTarget.includes("\0") ||
    relativeTarget.includes("\\") ||
    isAbsolute(relativeTarget)
  ) {
    throw new PluginValidationError(`Unsafe relative path '${relativeTarget}'.`);
  }

  const resolvedRoot = resolve(rootDir);
  const resolvedTarget = resolve(resolvedRoot, relativeTarget);

  if (!isPathStrictlyInside(resolvedRoot, resolvedTarget)) {
    throw new PluginValidationError(`Path '${relativeTarget}' escapes root directory.`);
  }

  return resolvedTarget;
};

export const resolveExistingPathWithinRoot = async (
  rootDir: string,
  relativeTarget: string,
): Promise<string> => {
  const realRoot = await realpath(rootDir);
  const tentative = resolvePathWithinRoot(realRoot, relativeTarget);
  const realTarget = await realpath(tentative);

  if (!isPathStrictlyInside(realRoot, realTarget)) {
    throw new PluginValidationError(
      `Resolved path '${relativeTarget}' escapes root directory via symlink.`,
    );
  }

  return realTarget;
};

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import { canonicalizeJson, sha256Hex } from "@mux/core/canonical-json";
import { parsePluginManifest } from "@mux/core/manifest";
import type { ToolExecutionResult } from "@mux/core/types";
import { ZodError } from "zod";
import {
  isSafePluginSlug,
  normalizeRelativeFilePath,
  PluginValidationError,
  resolveExistingPathWithinRoot,
  resolvePathWithinRoot,
} from "./path-safety";
import { runPluginSubprocess } from "./runner";
import type {
  LoadedPlugin,
  PluginExecutionInput,
  PluginRuntime,
  PluginRuntimeOptions,
  UploadedPluginFile,
} from "./types";

const DEFAULT_MAX_BUNDLE_BYTES = 1024 * 1024;
const MAX_UPLOADED_FILES = 50;

const computeBundleHash = (
  manifest: unknown,
  files: Array<{ path: string; content: string }>,
): string => {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  return sha256Hex(canonicalizeJson({ manifest, files: sorted }));
};

const formatManifestError = (error: unknown): PluginValidationError => {
  if (error instanceof PluginValidationError) {
    return error;
  }

  if (error instanceof ZodError) {
    const details = error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
      .join("; ");

    return new PluginValidationError(`Invalid plugin manifest: ${details}`);
  }

  if (error instanceof SyntaxError) {
    return new PluginValidationError("Plugin manifest.json is not valid JSON.");
  }

  return new PluginValidationError("Failed to load plugin manifest or files.");
};

const collectLocalPluginFiles = async (
  realPluginDir: string,
  maxBytes: number,
): Promise<UploadedPluginFile[]> => {
  const collected: UploadedPluginFile[] = [];
  let totalBytes = 0;

  const walk = async (relDir: string): Promise<void> => {
    const absDir = relDir.length === 0 ? realPluginDir : resolve(realPluginDir, relDir);
    const entries = await readdir(absDir);

    for (const entry of entries.sort()) {
      if (entry.startsWith(".")) {
        continue;
      }

      const relPath = relDir.length === 0 ? entry : posix.join(relDir, entry);

      if (relPath === "manifest.json") {
        continue;
      }

      const absPath = resolve(realPluginDir, relPath);
      const linkInfo = await lstat(absPath);

      if (linkInfo.isSymbolicLink()) {
        throw new PluginValidationError(`Symlinks are not permitted inside plugin '${relPath}'.`);
      }

      if (linkInfo.isDirectory()) {
        await walk(relPath);
        continue;
      }

      if (!linkInfo.isFile()) {
        continue;
      }

      let normalizedPath: string;

      try {
        normalizedPath = normalizeRelativeFilePath(relPath);
      } catch {
        continue;
      }

      const content = await readFile(absPath, "utf8");

      totalBytes += Buffer.byteLength(content, "utf8");

      if (totalBytes > maxBytes) {
        throw new PluginValidationError(`Local plugin exceeded maximum size of ${maxBytes} bytes.`);
      }

      collected.push({ path: normalizedPath, content });
    }
  };

  await walk("");

  return collected;
};

export const createPluginRuntime = (options: PluginRuntimeOptions): PluginRuntime => {
  const localPluginsRoot = resolve(options.localPluginsRoot);
  const uploadedPluginsRoot = resolve(options.uploadedPluginsRoot);
  const maxBundleBytes = options.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES;

  const loadLocalPlugin = async (directoryName: string): Promise<LoadedPlugin> => {
    if (!isSafePluginSlug(directoryName)) {
      throw new PluginValidationError(`Invalid local plugin directory name '${directoryName}'.`);
    }

    try {
      const realPluginDir = await resolveExistingPathWithinRoot(localPluginsRoot, directoryName);
      const manifestPath = await resolveExistingPathWithinRoot(realPluginDir, "manifest.json");
      const manifestText = await readFile(manifestPath, "utf8");
      const manifestRaw: unknown = JSON.parse(manifestText);
      const manifest = parsePluginManifest(manifestRaw);
      const normalizedEntry = normalizeRelativeFilePath(manifest.entry);
      const entryFilePath = await resolveExistingPathWithinRoot(realPluginDir, normalizedEntry);
      const files = await collectLocalPluginFiles(realPluginDir, maxBundleBytes);
      const bundleHash = computeBundleHash(manifest, files);

      return {
        origin: "local",
        directoryName,
        pluginDir: realPluginDir,
        entryFilePath,
        manifest,
        bundleHash,
      };
    } catch (error) {
      throw formatManifestError(error);
    }
  };

  const listLocalPlugins = async (): Promise<LoadedPlugin[]> => {
    let entries: string[];

    try {
      entries = await readdir(localPluginsRoot);
    } catch {
      return [];
    }

    const loaded: LoadedPlugin[] = [];

    for (const entryName of entries.sort()) {
      if (!isSafePluginSlug(entryName)) {
        continue;
      }

      try {
        const info = await stat(resolve(localPluginsRoot, entryName));

        if (!info.isDirectory()) {
          continue;
        }

        const plugin = await loadLocalPlugin(entryName);

        loaded.push(plugin);
      } catch {
        continue;
      }
    }

    return loaded;
  };

  const installUploadedPlugin = async (
    slug: string,
    manifestRaw: unknown,
    files: UploadedPluginFile[],
  ): Promise<LoadedPlugin> => {
    if (!isSafePluginSlug(slug)) {
      throw new PluginValidationError(`Invalid plugin slug '${slug}'.`);
    }

    let manifest: ReturnType<typeof parsePluginManifest>;

    try {
      manifest = parsePluginManifest(manifestRaw);
    } catch (error) {
      throw formatManifestError(error);
    }

    if (files.length === 0 || files.length > MAX_UPLOADED_FILES) {
      throw new PluginValidationError(
        `Plugin bundle must contain between 1 and ${MAX_UPLOADED_FILES} files.`,
      );
    }

    const normalizedEntry = normalizeRelativeFilePath(manifest.entry);
    const normalizedFiles: UploadedPluginFile[] = [];
    const seenPaths = new Set<string>();
    let totalBytes = 0;

    for (const file of files) {
      const normalizedPath = normalizeRelativeFilePath(file.path);

      if (normalizedPath === "manifest.json") {
        throw new PluginValidationError(
          "Do not include manifest.json inside files; pass it as manifest.",
        );
      }

      if (seenPaths.has(normalizedPath)) {
        throw new PluginValidationError(
          `Duplicate file path '${normalizedPath}' in plugin bundle.`,
        );
      }

      seenPaths.add(normalizedPath);
      totalBytes += Buffer.byteLength(file.content, "utf8");

      if (totalBytes > maxBundleBytes) {
        throw new PluginValidationError(
          `Plugin bundle exceeded maximum size of ${maxBundleBytes} bytes.`,
        );
      }

      normalizedFiles.push({ path: normalizedPath, content: file.content });
    }

    if (!seenPaths.has(normalizedEntry)) {
      throw new PluginValidationError(
        `Plugin bundle is missing declared entry file '${normalizedEntry}'.`,
      );
    }

    await mkdir(uploadedPluginsRoot, { recursive: true });

    const stagingDir = resolve(uploadedPluginsRoot, `.staging-${randomUUID()}`);
    const targetDir = resolvePathWithinRoot(uploadedPluginsRoot, slug);

    try {
      await mkdir(stagingDir, { recursive: true });
      await writeFile(
        resolvePathWithinRoot(stagingDir, "manifest.json"),
        JSON.stringify(manifest, null, 2),
        "utf8",
      );

      for (const file of normalizedFiles) {
        const dest = resolvePathWithinRoot(stagingDir, file.path);

        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, file.content, "utf8");
      }

      await rename(stagingDir, targetDir);
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true });

      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "EEXIST" || error.code === "ENOTEMPTY")
      ) {
        throw new PluginValidationError(`Plugin directory '${slug}' already exists.`);
      }

      throw new PluginValidationError("Failed to install plugin bundle.");
    }

    const realPluginDir = await resolveExistingPathWithinRoot(uploadedPluginsRoot, slug);
    const entryFilePath = await resolveExistingPathWithinRoot(realPluginDir, normalizedEntry);
    const bundleHash = computeBundleHash(manifest, normalizedFiles);

    return {
      origin: "uploaded",
      directoryName: slug,
      pluginDir: realPluginDir,
      entryFilePath,
      manifest,
      bundleHash,
    };
  };

  const removeUploadedPlugin = async (slug: string): Promise<void> => {
    if (!isSafePluginSlug(slug)) {
      return;
    }

    const targetDir = resolvePathWithinRoot(uploadedPluginsRoot, slug);

    await rm(targetDir, { recursive: true, force: true });
  };

  const executeTool = async (input: PluginExecutionInput): Promise<ToolExecutionResult> => {
    const rootDir = input.origin === "local" ? localPluginsRoot : uploadedPluginsRoot;

    return runPluginSubprocess({
      rootDir,
      directoryName: input.directoryName,
      entry: input.entry,
      handlerName: input.handlerName,
      args: input.args,
      requiredSecrets: input.requiredSecrets,
      secrets: input.secrets,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
    });
  };

  return {
    loadLocalPlugin,
    listLocalPlugins,
    installUploadedPlugin,
    removeUploadedPlugin,
    executeTool,
  };
};

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalizeJson, sha256Hex } from "@mux/core/canonical-json";
import { parsePluginManifest } from "@mux/core/manifest";
import type { ToolExecutionResult } from "@mux/core/types";
import {
  isSafePluginSlug,
  normalizeRelativeFilePath,
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

export const createPluginRuntime = (options: PluginRuntimeOptions): PluginRuntime => {
  const localPluginsRoot = resolve(options.localPluginsRoot);
  const uploadedPluginsRoot = resolve(options.uploadedPluginsRoot);
  const maxBundleBytes = options.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES;

  const loadLocalPlugin = async (directoryName: string): Promise<LoadedPlugin> => {
    if (!isSafePluginSlug(directoryName)) {
      throw new Error(`Invalid local plugin directory name '${directoryName}'.`);
    }

    const realPluginDir = await resolveExistingPathWithinRoot(localPluginsRoot, directoryName);
    const manifestPath = await resolveExistingPathWithinRoot(realPluginDir, "manifest.json");
    const manifestText = await readFile(manifestPath, "utf8");
    const manifestRaw: unknown = JSON.parse(manifestText);
    const manifest = parsePluginManifest(manifestRaw);
    const entryFilePath = await resolveExistingPathWithinRoot(realPluginDir, manifest.entry);
    const entryContent = await readFile(entryFilePath, "utf8");
    const bundleHash = computeBundleHash(manifest, [
      { path: normalizeRelativeFilePath(manifest.entry), content: entryContent },
    ]);

    return {
      origin: "local",
      directoryName,
      pluginDir: realPluginDir,
      entryFilePath,
      manifest,
      bundleHash,
    };
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
      throw new Error(`Invalid plugin slug '${slug}'.`);
    }

    const manifest = parsePluginManifest(manifestRaw);

    if (files.length === 0 || files.length > MAX_UPLOADED_FILES) {
      throw new Error(`Plugin bundle must contain between 1 and ${MAX_UPLOADED_FILES} files.`);
    }

    const normalizedEntry = normalizeRelativeFilePath(manifest.entry);
    const normalizedFiles: UploadedPluginFile[] = [];
    const seenPaths = new Set<string>();
    let totalBytes = 0;

    for (const file of files) {
      const normalizedPath = normalizeRelativeFilePath(file.path);

      if (normalizedPath === "manifest.json") {
        throw new Error("Do not include manifest.json inside files; pass it as manifest.");
      }

      if (seenPaths.has(normalizedPath)) {
        throw new Error(`Duplicate file path '${normalizedPath}' in plugin bundle.`);
      }

      seenPaths.add(normalizedPath);
      totalBytes += Buffer.byteLength(file.content, "utf8");

      if (totalBytes > maxBundleBytes) {
        throw new Error(`Plugin bundle exceeded maximum size of ${maxBundleBytes} bytes.`);
      }

      normalizedFiles.push({ path: normalizedPath, content: file.content });
    }

    if (!seenPaths.has(normalizedEntry)) {
      throw new Error(`Plugin bundle is missing declared entry file '${normalizedEntry}'.`);
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

      await rm(targetDir, { recursive: true, force: true });
      await rename(stagingDir, targetDir);
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true });
      throw error;
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

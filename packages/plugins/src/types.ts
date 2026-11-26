import type { PluginManifest } from "@mux/core/manifest";
import type { ToolExecutionResult } from "@mux/core/types";

export interface UploadedPluginFile {
  path: string;
  content: string;
}

export interface LoadedPlugin {
  origin: "local" | "uploaded";
  directoryName: string;
  pluginDir: string;
  entryFilePath: string;
  manifest: PluginManifest;
  bundleHash: string;
}

export interface PluginExecutionInput {
  origin: "local" | "uploaded";
  directoryName: string;
  entry: string;
  handlerName: string;
  args: Record<string, unknown>;
  requiredSecrets: string[];
  secrets?: Record<string, string>;
  timeoutMs: number;
}

export interface RunPluginSubprocessInput {
  rootDir: string;
  directoryName: string;
  entry: string;
  handlerName: string;
  args: Record<string, unknown>;
  requiredSecrets: string[];
  secrets?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export interface PluginRuntimeOptions {
  localPluginsRoot: string;
  uploadedPluginsRoot: string;
  maxBundleBytes?: number;
  maxOutputBytes?: number;
}

export interface PluginRuntime {
  loadLocalPlugin: (directoryName: string) => Promise<LoadedPlugin>;
  listLocalPlugins: () => Promise<LoadedPlugin[]>;
  installUploadedPlugin: (
    slug: string,
    manifestRaw: unknown,
    files: UploadedPluginFile[],
  ) => Promise<LoadedPlugin>;
  removeUploadedPlugin: (slug: string) => Promise<void>;
  executeTool: (input: PluginExecutionInput) => Promise<ToolExecutionResult>;
}

import { randomBytes } from "node:crypto";
import { isReservedSecretEnvName } from "@mux/core/manifest";
import type { ToolExecutionResult } from "@mux/core/types";
import { z } from "zod";
import {
  isSafePluginSlug,
  normalizeRelativeFilePath,
  PluginValidationError,
  resolveExistingPathWithinRoot,
} from "./path-safety";
import type { RunPluginSubprocessInput } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

const WORKER_SCRIPT = [
  'import { pathToFileURL } from "node:url";',
  'import { inspect } from "node:util";',
  "const writeProtocol = process.stdout.write.bind(process.stdout);",
  "const writeStderrRaw = process.stderr.write.bind(process.stderr);",
  "const formatStderr = (args) => args.map((item) => (typeof item === 'string' ? item : inspect(item, { depth: 4, breakLength: Infinity }))).join(' ');",
  "const logToStderr = (...args) => { writeStderrRaw(`${formatStderr(args)}\\n`); };",
  "process.stdout.write = (chunk, encoding, cb) => writeStderrRaw(chunk, encoding, cb);",
  "console.log = logToStderr;",
  "console.info = logToStderr;",
  "console.debug = logToStderr;",
  "console.warn = logToStderr;",
  'const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);',
  "const normalizeOutput = (output) => {",
  "  if (isPlainObject(output) && Array.isArray(output.content)) return output;",
  '  if (typeof output === "string") return { content: [{ type: "text", text: output }] };',
  '  if (isPlainObject(output)) return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };',
  '  return { content: [{ type: "text", text: JSON.stringify(output ?? null) }] };',
  "};",
  "let protocolPrefix = '';",
  "const emitAndExit = (payload, exitCode) => {",
  "  const line = `${protocolPrefix}${JSON.stringify(payload)}\\n`;",
  "  writeProtocol(line, () => process.exit(exitCode));",
  "};",
  "const main = async () => {",
  "  const rawInput = await new Response(Bun.stdin.stream()).text();",
  "  const payload = JSON.parse(rawInput);",
  "  protocolPrefix = payload.protocolPrefix;",
  "  const pluginEnv = Object.freeze({ ...payload.secrets });",
  "  const loaded = await import(pathToFileURL(payload.entryFilePath).href);",
  '  if (typeof loaded !== "object" || loaded === null || !Object.hasOwn(loaded, payload.handlerName)) {',
  "    throw new Error(`Plugin handler ${payload.handlerName} is not exported by entry module.`);",
  "  }",
  "  const candidate = loaded[payload.handlerName];",
  '  if (typeof candidate !== "function") {',
  "    throw new Error(`Plugin export ${payload.handlerName} is not a function.`);",
  "  }",
  "  const output = await candidate(payload.args, { env: pluginEnv });",
  "  emitAndExit({ ok: true, result: normalizeOutput(output) }, 0);",
  "};",
  "main().catch((err) => {",
  '  const message = err instanceof Error ? err.message : "Plugin execution failed.";',
  "  if (protocolPrefix.length > 0) {",
  "    emitAndExit({ ok: false, error: message }, 1);",
  "  } else {",
  "    writeStderrRaw(`${message}\\n`, () => process.exit(1));",
  "  }",
  "});",
].join("\n");

const contentBlockSchema = z.object({
  type: z.enum(["text", "image", "resource"]),
  text: z.string().optional(),
  data: z.string().optional(),
  mimeType: z.string().optional(),
  uri: z.string().optional(),
});

const toolResultSchema = z.object({
  content: z.array(contentBlockSchema),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  isError: z.boolean().optional(),
});

const workerEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: toolResultSchema,
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
  }),
]);

interface BoundedStreamResult {
  text: string;
  overflowed: boolean;
}

const readBoundedStream = async (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
  onOverflow: () => void,
): Promise<BoundedStreamResult> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflowed = false;

  const abortHandler = () => {
    void reader.cancel();
  };

  signal.addEventListener("abort", abortHandler, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value) {
        total += value.byteLength;

        if (total > maxBytes) {
          overflowed = true;
          onOverflow();
          await reader.cancel();
          break;
        }

        chunks.push(value);
      }
    }
  } catch {
    if (!signal.aborted && !overflowed) {
      return { text: "", overflowed: false };
    }
  } finally {
    signal.removeEventListener("abort", abortHandler);
  }

  if (overflowed) {
    return { text: "", overflowed: true };
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return {
    text: new TextDecoder().decode(combined),
    overflowed: false,
  };
};

const parseWorkerOutput = (
  stdoutText: string,
  protocolPrefix: string,
): z.infer<typeof workerEnvelopeSchema> | null => {
  const lines = stdoutText.split(/\r?\n/);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];

    if (line.startsWith(protocolPrefix)) {
      const jsonStr = line.slice(protocolPrefix.length);

      try {
        const parsed: unknown = JSON.parse(jsonStr);

        return workerEnvelopeSchema.parse(parsed);
      } catch {
        throw new Error("Plugin returned a malformed protocol response.");
      }
    }
  }

  return null;
};

const clampTimeoutMs = (raw: number): number => {
  if (!Number.isFinite(raw)) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(raw)));
};

export const runPluginSubprocess = async (
  input: RunPluginSubprocessInput,
): Promise<ToolExecutionResult> => {
  if (!isSafePluginSlug(input.directoryName)) {
    throw new PluginValidationError(`Invalid plugin directory name '${input.directoryName}'.`);
  }

  const normalizedEntry = normalizeRelativeFilePath(input.entry);
  const realPluginDir = await resolveExistingPathWithinRoot(input.rootDir, input.directoryName);
  const realEntryFile = await resolveExistingPathWithinRoot(realPluginDir, normalizedEntry);
  const timeoutMs = clampTimeoutMs(input.timeoutMs);
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const filteredSecrets: Record<string, string> = {};

  for (const secretKey of input.requiredSecrets) {
    if (isReservedSecretEnvName(secretKey)) {
      throw new PluginValidationError(
        `Secret '${secretKey}' is a reserved OS/runtime environment variable name.`,
      );
    }

    if (input.secrets && Object.hasOwn(input.secrets, secretKey)) {
      const secretVal = input.secrets[secretKey];

      if (typeof secretVal === "string") {
        filteredSecrets[secretKey] = secretVal;
      }
    }
  }

  const protocolPrefix = `__MUX_PLUGIN_${randomBytes(16).toString("hex")}__:`;
  const osEnv: Record<string, string> = {
    NODE_ENV: "production",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };

  const proc = Bun.spawn([process.execPath, "-e", WORKER_SCRIPT], {
    cwd: realPluginDir,
    env: osEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const abortController = new AbortController();
  let timedOut = false;
  let overflowed = false;
  let exited = false;

  const killChild = () => {
    if (!exited) {
      try {
        proc.kill("SIGKILL");
      } catch {
        void exited;
      }
    }
  };

  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
    killChild();
  }, timeoutMs);

  const onStreamOverflow = () => {
    overflowed = true;
    abortController.abort();
    killChild();
  };

  try {
    const payload = JSON.stringify({
      entryFilePath: realEntryFile,
      handlerName: input.handlerName,
      args: input.args,
      secrets: filteredSecrets,
      protocolPrefix,
    });

    const stdinWrite = (async () => {
      try {
        proc.stdin.write(payload);
        await proc.stdin.end();
      } catch {
        void exited;
      }
    })();

    const exitPromise = proc.exited.then((code) => {
      exited = true;

      return code;
    });

    const [stdoutRes, stderrRes, exitCode] = await Promise.all([
      readBoundedStream(proc.stdout, maxOutputBytes, abortController.signal, onStreamOverflow),
      readBoundedStream(proc.stderr, maxOutputBytes, abortController.signal, onStreamOverflow),
      exitPromise,
      stdinWrite,
    ]);

    if (timedOut) {
      throw new Error(`Plugin timed out after ${timeoutMs}ms.`);
    }

    if (overflowed || stdoutRes.overflowed || stderrRes.overflowed) {
      throw new Error(`Plugin output exceeded ${maxOutputBytes} bytes.`);
    }

    const envelope = parseWorkerOutput(stdoutRes.text, protocolPrefix);

    if (envelope) {
      if (!envelope.ok) {
        throw new Error(envelope.error);
      }

      return envelope.result;
    }

    const fallbackErr = stderrRes.text.trim().slice(0, 256);

    throw new Error(
      fallbackErr.length > 0
        ? `Plugin exited with code ${exitCode}: ${fallbackErr}`
        : `Plugin exited with code ${exitCode} without returning a result.`,
    );
  } finally {
    clearTimeout(timer);
    abortController.abort();
    killChild();
  }
};

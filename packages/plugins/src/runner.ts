import type { ToolExecutionResult } from "@mux/core/types";
import { z } from "zod";
import { isSafePluginSlug, resolveExistingPathWithinRoot } from "./path-safety";
import type { RunPluginSubprocessInput } from "./types";

const RESULT_PREFIX = "__MUX_PLUGIN_RESULT__:";
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

const WORKER_SCRIPT = [
  'import { pathToFileURL } from "node:url";',
  'const RESULT_PREFIX = "__MUX_PLUGIN_RESULT__:";',
  "const writeStderr = (args) => {",
  '  const line = args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" ");',
  "  process.stderr.write(`${line}\\n`);",
  "};",
  "console.log = (...args) => writeStderr(args);",
  "console.info = (...args) => writeStderr(args);",
  "console.debug = (...args) => writeStderr(args);",
  "console.warn = (...args) => writeStderr(args);",
  'const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);',
  "const normalizeOutput = (output) => {",
  "  if (isPlainObject(output) && Array.isArray(output.content)) return output;",
  '  if (typeof output === "string") return { content: [{ type: "text", text: output }] };',
  '  if (isPlainObject(output)) return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };',
  '  return { content: [{ type: "text", text: JSON.stringify(output ?? null) }] };',
  "};",
  "const emit = (payload) => process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(payload)}\\n`);",
  "const main = async () => {",
  "  const rawInput = await new Response(Bun.stdin.stream()).text();",
  "  const payload = JSON.parse(rawInput);",
  "  const loaded = await import(pathToFileURL(payload.entryFilePath).href);",
  '  if (typeof loaded !== "object" || loaded === null || !Object.hasOwn(loaded, payload.handlerName)) {',
  "    throw new Error(`Plugin handler ${payload.handlerName} is not exported by entry module.`);",
  "  }",
  "  const candidate = loaded[payload.handlerName];",
  '  if (typeof candidate !== "function") {',
  "    throw new Error(`Plugin export ${payload.handlerName} is not a function.`);",
  "  }",
  "  const output = await candidate(payload.args, { env: { ...process.env } });",
  "  emit({ ok: true, result: normalizeOutput(output) });",
  "};",
  "main().then(() => process.exit(0)).catch((err) => {",
  '  const message = err instanceof Error ? err.message : "Plugin execution failed.";',
  "  emit({ ok: false, error: message });",
  "  process.exit(1);",
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

const readBoundedStream = async (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onOverflow: () => void,
): Promise<string> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      total += value.byteLength;

      if (total > maxBytes) {
        onOverflow();
        await reader.cancel();
        throw new Error(`Plugin output exceeded ${maxBytes} bytes.`);
      }

      chunks.push(value);
    }
  }

  const combined = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(combined);
};

const parseWorkerOutput = (stdoutText: string): z.infer<typeof workerEnvelopeSchema> | null => {
  const lines = stdoutText.split(/\r?\n/);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];

    if (line.startsWith(RESULT_PREFIX)) {
      const jsonStr = line.slice(RESULT_PREFIX.length);
      const parsed: unknown = JSON.parse(jsonStr);

      return workerEnvelopeSchema.parse(parsed);
    }
  }

  return null;
};

export const runPluginSubprocess = async (
  input: RunPluginSubprocessInput,
): Promise<ToolExecutionResult> => {
  if (!isSafePluginSlug(input.directoryName)) {
    throw new Error(`Invalid plugin directory name '${input.directoryName}'.`);
  }

  const realPluginDir = await resolveExistingPathWithinRoot(input.rootDir, input.directoryName);
  const realEntryFile = await resolveExistingPathWithinRoot(realPluginDir, input.entry);
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(input.timeoutMs)));
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const scrubbedEnv: Record<string, string> = {
    NODE_ENV: "production",
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };

  if (input.secrets) {
    for (const secretKey of input.requiredSecrets) {
      const secretVal = input.secrets[secretKey];

      if (typeof secretVal === "string") {
        scrubbedEnv[secretKey] = secretVal;
      }
    }
  }

  const proc = Bun.spawn([process.execPath, "-e", WORKER_SCRIPT], {
    cwd: realPluginDir,
    env: scrubbedEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const payload = JSON.stringify({
    entryFilePath: realEntryFile,
    handlerName: input.handlerName,
    args: input.args,
  });

  proc.stdin.write(payload);
  await proc.stdin.end();

  let timedOut = false;
  let overflowed = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);

  const killOnOverflow = () => {
    overflowed = true;
    proc.kill("SIGKILL");
  };

  try {
    const [stdoutText, stderrText, exitCode] = await Promise.all([
      readBoundedStream(proc.stdout, maxOutputBytes, killOnOverflow),
      readBoundedStream(proc.stderr, maxOutputBytes, killOnOverflow),
      proc.exited,
    ]);

    if (timedOut) {
      throw new Error(`Plugin timed out after ${timeoutMs}ms.`);
    }

    if (overflowed) {
      throw new Error(`Plugin output exceeded ${maxOutputBytes} bytes.`);
    }

    const envelope = parseWorkerOutput(stdoutText);

    if (envelope) {
      if (!envelope.ok) {
        throw new Error(envelope.error);
      }

      return envelope.result;
    }

    const fallbackErr = stderrText.trim().slice(0, 256);

    throw new Error(
      fallbackErr.length > 0
        ? `Plugin exited with code ${exitCode}: ${fallbackErr}`
        : `Plugin exited with code ${exitCode} without returning a result.`,
    );
  } finally {
    clearTimeout(timer);
  }
};

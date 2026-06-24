import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { CodeIcon, ComputerTerminal01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardDescription, CardTitle } from "@repo/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";

type CodeSample = {
  value: string;
  label: string;
  language: string;
  code: string;
};

const BASE_URL_PLACEHOLDER = "__MUX_GATEWAY_BASE_URL__";

function getGatewayBaseUrl() {
  if (typeof window === "undefined") {
    return "http://localhost/api/v1";
  }

  return `${window.location.origin}/api/v1`;
}

const codeTheme = {
  'code[class*="language-"]': {
    color: "#d8d4cc",
    background: "transparent",
    textShadow: "none",
    fontFamily: "inherit",
  },
  'pre[class*="language-"]': {
    color: "#d8d4cc",
    background: "transparent",
    textShadow: "none",
    fontFamily: "inherit",
  },
  comment: { color: "#73716d" },
  prolog: { color: "#73716d" },
  doctype: { color: "#73716d" },
  cdata: { color: "#73716d" },
  punctuation: { color: "#a8a29a" },
  property: { color: "#d0b983" },
  tag: { color: "#d0b983" },
  boolean: { color: "#d0b983" },
  number: { color: "#d0b983" },
  constant: { color: "#d0b983" },
  symbol: { color: "#d0b983" },
  deleted: { color: "#d0b983" },
  selector: { color: "#9aaa7a" },
  "attr-name": { color: "#9aaa7a" },
  string: { color: "#9aaa7a" },
  char: { color: "#9aaa7a" },
  builtin: { color: "#9aaa7a" },
  inserted: { color: "#9aaa7a" },
  operator: { color: "#b9b5ad" },
  entity: { color: "#b9b5ad" },
  url: { color: "#b9b5ad" },
  atrule: { color: "#c6a978" },
  "attr-value": { color: "#c6a978" },
  keyword: { color: "#c6a978" },
  function: { color: "#cfcac0" },
  "class-name": { color: "#cfcac0" },
  regex: { color: "#b7a17b" },
  important: { color: "#b7a17b", fontWeight: "600" },
  variable: { color: "#d8d4cc" },
};

const setupSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "__MUX_GATEWAY_BASE_URL__",
  apiKey: "mux_live_xxxxxxxxxxxxxxxx",
});`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `from openai import OpenAI

client = OpenAI(
    base_url="__MUX_GATEWAY_BASE_URL__",
    api_key="mux_live_xxxxxxxxxxxxxxxx",
)`,
  },
  {
    value: "fetch",
    label: "TypeScript (fetch)",
    language: "typescript",
    code: `const response = await fetch("__MUX_GATEWAY_BASE_URL__/models", {
  headers: {
    Authorization: "Bearer mux_live_xxxxxxxxxxxxxxxx",
  },
});

const models = await response.json();`,
  },
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl __MUX_GATEWAY_BASE_URL__/models \\
  -H "Authorization: Bearer mux_live_xxxxxxxxxxxxxxxx"`,
  },
];

const modelSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const models = await client.models.list();

for (const model of models.data) {
  console.log(model.id);
}`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `models = client.models.list()

for model in models.data:
    print(model.id)`,
  },
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl __MUX_GATEWAY_BASE_URL__/models \\
  -H "Authorization: Bearer $MUX_API_KEY"`,
  },
];

const completionSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const response = await client.chat.completions.create({
  model: "openai:gpt-5.5",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ],
  temperature: 0.7,
  max_tokens: 1024,
});

console.log(response.choices[0].message.content);`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `response = client.chat.completions.create(
    model="openai:gpt-5.5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"},
    ],
    temperature=0.7,
    max_tokens=1024,
)

print(response.choices[0].message.content)`,
  },
  {
    value: "fetch",
    label: "TypeScript (fetch)",
    language: "typescript",
    code: `const response = await fetch("__MUX_GATEWAY_BASE_URL__/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer mux_live_xxxxxxxxxxxxxxxx",
  },
  body: JSON.stringify({
    model: "openai:gpt-5.5",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});`,
  },
];

const responseSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const response = await client.responses.create({
  model: "openai:gpt-4o",
  input: "Write a release note for Responses API support.",
});

console.log(response.output_text);`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `response = client.responses.create(
    model="openai:gpt-4o",
    input="Write a release note for Responses API support.",
)

print(response.output_text)`,
  },
  {
    value: "fetch",
    label: "TypeScript (fetch)",
    language: "typescript",
    code: `const response = await fetch("__MUX_GATEWAY_BASE_URL__/responses", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer mux_live_xxxxxxxxxxxxxxxx",
  },
  body: JSON.stringify({
    model: "openai:gpt-4o",
    input: "Write a release note for Responses API support.",
  }),
});

const body = await response.json();
console.log(body.id);`,
  },
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl __MUX_GATEWAY_BASE_URL__/responses \\
  -H "Authorization: Bearer $MUX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"openai:gpt-4o","input":"Write a release note for Responses API support."}'`,
  },
];

const responseRetrieveSamples: CodeSample[] = [
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl __MUX_GATEWAY_BASE_URL__/responses/resp_abc123 \\
  -H "Authorization: Bearer $MUX_API_KEY"`,
  },
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const response = await client.responses.retrieve("resp_abc123");
console.log(response.status);`,
  },
];

const responseDeleteSamples: CodeSample[] = [
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl -X DELETE __MUX_GATEWAY_BASE_URL__/responses/resp_abc123 \\
  -H "Authorization: Bearer $MUX_API_KEY"`,
  },
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const result = await client.responses.delete("resp_abc123");
console.log(result.deleted);`,
  },
];

const responseCancelSamples: CodeSample[] = [
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl -X POST __MUX_GATEWAY_BASE_URL__/responses/resp_abc123/cancel \\
  -H "Authorization: Bearer $MUX_API_KEY"`,
  },
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const result = await client.responses.cancel("resp_abc123");
console.log(result.status);`,
  },
];

const responseCompactSamples: CodeSample[] = [
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl __MUX_GATEWAY_BASE_URL__/responses/compact \\
  -H "Authorization: Bearer $MUX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
        "model": "openai:gpt-5.1-codex-max",
        "input": [
          { "role": "user", "content": "Create a simple landing page for a dog petting cafe." },
          { "role": "assistant", "content": "Below is a single file, ready-to-use landing page:..." }
        ]
      }'`,
  },
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const compacted = await client.responses.compact({
  model: "openai:gpt-5.1-codex-max",
  input: longInputItems,
});

const nextResponse = await client.responses.create({
  model: "openai:gpt-5.1-codex-max",
  input: [
    ...compacted.output,
    { role: "user", content: getNextUserInput() },
  ],
});`,
  },
];

const responseStreamingSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const stream = await client.responses.create({
  model: "openai:gpt-4o",
  input: "Draft a short incident summary.",
  stream: true,
});

for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }
}`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `stream = client.responses.create(
    model="openai:gpt-4o",
    input="Draft a short incident summary.",
    stream=True,
)

for event in stream:
    if event.type == "response.output_text.delta":
        print(event.delta, end="")`,
  },
];

const fallbackSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const response = await client.chat.completions.create({
  model: "mux:fast-chat",
  messages: [{ role: "user", content: "Hello!" }],
});`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `response = client.chat.completions.create(
    model="mux:fast-chat",
    messages=[{"role": "user", "content": "Hello!"}],
)`,
  },
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl __MUX_GATEWAY_BASE_URL__/chat/completions \\
  -H "Authorization: Bearer $MUX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"mux:fast-chat","messages":[{"role":"user","content":"Hello!"}]}'`,
  },
];

const streamingSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const stream = await client.chat.completions.create({
  model: "anthropic:claude-sonnet-4-6",
  messages: [{ role: "user", content: "Tell me a story" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `stream = client.chat.completions.create(
    model="anthropic:claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`,
  },
];

const errorSamples: CodeSample[] = [
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `import { AuthenticationError } from "openai";

try {
  const response = await client.chat.completions.create({ ... });
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error("Auth failed:", error.message);
  }
}`,
  },
  {
    value: "python",
    label: "Python",
    language: "python",
    code: `from openai import AuthenticationError

try:
    response = client.chat.completions.create(...)
except AuthenticationError as error:
    print(f"Auth failed: {error}")`,
  },
];

function CodeTabs({ samples }: { samples: CodeSample[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const gatewayBaseUrl = getGatewayBaseUrl();

  const resolveCode = (code: string) => code.replaceAll(BASE_URL_PLACEHOLDER, gatewayBaseUrl);

  const copySample = async (sample: CodeSample) => {
    await navigator.clipboard.writeText(resolveCode(sample.code));
    setCopied(sample.value);
    window.setTimeout(() => setCopied(null), 1400);
  };

  return (
    <Tabs defaultValue={samples[0]?.value} className="gap-4">
      <TabsList className="h-auto min-h-10 flex-wrap justify-start rounded-xl p-1.5">
        {samples.map((sample) => (
          <TabsTrigger
            key={sample.value}
            value={sample.value}
            className="flex-none rounded-lg px-5 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary/40 hover:text-foreground data-[state=active]:bg-secondary data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {sample.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {samples.map((sample) => (
        <TabsContent key={sample.value} value={sample.value} className="m-0">
          <div className="relative overflow-hidden rounded-lg border bg-[#181818] shadow-[0_0_0_2px_color-mix(in_oklab,var(--sidebar-border)_68%,black)] [&_code]:!bg-transparent [&_pre]:!bg-transparent [&_span]:!bg-transparent">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute top-3 right-3 z-10 text-muted-foreground hover:bg-white/5 hover:text-foreground"
              onClick={() => copySample(sample)}
            >
              <HugeiconsIcon icon={Copy01Icon} className="size-4" />
              {copied === sample.value ? "Copied" : "Copy"}
            </Button>
            <SyntaxHighlighter
              language={sample.language}
              style={codeTheme}
              customStyle={{
                margin: 0,
                background: "transparent",
                backgroundColor: "transparent",
                padding: "2rem 1.5rem",
                paddingRight: "6.5rem",
                fontSize: "0.875rem",
                lineHeight: 1.75,
              }}
              codeTagProps={{ className: "font-mono", style: { background: "transparent" } }}
            >
              {resolveCode(sample.code)}
            </SyntaxHighlighter>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-4 scroll-mt-24">
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold">{title}</h2>
      </div>
      <div className="grid gap-4 text-sm leading-6 text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

export function DocsPage() {
  const gatewayBaseUrl = getGatewayBaseUrl();

  return (
    <div className="grid gap-8">
      <Card className="overflow-hidden p-0">
        <div className="p-6 lg:p-8">
          <div className="grid max-w-3xl gap-4">
            <Badge variant="secondary" className="w-fit rounded-md">
              OpenAI-compatible gateway
            </Badge>
            <div className="grid gap-3">
              <h1 className="text-3xl font-semibold leading-tight text-balance md:text-4xl">
                API reference for routing LLM traffic through Mux Gateway
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Use one endpoint for OpenAI, Anthropic, Google Gemini, and Mistral. Requests stay
                compatible with OpenAI SDK clients and are logged with latency, token usage, and
                estimated cost.
              </p>
            </div>
            <div className="flex w-fit max-w-full items-center gap-3 rounded-lg border bg-background/50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <HugeiconsIcon icon={ComputerTerminal01Icon} className="size-4" />
                <span>Base URL</span>
              </div>
              <code className="min-w-0 truncate font-mono text-xs text-foreground">
                {gatewayBaseUrl}
              </code>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-8">
        <div className="grid w-full gap-8">
          <Section id="overview" title="Overview">
            <p>
              Mux Gateway is a self-hosted, unified API for LLM providers. It exposes an{" "}
              <strong>OpenAI-compatible</strong> endpoint so existing SDK clients work without a
              custom adapter.
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ["Unified route", "Send requests to one endpoint and let the gateway dispatch."],
                ["Normalized output", "Responses follow the OpenAI shape across providers."],
                ["Fallback groups", "Expose virtual models with ordered backup targets."],
                ["Request logs", "Track latency, tokens, cost, provider, and status code."],
              ].map(([title, description]) => (
                <Card key={title} className="gap-2 p-4">
                  <CardTitle className="text-sm">{title}</CardTitle>
                  <CardDescription className="text-xs leading-5">{description}</CardDescription>
                </Card>
              ))}
            </div>
          </Section>

          <Section id="setup" title="Setup">
            <p>
              Configure your SDK or HTTP client with the gateway base URL and a Mux API key. The key
              is sent as a bearer token for direct HTTP calls.
            </p>
            <CodeTabs samples={setupSamples} />
          </Section>

          <Section id="authentication" title="Authentication">
            <p>
              Create an API key from the{" "}
              <Link to="/api-keys" className="text-foreground">
                API keys
              </Link>{" "}
              page. Keys are <strong>hashed at rest</strong> and cached in Redis. Revoking a key
              takes effect immediately.
            </p>
            <Card className="gap-3 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <HugeiconsIcon icon={CodeIcon} className="size-4" />
                Environment variable
              </div>
              <CodeTabs
                samples={[
                  {
                    value: "bash",
                    label: "Bash",
                    language: "bash",
                    code: "export MUX_API_KEY=mux_live_xxxxxxxxxxxxxxxx",
                  },
                ]}
              />
            </Card>
          </Section>

          <Section id="list-models" title="List models">
            <p>
              Retrieve all enabled models across configured providers. Each model includes an{" "}
              <code>id</code> in <code>provider:model</code> format and an <code>owned_by</code>{" "}
              field matching the OpenAI format. Fallback groups appear as virtual{" "}
              <code>mux:&lt;group&gt;</code> models.
            </p>
            <CodeTabs samples={modelSamples} />
          </Section>

          <Section id="chat-completions" title="Chat completions">
            <p>
              Send a chat request using the full <code>provider:model</code> id from the model list.
              The gateway returns the same response shape whether OpenAI, Anthropic, Google, or
              Mistral handles the request.
            </p>
            <CodeTabs samples={completionSamples} />
          </Section>

          <Section id="responses" title="Responses API">
            <p>
              Use <code>POST /v1/responses</code> for OpenAI Responses-compatible requests. This
              surface accepts any direct provider model whose adapter advertises
              {" "}<code>responsesApi: true</code>{" "}(OpenAI and Azure Cognitive Services today),
              and any fallback group that includes at least one Responses-capable target. Both
              non-streaming and <code>stream: true</code> requests are supported.
            </p>
            <CodeTabs samples={responseSamples} />
            <div className="grid gap-2 rounded-md border p-4">
              <div className="text-sm font-medium text-foreground">Current support</div>
              <div className="grid gap-2">
                {[
                  "Direct provider models with responsesApi: true (OpenAI, Azure Cognitive Services).",
                  "Fallback groups whose first Responses-capable target is selected automatically.",
                  "Streaming Responses events are passed through unchanged from the upstream provider.",
                  "Background mode is not implemented yet. GET and DELETE lifecycle routes are routed to OpenAI today.",
                ].map((item) => (
                  <div key={item} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <CodeTabs samples={responseStreamingSamples} />
            <p>
              Retrieve a previously created response with <code>GET /v1/responses/{`{id}`}</code>.
              This is a pass-through to the upstream provider's Responses API; query params such
              as <code>include[]</code> and <code>include_obfuscation</code> are forwarded verbatim.
              Upstream errors are returned in OpenAI's{" "}
              <code>{`{ error: { message, type, param, code } }`}</code> shape with the original
              status code. The route is currently routed to the OpenAI provider; cross-provider
              retrieval (e.g. for an Azure-hosted response) is a follow-up.
            </p>
            <CodeTabs samples={responseRetrieveSamples} />
            <p>
              Delete a stored response with <code>DELETE /v1/responses/{`{id}`}</code>. Returns the
              OpenAI confirmation body (<code>{`{ id, object: "response", deleted: true }`}</code>)
              on success.
            </p>
            <CodeTabs samples={responseDeleteSamples} />
            <p>
              Cancel an in-progress response with{" "}
              <code>POST /v1/responses/{`{id}`}/cancel</code>. The gateway tries the OpenAI
              provider first and falls through to Azure Cognitive Services on a 404. The upstream
              response body is returned verbatim, including its <code>status</code> field
              (<code>cancelled</code> on success). Upstream errors are returned in OpenAI's{" "}
              <code>{`{ error: { message, type, param, code } }`}</code> shape with the original
              status code. Today this is a pass-through; Phase 7 will add Mux-side background
              execution and let the gateway cancel responses it owns.
            </p>
            <CodeTabs samples={responseCancelSamples} />
            <p>
              Compact a long input window with{" "}
              <code>POST /v1/responses/compact</code>. The endpoint takes <code>model</code>{" "}
              (required) and <code>input</code> (optional, string or array of input items) and
              returns a compacted window with a token-usage block. The gateway tries the resolved
              provider (and falls through to Azure Cognitive Services on a 404) and bills the
              call against the API key the same way <code>POST /v1/responses</code> does. Pass
              the returned <code>output</code> array into your next <code>POST /v1/responses</code>{" "}
              call verbatim; do not prune it.
            </p>
            <CodeTabs samples={responseCompactSamples} />
          </Section>

          <Section id="fallback-groups" title="Fallback groups">
            <p>
              Admins can create fallback groups from the{" "}
              <Link to="/fallback-groups" className="text-foreground">
                Fallbacks
              </Link>{" "}
              page. A group exposes a virtual <code>mux:&lt;group&gt;</code> model and tries its
              ordered provider/model targets until one succeeds. Streaming requests can fall back
              before the first chunk is sent; after streaming starts, provider errors are surfaced
              to the client.
            </p>
            <CodeTabs samples={fallbackSamples} />
          </Section>

          <Section id="streaming" title="Streaming">
            <p>
              Set <code>stream: true</code> in TypeScript or <code>stream=True</code> in Python to
              receive tokens as they are generated.
            </p>
            <CodeTabs samples={streamingSamples} />
          </Section>

          <Section id="errors" title="Errors">
            <p>
              The gateway returns standard HTTP status codes and the OpenAI SDK surfaces them as
              typed exceptions.
            </p>
            <div className="grid gap-2">
              {[
                ["401", "Missing or invalid API key."],
                ["403", "The API key is valid but has been revoked or disabled."],
                ["500", "Internal error. Check the gateway logs or contact your administrator."],
              ].map(([status, description]) => (
                <div
                  key={status}
                  className="grid grid-cols-[4rem_minmax(0,1fr)] rounded-md border p-3"
                >
                  <span className="font-mono text-sm font-medium text-foreground">{status}</span>
                  <span>{description}</span>
                </div>
              ))}
            </div>
            <CodeTabs samples={errorSamples} />
          </Section>
        </div>
      </div>
    </div>
  );
}

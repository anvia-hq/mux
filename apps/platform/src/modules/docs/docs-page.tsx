import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  CodeIcon,
  ComputerTerminal01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import { Card, CardDescription, CardTitle } from "@repo/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/tabs";
import { useCopyFeedback } from "../../lib/use-copy-feedback";

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

const responseInputItemsSamples: CodeSample[] = [
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl "__MUX_GATEWAY_BASE_URL__/responses/resp_abc123/input_items?include[]=file_search_call.results&limit=20" \\
  -H "Authorization: Bearer $MUX_API_KEY"`,
  },
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const page = await client.responses.inputItems.list("resp_abc123", {
  include: ["file_search_call.results"],
  limit: 20,
  order: "desc",
});

for (const item of page.data) {
  console.log(item.id, item.type);
}`,
  },
];

const responseInputTokensSamples: CodeSample[] = [
  {
    value: "curl",
    label: "cURL",
    language: "bash",
    code: `curl __MUX_GATEWAY_BASE_URL__/responses/input_tokens \\
  -H "Authorization: Bearer $MUX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
        "model": "openai:gpt-4o",
        "input": "Tell me a three sentence bedtime story about a unicorn."
      }'`,
  },
  {
    value: "typescript-sdk",
    label: "TypeScript SDK",
    language: "typescript",
    code: `const { input_tokens } = await client.responses.inputTokens.count({
  model: "openai:gpt-4o",
  input: prompt,
});

console.log(\`This prompt would cost about $\${(input_tokens / 1_000_000) * 2.5} on gpt-4o.\`);`,
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
  const { copiedId, copy } = useCopyFeedback();
  const gatewayBaseUrl = getGatewayBaseUrl();

  const resolveCode = (code: string) => code.replaceAll(BASE_URL_PLACEHOLDER, gatewayBaseUrl);

  const copySample = async (sample: CodeSample) => {
    await copy({
      value: resolveCode(sample.code),
      copiedId: docsSampleCopyId(sample.value),
      successMessage: "Code copied",
      errorMessage: "Could not copy code",
    });
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
              {copiedId === docsSampleCopyId(sample.value) ? "Copied" : "Copy"}
            </Button>
            <SyntaxHighlighter
              language={sample.language}
              style={codeTheme}
              customStyle={{
                margin: 0,
                background: "transparent",
                backgroundColor: "transparent",
                padding: "1.5rem",
                paddingRight: "6.5rem",
                fontSize: "0.875rem",
                lineHeight: 1.75,
              }}
              codeTagProps={{
                className: "font-mono",
                style: { background: "transparent", padding: 0, fontSize: "inherit" },
              }}
            >
              {resolveCode(sample.code)}
            </SyntaxHighlighter>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

function docsSampleCopyId(value: string) {
  return `docs-sample:${value}`;
}

const documentationNavigation = [
  {
    id: "getting-started",
    label: "Getting started",
    items: [
      { id: "overview", label: "Overview" },
      { id: "setup", label: "Setup" },
      { id: "authentication", label: "Authentication" },
    ],
  },
  {
    id: "api-reference",
    label: "API reference",
    items: [
      { id: "list-models", label: "List models" },
      { id: "chat-completions", label: "Chat completions" },
      { id: "responses", label: "Responses API" },
      { id: "fallback-groups", label: "Fallback groups" },
      { id: "streaming", label: "Streaming" },
      { id: "errors", label: "Errors" },
    ],
  },
  {
    id: "tool-integrations",
    label: "Tool integrations",
    items: [
      { id: "prerequisites", label: "Tool setup" },
      { id: "generic-openai-compatible", label: "Generic tools" },
      { id: "opencode", label: "OpenCode" },
      { id: "pi-agent", label: "Pi Agent" },
      { id: "claude-code", label: "Claude Code" },
      { id: "troubleshooting", label: "Troubleshooting" },
    ],
  },
] as const;

function DocumentationNavigationLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Documentation sections" className={`grid gap-5 ${className}`}>
      {documentationNavigation.map((group) => (
        <div key={group.id} className="grid gap-2">
          <a
            href={`#${group.id}`}
            className="text-sm font-medium text-foreground hover:underline hover:underline-offset-4"
          >
            {group.label}
          </a>
          <div className="grid gap-1 border-l pl-3">
            {group.items.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="py-0.5 text-sm leading-5 text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function DocumentationNavigation() {
  return (
    <>
      <Card className="gap-0 p-0 xl:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            On this page
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="border-t p-4">
            <DocumentationNavigationLinks className="sm:grid-cols-3" />
          </div>
        </details>
      </Card>
      <Card className="hidden gap-5 p-4 xl:flex">
        <div className="text-sm font-semibold">On this page</div>
        <DocumentationNavigationLinks />
      </Card>
    </>
  );
}

function DocumentationGroup({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="grid gap-8 scroll-mt-24">
      <div className="grid gap-2 border-b pb-5">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="grid gap-4 scroll-mt-24">
      <div className="grid gap-1">
        <h3 className="text-xl font-semibold">{title}</h3>
      </div>
      <div className="grid gap-4 text-sm leading-6 text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

function ServiceDocumentationContent() {
  return (
    <>
      <DocumentationGroup
        id="getting-started"
        title="Getting started"
        description="Connect an SDK or HTTP client, create an API key, and send traffic through the gateway."
      >
        <div className="grid gap-8">
          <Section id="overview" title="Overview">
            <p>
              Mux Gateway is a self-hosted, unified API for LLM providers. It exposes an{" "}
              <strong>OpenAI-compatible</strong> endpoint so existing SDK clients work without a
              custom adapter.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["Unified route", "Send requests to one endpoint and let the gateway dispatch."],
                ["Normalized output", "Responses follow the OpenAI shape across providers."],
                ["Fallback groups", "Expose virtual models with ordered backup targets."],
                [
                  "Request logs",
                  "Track per-attempt provider latency, tokens, cost, provider, and status code.",
                ],
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
        </div>
      </DocumentationGroup>

      <DocumentationGroup
        id="api-reference"
        title="API reference"
        description="Use OpenAI-compatible endpoints for model discovery, generation, streaming, and resilient provider routing."
      >
        <div className="grid gap-8">
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
              surface accepts native Responses providers, chat-converted providers, and fallback
              groups that include an eligible target. OpenAI and Azure Cognitive Services use native
              transport; Google uses chat conversion. Custom providers can explicitly enable either
              mode from the Providers page. Both non-streaming and <code>stream: true</code>{" "}
              requests are supported.
            </p>
            <CodeTabs samples={responseSamples} />
            <div className="grid gap-2 rounded-md border p-4">
              <div className="text-sm font-medium text-foreground">Current support</div>
              <div className="grid gap-2">
                {[
                  "Native transport for OpenAI, Azure Cognitive Services, and explicitly configured custom providers.",
                  "Stateless Responses requests can be translated through Google or a custom chat-completions provider.",
                  "Fallback groups use the configured priority and weight, with retryable failures moving to another eligible target.",
                  "Native streams pass through unchanged; chat streams are converted into Responses lifecycle events.",
                  "Background mode requires native creation and retrieval support; spend is reserved until the worker reaches a terminal status.",
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
              Locally tracked background responses are returned from Mux first; other ids are
              retrieved from the upstream provider's Responses API. Query params such as{" "}
              <code>include[]</code> and <code>include_obfuscation</code> are forwarded verbatim.
              Upstream errors are sanitized and returned in OpenAI's{" "}
              <code>{`{ error: { message, type, param, code } }`}</code> shape with the original
              status code and a request id.
            </p>
            <CodeTabs samples={responseRetrieveSamples} />
            <p>
              Delete a stored response with <code>DELETE /v1/responses/{`{id}`}</code>. Returns the
              OpenAI confirmation body (<code>{`{ id, object: "response", deleted: true }`}</code>)
              on success.
            </p>
            <CodeTabs samples={responseDeleteSamples} />
            <p>
              Cancel an in-progress response with <code>POST /v1/responses/{`{id}`}/cancel</code>.
              For locally tracked background responses, the gateway updates the local job and calls
              the owning provider when it exposes cancellation. Other ids fall through across OpenAI
              and Azure Cognitive Services on 404. Upstream errors are returned in OpenAI's{" "}
              <code>{`{ error: { message, type, param, code } }`}</code> shape with the original
              status code.
            </p>
            <CodeTabs samples={responseCancelSamples} />
            <p>
              Compact a long input window with <code>POST /v1/responses/compact</code>. The endpoint
              takes <code>model</code> (required) and <code>input</code> (optional, string or array
              of input items) and returns a compacted window with a token-usage block. The gateway
              tries native compaction-capable targets from the resolved model or fallback group and
              can fail over before a response is returned. Spend-limited keys reserve the maximum
              liability before the upstream call and settle from actual usage. Pass the returned{" "}
              <code>output</code> array into your next <code>POST /v1/responses</code> call
              verbatim; do not prune it.
            </p>
            <CodeTabs samples={responseCompactSamples} />
            <p>
              List the input items that produced a response with{" "}
              <code>GET /v1/responses/{`{id}`}/input_items</code>. The gateway forwards all query
              params (<code>after</code>, <code>include[]</code>, <code>limit</code>,
              <code>order</code>) verbatim to the upstream provider, tries OpenAI first, and falls
              through to Azure Cognitive Services on a 404. Upstream errors are returned in OpenAI's{" "}
              <code>{`{ error: { message, type, param, code } }`}</code> shape with the original
              status code.
            </p>
            <CodeTabs samples={responseInputItemsSamples} />
            <p>
              Estimate how many input tokens a prompt will consume with{" "}
              <code>POST /v1/responses/input_tokens</code>. The body shape matches{" "}
              <code>POST /v1/responses</code> (model, input, optional instructions and tools) and
              the response is <code>{`{ object: "response.input_tokens", input_tokens }`}</code>.
              The gateway uses native input-token support on eligible targets from the resolved
              model or fallback group. This is a free dry-run; the call does not bill the API key.
            </p>
            <CodeTabs samples={responseInputTokensSamples} />
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
      </DocumentationGroup>
    </>
  );
}

const harnessEnvSamples: CodeSample[] = [
  {
    value: "bash",
    label: "Bash",
    language: "bash",
    code: `export MUX_API_KEY=mux_live_xxxxxxxxxxxxxxxx
export MUX_BASE_URL=__MUX_GATEWAY_BASE_URL__
export MUX_MODEL=mux:fast-chat`,
  },
  {
    value: "fish",
    label: "Fish",
    language: "bash",
    code: `set -gx MUX_API_KEY mux_live_xxxxxxxxxxxxxxxx
set -gx MUX_BASE_URL __MUX_GATEWAY_BASE_URL__
set -gx MUX_MODEL mux:fast-chat`,
  },
];

const genericOpenAiHarnessSamples: CodeSample[] = [
  {
    value: "bash",
    label: "Env vars",
    language: "bash",
    code: `export OPENAI_API_KEY="$MUX_API_KEY"
export OPENAI_BASE_URL="$MUX_BASE_URL"`,
  },
  {
    value: "curl",
    label: "Smoke test",
    language: "bash",
    code: `curl "$MUX_BASE_URL/models" \\
  -H "Authorization: Bearer $MUX_API_KEY"`,
  },
];

const openCodeSamples: CodeSample[] = [
  {
    value: "json",
    label: "opencode.json",
    language: "json",
    code: `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "mux": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Mux Gateway",
      "options": {
        "baseURL": "__MUX_GATEWAY_BASE_URL__",
        "apiKey": "{env:MUX_API_KEY}"
      },
      "models": {
        "mux:fast-chat": {
          "name": "Mux Fast Chat"
        }
      }
    }
  }
}`,
  },
  {
    value: "bash",
    label: "Connect",
    language: "bash",
    code: `export MUX_API_KEY=mux_live_xxxxxxxxxxxxxxxx
opencode

# Run /connect, choose Other, use mux as the provider id, then paste the Mux API key.`,
  },
];

const piAgentSamples: CodeSample[] = [
  {
    value: "json",
    label: "models.json",
    language: "json",
    code: `{
  "providers": {
    "mux": {
      "baseUrl": "__MUX_GATEWAY_BASE_URL__",
      "api": "openai-completions",
      "apiKey": "$MUX_API_KEY",
      "authHeader": true,
      "models": [
        {
          "id": "mux:fast-chat",
          "name": "Mux Fast Chat",
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 32000
        }
      ]
    }
  }
}`,
  },
  {
    value: "bash",
    label: "Env vars",
    language: "bash",
    code: `export MUX_API_KEY=mux_live_xxxxxxxxxxxxxxxx
export MUX_BASE_URL=__MUX_GATEWAY_BASE_URL__

# Put the provider config in your Pi models.json, then select mux:fast-chat.`,
  },
];

const claudeCodeSamples: CodeSample[] = [
  {
    value: "bash",
    label: "Compatible proxy",
    language: "bash",
    code: `export ANTHROPIC_BASE_URL=https://your-anthropic-compatible-gateway.example.com
export ANTHROPIC_AUTH_TOKEN="$MUX_API_KEY"
claude`,
  },
];

function ToolIntegrationDocumentation() {
  const gatewayBaseUrl = getGatewayBaseUrl();

  return (
    <DocumentationGroup
      id="tool-integrations"
      title="Tool integrations"
      description="Connect coding agents and other tools that support custom OpenAI-compatible providers."
    >
      <div className="grid gap-8">
        <Section id="prerequisites" title="Tool setup">
          <p>
            Create or reveal a key from the{" "}
            <Link to="/api-keys" className="text-foreground">
              API keys
            </Link>{" "}
            page, then choose a model id from{" "}
            <Link to="/models" className="text-foreground">
              Models
            </Link>
            . The examples use <code>mux:fast-chat</code>, but any enabled direct model or fallback
            group can be used.
          </p>
          <CodeTabs samples={harnessEnvSamples} />
        </Section>

        <Section id="generic-openai-compatible" title="Generic OpenAI-compatible tools">
          <p>
            Most harnesses that support custom OpenAI-compatible providers only need the Mux base
            URL, bearer token, and model id. The base URL should include <code>/api/v1</code>.
          </p>
          <CodeTabs samples={genericOpenAiHarnessSamples} />
        </Section>

        <Section id="opencode" title="OpenCode">
          <p>
            OpenCode supports custom providers backed by the OpenAI-compatible AI SDK provider.
            Configure Mux as a provider, map the model ids you want users to select, and keep the
            key in <code>MUX_API_KEY</code>.
          </p>
          <CodeTabs samples={openCodeSamples} />
        </Section>

        <Section id="pi-agent" title="Pi Agent">
          <p>
            Pi Agent can use a custom provider entry with <code>openai-completions</code>. Use{" "}
            <code>openai-responses</code> only for models and workflows that you have verified
            against the Responses API.
          </p>
          <CodeTabs samples={piAgentSamples} />
        </Section>

        <Section id="claude-code" title="Claude Code">
          <Alert>
            <AlertTitle>Anthropic-compatible adapter required</AlertTitle>
            <AlertDescription>
              <p>
                Claude Code expects an Anthropic-compatible Messages API. Do not point it directly
                at <code>{gatewayBaseUrl}</code>; place a compatible adapter in front of Mux first.
              </p>
            </AlertDescription>
          </Alert>
          <CodeTabs samples={claudeCodeSamples} />
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <div className="grid gap-2">
            {[
              ["401", "The API key is missing, revoked, or pasted into the wrong env var."],
              [
                "404 model",
                "Use the exact model id shown on the Models page, including provider or mux prefix.",
              ],
              [
                "Wrong base URL",
                "OpenAI-compatible tools should use the Mux base URL ending in /api/v1.",
              ],
              [
                "Streaming",
                "Confirm the selected harness and upstream model both support streaming.",
              ],
            ].map(([status, description]) => (
              <div
                key={status}
                className="grid grid-cols-[7rem_minmax(0,1fr)] rounded-md border p-3"
              >
                <span className="font-mono text-sm font-medium text-foreground">{status}</span>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </DocumentationGroup>
  );
}

export function DocumentationPage() {
  const gatewayBaseUrl = getGatewayBaseUrl();

  return (
    <div className="grid w-full gap-8">
      <Card className="overflow-hidden p-0">
        <div className="p-6 lg:p-8">
          <div className="grid max-w-3xl gap-4">
            <Badge variant="secondary" className="w-fit rounded-md">
              OpenAI-compatible gateway
            </Badge>
            <div className="grid gap-3">
              <h1 className="text-3xl font-semibold leading-tight text-balance md:text-4xl">
                Mux Gateway documentation
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                Connect clients, route models across providers, and configure coding tools through
                one OpenAI-compatible gateway.
              </p>
            </div>
            <div className="flex w-fit max-w-full items-center gap-3 rounded-lg border bg-background/50 px-3 py-2 text-sm">
              <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
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

      <div className="grid items-start gap-8 xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-12">
        <div className="order-2 grid min-w-0 gap-14">
          <ServiceDocumentationContent />
          <ToolIntegrationDocumentation />
        </div>
        <aside className="order-1 xl:sticky xl:top-0">
          <DocumentationNavigation />
        </aside>
      </div>
    </div>
  );
}

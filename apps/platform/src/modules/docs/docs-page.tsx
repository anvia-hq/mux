import { Link } from "@tanstack/react-router";

const sections = [
  { id: "overview", label: "Overview" },
  { id: "setup", label: "Setup" },
  { id: "authentication", label: "Authentication" },
  { id: "list-models", label: "List Models" },
  { id: "chat-completions", label: "Chat Completions" },
  { id: "streaming", label: "Streaming" },
  { id: "errors", label: "Errors" },
] as const;

function Code({ children, lang }: { children: string; lang?: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-muted px-4 py-3 text-xs leading-relaxed">
      {lang ? <div className="mb-1 text-[10px] text-muted-foreground/50">{lang}</div> : null}
      <code>{children}</code>
    </pre>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="grid gap-3 scroll-mt-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="text-sm text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
        {children}
      </div>
    </section>
  );
}

export function DocsPage() {
  return (
    <div className="grid gap-8">
      <div>
        <h1 className="text-2xl font-semibold">API Reference</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you need to start using the Mux LLM Gateway.
        </p>
      </div>

      <nav>
        <ul className="flex flex-wrap gap-3">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid gap-10">
        <Section id="overview" title="Overview">
          <p>
            Mux Gateway is a self-hosted, unified API for LLM providers. It exposes an{" "}
            <strong>OpenAI-compatible</strong> endpoint so any OpenAI SDK client works out of the
            box. Under the hood it routes requests to OpenAI, Anthropic, Google Gemini, and Mistral,
            normalizing all responses back to the OpenAI format.
          </p>
          <p>
            Every request is <strong>logged</strong> with latency, token usage, and estimated cost —
            no need for separate monitoring.
          </p>
        </Section>

        <Section id="setup" title="Setup">
          <p>
            The gateway runs at <code>http://localhost</code> when deployed via Docker Compose.
            Configure the OpenAI SDK with the gateway base URL and your API key:
          </p>
          <Code lang="python">{`from openai import OpenAI

client = OpenAI(
    base_url="http://localhost/v1",
    api_key="mux_live_xxxxxxxxxxxxxxxx",
)`}</Code>
          <Code lang="js">{`import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost/v1",
  apiKey: "mux_live_xxxxxxxxxxxxxxxx",
});`}</Code>
        </Section>

        <Section id="authentication" title="Authentication">
          <p>
            Create an API key from the{" "}
            <Link to="/api-keys" className="underline underline-offset-4">
              API keys
            </Link>{" "}
            page (admin only). Keys are <strong>hashed at rest</strong> and cached in Redis.
            Revoking a key takes effect immediately.
          </p>
          <p className="mt-2">
            Pass the key when initializing the client (shown above), or set the{" "}
            <code>MUX_API_KEY</code> environment variable:
          </p>
          <Code lang="bash">export MUX_API_KEY=mux_live_xxxxxxxxxxxxxxxx</Code>
        </Section>

        <Section id="list-models" title="List Models">
          <p>Retrieve all available (enabled) models across every configured provider:</p>
          <Code lang="python">{`models = client.models.list()
for model in models.data:
    print(model.id)  # e.g. "gpt-5.5", "claude-opus-4-8"`}</Code>
          <Code lang="js">{`const models = await client.models.list();
models.data.forEach(m => console.log(m.id));`}</Code>
          <p className="mt-2">
            Every model in the response has an <code>id</code> and <code>owned_by</code> field
            matching the OpenAI format.
          </p>
        </Section>

        <Section id="chat-completions" title="Chat Completions">
          <p>
            Send a chat request using any model id from the models list. The response follows the
            OpenAI format regardless of which provider (OpenAI, Anthropic, Google, Mistral) handles
            it:
          </p>
          <Code lang="python">{`response = client.chat.completions.create(
    model="gpt-5.5",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Hello!"},
    ],
    temperature=0.7,
    max_tokens=1024,
)

print(response.choices[0].message.content)`}</Code>
          <Code lang="js">{`const response = await client.chat.completions.create({
  model: "gpt-5.5",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello!" },
  ],
  temperature: 0.7,
  max_tokens: 1024,
});

console.log(response.choices[0].message.content);`}</Code>
          <p className="mt-2">
            Response object includes <code>usage</code> (prompt_tokens, completion_tokens,
            total_tokens) and a standard <code>choices</code> array.
          </p>
        </Section>

        <Section id="streaming" title="Streaming">
          <p>
            Set <code>stream: True</code> (Python) or <code>stream: true</code> (JS) to receive
            tokens as they are generated:
          </p>
          <Code lang="python">{`stream = client.chat.completions.create(
    model="claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`}</Code>
          <Code lang="js">{`const stream = await client.chat.completions.create({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: "Tell me a story" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}`}</Code>
        </Section>

        <Section id="errors" title="Errors">
          <p>The gateway returns standard HTTP status codes:</p>
          <div className="mt-2 grid gap-2">
            <div>
              <span className="font-mono font-medium">401</span> — Missing or invalid API key.
            </div>
            <div>
              <span className="font-mono font-medium">403</span> — The API key is valid but has been
              revoked or disabled.
            </div>
            <div>
              <span className="font-mono font-medium">500</span> — Internal error. Check the gateway
              logs or contact your administrator.
            </div>
          </div>
          <p className="mt-2">The OpenAI SDK surfaces these as typed exceptions:</p>
          <Code lang="python">{`from openai import AuthenticationError

try:
    response = client.chat.completions.create(...)
except AuthenticationError as e:
    print(f"Auth failed: {e}")`}</Code>
          <Code lang="js">{`import { AuthenticationError } from "openai";

try {
  const response = await client.chat.completions.create({...});
} catch (e) {
  if (e instanceof AuthenticationError) {
    console.error("Auth failed:", e.message);
  }
}`}</Code>
        </Section>
      </div>
    </div>
  );
}

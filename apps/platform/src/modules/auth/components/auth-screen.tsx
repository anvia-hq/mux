import { Button } from "@mux/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mux/ui/card";
import { Field } from "@mux/ui/field";
import { Form } from "@mux/ui/form";
import { Input } from "@mux/ui/input";
import { IconPlugConnected } from "@tabler/icons-react";
import { useState, type FormEvent } from "react";
import { useSession } from "../hooks/use-session";

export function AuthScreen() {
  const { signIn, signUp } = useSession();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const activeMutation = mode === "sign-in" ? signIn : signUp;
  let submitLabel = mode === "sign-in" ? "Sign in" : "Create account";

  if (activeMutation.isPending) {
    submitLabel = "Working...";
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    try {
      if (mode === "sign-in") {
        await signIn.mutateAsync({ email, password });
      } else {
        await signUp.mutateAsync({ name, email, password });
      }
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Authentication failed.");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <IconPlugConnected size={20} stroke={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Mux</h1>
            <p className="text-xs text-muted-foreground">
              MCP &amp; Code Plugin Gateway with Redis Tool Caching
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{mode === "sign-in" ? "Sign in to Mux" : "Create account"}</CardTitle>
            <CardDescription>
              {mode === "sign-in"
                ? "Enter your workspace credentials to manage MCPs, plugins, and endpoints."
                : "The first account created in this workspace is automatically assigned admin."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form onSubmit={handleSubmit} className="space-y-4">
              {mode === "sign-up" ? (
                <Field label="Name">
                  <Input
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ada Lovelace"
                  />
                </Field>
              ) : null}

              <Field label="Email">
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                />
              </Field>

              <Field label="Password" hint="Minimum 8 characters">
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
              </Field>

              {localError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {localError}
                </div>
              ) : null}

              <Button type="submit" disabled={activeMutation.isPending} className="w-full">
                {submitLabel}
              </Button>
            </Form>

            <div className="mt-4 border-t border-border pt-4 text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLocalError(null);
                  setMode(mode === "sign-in" ? "sign-up" : "sign-in");
                }}
              >
                {mode === "sign-in"
                  ? "Need an account? Sign up"
                  : "Already have an account? Sign in"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

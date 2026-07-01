import { Button } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Copy01Icon, Key01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useCopyFeedback } from "../../../lib/use-copy-feedback";
import { onboardingStatusQueryOptions, useRegisterMutation } from "../hooks/use-auth";
import type { RegisterResponse } from "../types";

export function RegisterForm() {
  const initialInvitationCode = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return new URLSearchParams(window.location.search).get("code") ?? "";
  }, []);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState(initialInvitationCode);
  const [createdApiKey, setCreatedApiKey] = useState<RegisterResponse["apiKey"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { copiedId, copy } = useCopyFeedback();
  const onboardingStatus = useQuery(onboardingStatusQueryOptions);
  const registerMutation = useRegisterMutation();
  const inviteRegistrationEnabled = onboardingStatus.data?.inviteRegistrationEnabled ?? true;

  if (!inviteRegistrationEnabled) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Registration is closed</CardTitle>
          <CardDescription>Invite-code registration is currently disabled.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild type="button" variant="outline">
            <Link to="/login">Back to login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (createdApiKey) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Save this API key</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Use this key to call the gateway. You can copy it again from API keys.
          </p>
          <div className="rounded-md border bg-muted/30 p-3">
            <code className="block break-all text-xs">{createdApiKey.key}</code>
          </div>
          <p className="text-sm text-muted-foreground">
            Balance: {formatApiKeyBalance(createdApiKey.spendLimitUsd)}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                copy({
                  value: createdApiKey.key,
                  copiedId: registeredApiKeyCopyId(createdApiKey.id),
                  successMessage: "API key copied",
                  errorMessage: "Could not copy API key",
                })
              }
            >
              <HugeiconsIcon icon={Copy01Icon} className="size-4" />
              {copiedId === registeredApiKeyCopyId(createdApiKey.id) ? "Copied" : "Copy"}
            </Button>
            <Button asChild>
              <Link to="/">
                <HugeiconsIcon icon={Key01Icon} className="size-4" />
                Continue
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Create user account</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            registerMutation.mutate(
              { name, email, password, invitationCode },
              {
                onSuccess: (data) => {
                  setCreatedApiKey(data.apiKey);
                },
                onError: (error) => {
                  setError(error instanceof Error ? error.message : "Registration failed.");
                },
              },
            );
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              autoComplete="name"
              placeholder="Jane Doe"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="jane@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              placeholder="Create a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="invitation-code">Invitation code</Label>
            <Input
              id="invitation-code"
              autoComplete="off"
              placeholder="MUX-AB12-CD34-EF56-7890"
              value={invitationCode}
              onChange={(event) => setInvitationCode(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={registerMutation.isPending}>
            {registerMutation.isPending ? "Creating..." : "Register"}
          </Button>
          <Button asChild type="button" variant="link">
            <Link to="/login">Already have an account?</Link>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function formatApiKeyBalance(spendLimitUsd: number | null) {
  return spendLimitUsd === null ? "Unlimited" : `$${spendLimitUsd.toFixed(2)}`;
}

function registeredApiKeyCopyId(id: string) {
  return `registered-api-key:${id}`;
}

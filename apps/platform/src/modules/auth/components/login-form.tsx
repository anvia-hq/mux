import { Button } from "@repo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { onboardingStatusQueryOptions, useLoginMutation } from "../hooks/use-auth";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const onboardingStatus = useQuery(onboardingStatusQueryOptions);
  const loginMutation = useLoginMutation();
  const inviteRegistrationEnabled = onboardingStatus.data?.inviteRegistrationEnabled ?? true;

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Platform login</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            loginMutation.mutate(
              { email, password },
              {
                onError: (error) => {
                  setError(error instanceof Error ? error.message : "Authentication failed.");
                },
              },
            );
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Logging in..." : "Login"}
          </Button>
          {inviteRegistrationEnabled ? (
            <Button asChild type="button" variant="link">
              <Link to="/register">Create account with invite code</Link>
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

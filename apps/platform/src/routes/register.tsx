import { createFileRoute } from "@tanstack/react-router";
import { AuthPageShell } from "../modules/auth/components/auth-page-shell";
import { RegisterForm } from "../modules/auth/components/register-form";

export const Route = createFileRoute("/register")({
  component: RegisterRoute,
});

function RegisterRoute() {
  return (
    <AuthPageShell>
      <RegisterForm />
    </AuthPageShell>
  );
}

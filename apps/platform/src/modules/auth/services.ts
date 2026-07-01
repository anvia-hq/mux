import { apiFetch, UnauthorizedError } from "../../lib/api-client";
import { authApiPaths } from "./schema";
import type { AuthResponse, AuthUser, LoginInput, RegisterInput, RegisterResponse } from "./types";

export { UnauthorizedError };

export async function getCurrentUser(): Promise<AuthUser> {
  try {
    const data = await apiFetch<AuthResponse>(authApiPaths.me);
    return data.user;
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    throw error;
  }
}

export async function login(input: LoginInput): Promise<AuthUser> {
  const data = await apiFetch<AuthResponse>(authApiPaths.login, { method: "POST", body: input });
  return data.user;
}

export async function register(input: RegisterInput): Promise<RegisterResponse> {
  return apiFetch<RegisterResponse>(authApiPaths.register, {
    method: "POST",
    body: input,
  });
}

export async function logout(): Promise<void> {
  await apiFetch<{ ok: true }>(authApiPaths.logout, { method: "POST" });
}

export async function onboardingStatus(): Promise<{ needsOnboarding: boolean }> {
  return apiFetch<{ needsOnboarding: boolean }>("/auth/onboarding-status");
}

export async function onboard(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthUser> {
  const data = await apiFetch<AuthResponse>("/auth/onboard", { method: "POST", body: input });
  return data.user;
}

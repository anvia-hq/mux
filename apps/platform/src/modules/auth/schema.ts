export const authQueryKey = ["auth"] as const;

export const authApiPaths = {
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
  register: "/auth/register",
  onboard: "/auth/onboard",
  onboardingStatus: "/auth/onboarding-status",
} as const;

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "USER";
  spendLimitUsd: number | null;
  createdAt: string;
  updatedAt: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = {
  email: string;
  password: string;
  name?: string;
  invitationCode: string;
};

export type AuthResponse = {
  user: AuthUser;
  error?: string;
};

export type RegisterResponse = AuthResponse & {
  apiKey: {
    id: string;
    key: string;
    spendLimitUsd: number | null;
  };
};

export type OnboardingStatus = {
  needsOnboarding: boolean;
  inviteRegistrationEnabled: boolean;
};

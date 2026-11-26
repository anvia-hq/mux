import type { UserRole } from "@mux/core/types";
import type { Database } from "@mux/db";
import { schema } from "@mux/db/schema";
import { users } from "@mux/db/schema/users";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface SessionResolver {
  getSessionUser: (headers: Headers) => Promise<AuthenticatedUser | null>;
}

export interface AuthConfig {
  db: Database;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
}

const toUserRole = (value: unknown): UserRole => (value === "admin" ? "admin" : "member");

export const createAuth = (config: AuthConfig) => {
  const instance = betterAuth({
    database: drizzleAdapter(config.db, {
      provider: "pg",
      schema,
      usePlural: true,
    }),
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "member",
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const existing = await config.db.select({ id: users.id }).from(users).limit(1);
            const assignedRole: UserRole = existing.length === 0 ? "admin" : "member";

            return {
              data: {
                ...user,
                role: assignedRole,
              },
            };
          },
        },
      },
    },
  });

  const sessionResolver: SessionResolver = {
    getSessionUser: async (headers: Headers): Promise<AuthenticatedUser | null> => {
      const session = await instance.api.getSession({ headers });

      if (!session?.user) {
        return null;
      }

      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: toUserRole(session.user.role),
      };
    },
  };

  return {
    handler: instance.handler,
    api: instance.api,
    sessionResolver,
  };
};

export type AuthInstance = ReturnType<typeof createAuth>;

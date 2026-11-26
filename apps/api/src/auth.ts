import type { UserRole } from "@mux/core/types";
import type { Database } from "@mux/db";
import { schema } from "@mux/db/schema";
import { users } from "@mux/db/schema/users";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, sql } from "drizzle-orm";

export const ADMIN_ROLE_LOCK_ID = 738_192_041;

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
  claimInitialAdmin?: (userId: string) => Promise<boolean>;
}

const toUserRole = (value: unknown): UserRole => (value === "admin" ? "admin" : "member");

export const createBootstrapAdminClaimer =
  (db: Database) =>
  async (userId: string): Promise<boolean> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_ROLE_LOCK_ID})`);

      const existingAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);

      if (existingAdmins.length > 0) {
        return false;
      }

      const promoted = await tx
        .update(users)
        .set({ role: "admin", updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.role, "member")))
        .returning({ id: users.id });

      return promoted.length > 0;
    });

export const createUserCreationHooks = (
  claimInitialAdmin: (userId: string) => Promise<boolean>,
) => ({
  before: async <T extends Record<string, unknown>>(user: T) => ({
    data: {
      ...user,
      role: "member" as const,
    },
  }),
  after: async (user: { id: string }) => {
    await claimInitialAdmin(user.id);
  },
});

export const createAuth = (config: AuthConfig) => {
  const claimInitialAdmin = config.claimInitialAdmin ?? createBootstrapAdminClaimer(config.db);
  const userHooks = createUserCreationHooks(claimInitialAdmin);

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
        create: userHooks,
      },
    },
  });

  const sessionCache = new WeakMap<Headers, Promise<AuthenticatedUser | null>>();

  const sessionResolver: SessionResolver = {
    getSessionUser: (headers: Headers): Promise<AuthenticatedUser | null> => {
      const cached = sessionCache.get(headers);

      if (cached) {
        return cached;
      }

      const pending = instance.api.getSession({ headers }).then((session) => {
        if (!session?.user) {
          return null;
        }

        return {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: toUserRole(session.user.role),
        };
      });

      sessionCache.set(headers, pending);

      return pending;
    },
  };

  return {
    handler: instance.handler,
    api: instance.api,
    sessionResolver,
  };
};

export type AuthInstance = ReturnType<typeof createAuth>;

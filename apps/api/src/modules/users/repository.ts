import type { UserRole } from "@mux/core/types";
import type { Database } from "@mux/db";
import { users } from "@mux/db/schema/users";
import { asc, count, eq } from "drizzle-orm";
import type { UserRecord, UsersRepository } from "./types";

export const createDrizzleUsersRepository = (db: Database): UsersRepository => ({
  list: async (): Promise<UserRecord[]> => db.select().from(users).orderBy(asc(users.createdAt)),

  findById: async (id: string): Promise<UserRecord | null> => {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);

    return rows[0] ?? null;
  },

  countByRole: async (role: UserRole): Promise<number> => {
    const rows = await db.select({ total: count() }).from(users).where(eq(users.role, role));

    return Number(rows[0]?.total ?? 0);
  },

  updateRole: async (id: string, role: UserRole): Promise<UserRecord | null> => {
    const rows = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();

    return rows[0] ?? null;
  },
});

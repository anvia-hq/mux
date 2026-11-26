import type { UserRole } from "@mux/core/types";
import type { Database } from "@mux/db";
import { users } from "@mux/db/schema/users";
import { asc, count, eq, sql } from "drizzle-orm";
import { ADMIN_ROLE_LOCK_ID } from "../../auth";
import type { UpdateUserRoleOutcome, UserRecord, UsersRepository } from "./types";

export const createDrizzleUsersRepository = (db: Database): UsersRepository => ({
  list: async (): Promise<UserRecord[]> => db.select().from(users).orderBy(asc(users.createdAt)),

  updateRoleAtomic: async (id: string, role: UserRole): Promise<UpdateUserRoleOutcome> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADMIN_ROLE_LOCK_ID})`);

      const existingRows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
      const existing = existingRows[0];

      if (!existing) {
        return { status: "not_found" };
      }

      if (existing.role === role) {
        return { status: "updated", user: existing };
      }

      if (existing.role === "admin" && role === "member") {
        const countRows = await tx
          .select({ total: count() })
          .from(users)
          .where(eq(users.role, "admin"));

        if (Number(countRows[0]?.total ?? 0) <= 1) {
          return { status: "last_admin" };
        }
      }

      const updatedRows = await tx
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      const updated = updatedRows[0];

      if (!updated) {
        return { status: "not_found" };
      }

      return { status: "updated", user: updated };
    }),
});

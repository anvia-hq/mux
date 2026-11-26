import type { UserRole } from "@mux/core/types";
import { NotFoundError, UnprocessableError } from "../../errors";
import type { UserRecord, UsersRepository, UsersService } from "./types";

export const createUsersService = (repo: UsersRepository): UsersService => ({
  listUsers: async (): Promise<UserRecord[]> => repo.list(),

  getUserById: async (id: string): Promise<UserRecord> => {
    const user = await repo.findById(id);

    if (!user) {
      throw new NotFoundError("User not found.");
    }

    return user;
  },

  updateUserRole: async (id: string, role: UserRole): Promise<UserRecord> => {
    const existing = await repo.findById(id);

    if (!existing) {
      throw new NotFoundError("User not found.");
    }

    if (existing.role === role) {
      return existing;
    }

    if (existing.role === "admin" && role === "member") {
      const adminCount = await repo.countByRole("admin");

      if (adminCount <= 1) {
        throw new UnprocessableError("Cannot demote the last remaining admin.");
      }
    }

    const updated = await repo.updateRole(id, role);

    if (!updated) {
      throw new NotFoundError("User not found.");
    }

    return updated;
  },
});

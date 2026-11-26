import type { UserRole } from "@mux/core/types";
import { NotFoundError, UnprocessableError } from "../../errors";
import type { UserRecord, UsersRepository, UsersService } from "./types";

export const createUsersService = (repo: UsersRepository): UsersService => ({
  listUsers: async (): Promise<UserRecord[]> => repo.list(),

  updateUserRole: async (id: string, role: UserRole): Promise<UserRecord> => {
    const outcome = await repo.updateRoleAtomic(id, role);

    if (outcome.status === "not_found") {
      throw new NotFoundError("User not found.");
    }

    if (outcome.status === "last_admin") {
      throw new UnprocessableError("Cannot demote the last remaining admin.");
    }

    return outcome.user;
  },
});

import type { UserRole } from "@mux/core/types";
import type { SessionResolver } from "../../auth";

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsersRepository {
  list: () => Promise<UserRecord[]>;
  findById: (id: string) => Promise<UserRecord | null>;
  countByRole: (role: UserRole) => Promise<number>;
  updateRole: (id: string, role: UserRole) => Promise<UserRecord | null>;
}

export interface UsersService {
  listUsers: () => Promise<UserRecord[]>;
  getUserById: (id: string) => Promise<UserRecord>;
  updateUserRole: (id: string, role: UserRole) => Promise<UserRecord>;
}

export interface UsersRouterDeps {
  sessionResolver: SessionResolver;
  usersService: UsersService;
}

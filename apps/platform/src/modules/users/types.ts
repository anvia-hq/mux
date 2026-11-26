import type { UserRole } from "@mux/core/types";

export interface WorkspaceUserItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

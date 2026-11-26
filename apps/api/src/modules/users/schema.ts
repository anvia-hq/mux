import { z } from "zod";

export const userIdParamSchema = z.object({
  id: z.string().min(1),
});

export const updateUserRoleBodySchema = z.object({
  role: z.enum(["admin", "member"]),
});

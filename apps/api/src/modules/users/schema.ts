import { z } from "zod";

export const usersQuerySchema = z.object({});

export const promoteUserParamsSchema = z.object({
  id: z.string().min(1),
});

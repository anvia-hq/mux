import { prisma } from "../../utils/prisma";
import { sanitizeUser } from "../auth/utils";

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });

  return users.map(sanitizeUser);
}

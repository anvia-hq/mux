import { prisma } from "../../utils/prisma";
import { sanitizeUser } from "../auth/utils";

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });

  return users.map(sanitizeUser);
}

export async function promoteUserToAdmin(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    return null;
  }

  if (user.role === "ADMIN") {
    return sanitizeUser(user);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { role: "ADMIN" },
  });

  return sanitizeUser(updated);
}

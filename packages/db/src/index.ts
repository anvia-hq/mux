import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

export const createDatabase = (url: string) => {
  const client = postgres(url);
  const db = drizzle(client, { schema });

  return { client, db };
};

export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = DatabaseConnection["db"];

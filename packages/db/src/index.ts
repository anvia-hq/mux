import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/mux";

export const client = postgres(url);
export const db = drizzle(client, { schema });
export type Database = typeof db;

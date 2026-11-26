import { Elysia } from "elysia";

export const app = new Elysia()
  .get("/", () => ({ name: "mux-api" }))
  .get("/health", () => ({ ok: true }))
  .listen(Number(process.env.PORT ?? 3000));

console.log(`api listening on ${app.server?.url}`);

import { createApp } from "./app";
import { createComposition } from "./composition";

const composition = createComposition();

export const app = createApp(composition).listen(composition.config.PORT);

const handleShutdown = async (): Promise<void> => {
  await app.stop();
  await composition.shutdown();
  process.exit(0);
};

process.on("SIGINT", () => {
  void handleShutdown();
});

process.on("SIGTERM", () => {
  void handleShutdown();
});

console.log(`api listening on ${app.server?.url}`);

export type { App } from "./app";

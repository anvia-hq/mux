import { createApp } from "./app";
import { createComposition } from "./composition";

const composition = createComposition();

export const app = createApp(composition).listen(composition.config.PORT);

let shutdownPromise: Promise<void> | null = null;

const handleShutdown = (): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    let failed = false;

    try {
      await app.stop();
    } catch (error) {
      failed = true;
      console.error("Failed to stop HTTP server:", error);
    }

    try {
      await composition.shutdown();
    } catch (error) {
      failed = true;
      console.error("Failed to shut down API dependencies:", error);
    }

    process.exit(failed ? 1 : 0);
  })();

  return shutdownPromise;
};

process.on("SIGINT", () => {
  void handleShutdown();
});

process.on("SIGTERM", () => {
  void handleShutdown();
});

console.log(`api listening on ${app.server?.url}`);

export type { App } from "./app";

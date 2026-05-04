import { logger, task } from "@trigger.dev/sdk/v3";

/**
 * Hello-world task — sanity check that the Trigger.dev pipeline is wired.
 * Run with `npm run trigger:dev`, then trigger from the dashboard or CLI.
 * Delete this file once the real engagement-loop task is verified.
 */
export const hello = task({
  id: "hello",
  run: async (payload: { name?: string }) => {
    const name = payload.name ?? "world";
    logger.info(`Hello, ${name}`);
    return { greeting: `Hello, ${name}`, at: new Date().toISOString() };
  },
});

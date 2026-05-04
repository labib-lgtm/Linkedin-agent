import { defineConfig } from "@trigger.dev/sdk/v3";

/**
 * Trigger.dev v3 project config.
 *
 * 1. Create a project at https://cloud.trigger.dev (or self-host).
 * 2. Copy the project ref (proj_xxxx) and paste below.
 * 3. Run `npm run trigger:login` once to authenticate the CLI.
 * 4. Run `npm run trigger:dev` to start local dev. Tasks are auto-discovered
 *    from the `trigger/` directory.
 */
export default defineConfig({
  project: "REPLACE_WITH_YOUR_TRIGGER_DEV_PROJECT_REF",
  runtime: "node",
  logLevel: "log",
  // Default max duration for any task (seconds). The CTA comment-response task
  // overrides this to 4h since it sleeps for 3h between touches.
  maxDuration: 300,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  dirs: ["./trigger"],
});

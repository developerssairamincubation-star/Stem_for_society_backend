/**
 * Sentry for the API. Imported before anything else in index.ts.
 *
 * Order matters: the SDK patches http, express and the pg driver as they are
 * required, so anything loaded ahead of this file is never instrumented.
 *
 * Inert without SENTRY_DSN. That is deliberate - a developer running the API
 * locally, or a deploy where the variable has not been set yet, gets a working
 * server rather than a crash or a stream of failed reporting calls.
 *
 * The DSN belongs to a Node project, not the browser one: platform, grouping
 * and quota are all per-project, so events from here must not be sent to the
 * React DSN.
 */
import "dotenv/config";
import * as Sentry from "@sentry/node";
import { isDevelopmentEnv } from "./utils/env";

const dsn = process.env.SENTRY_DSN;

/**
 * The configured production sample rate, or 10% when it is unset or not a
 * number between 0 and 1. `Number("")` is 0, so an empty variable in a
 * dashboard would otherwise switch tracing off without a word.
 */
function productionTracesSampleRate(): number {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE?.trim();
  const rate = raw ? Number(raw) : NaN;
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.1;
}

if (dsn) {
  /**
   * Same rule as utils/env: NODE_ENV is not set on the deployed API, so an
   * unset value means production. `||` rather than `??` so that an empty
   * SENTRY_ENVIRONMENT= line falls through instead of tagging events "".
   */
  const isDevelopment = isDevelopmentEnv();
  const environment =
    process.env.SENTRY_ENVIRONMENT?.trim() ||
    (isDevelopment ? process.env.NODE_ENV!.trim().toLowerCase() : "production");

  Sentry.init({
    dsn,
    environment,
    // Render sets RENDER_GIT_COMMIT on every deploy, so events are tied to a
    // commit even when nobody remembers to fill in SENTRY_RELEASE.
    release:
      process.env.SENTRY_RELEASE?.trim() ||
      process.env.RENDER_GIT_COMMIT?.trim() ||
      undefined,

    /**
     * Full traces while developing, a sample everywhere else. Every request to
     * a public API would otherwise be a transaction, which exhausts the quota
     * long before it becomes useful.
     */
    tracesSampleRate: isDevelopment ? 1.0 : productionTracesSampleRate(),

    /**
     * Local variables make a stack trace worth reading, but they also capture
     * whatever was in scope - passwords, tokens, request bodies. On only for an
     * explicit development/test run; sendDefaultPii stays off everywhere.
     */
    includeLocalVariables: isDevelopment,
    sendDefaultPii: false,

    /**
     * Last line of defence before an event leaves the process. The frontend
     * scrubs its own events the same way; this covers headers and query
     * strings that the SDK attaches automatically.
     */
    beforeSend(event) {
      const headers = event.request?.headers;
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (/^(authorization|cookie|x-api-key|apikey)$/i.test(key)) {
            headers[key] = "[redacted]";
          }
        }
      }
      if (event.request?.query_string) {
        event.request.query_string = "[redacted]";
      }
      // Never ship a request body: sign-in posts arrive here with a password.
      if (event.request?.data) {
        event.request.data = "[redacted]";
      }
      /**
       * A drizzle query error's message ends with every bound parameter
       * ("params: a@b.com,98..."). The SQL above it is parameterised and worth
       * keeping; the values are customer data.
       */
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) {
          exception.value = exception.value.replace(/\nparams: [\s\S]*$/, "\nparams: [redacted]");
        }
      }
      return event;
    },
  });

  console.log(`[sentry] reporting enabled (environment=${environment})`);
} else {
  console.log(
    "[sentry] SENTRY_DSN is not set - error reporting is disabled for this process.",
  );
}

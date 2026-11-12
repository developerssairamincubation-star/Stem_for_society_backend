import * as Sentry from "@sentry/node";
import { asDatabaseError } from "./dbError";

/**
 * Reports an error that a handler caught and answered with a 5xx itself.
 *
 * Those errors never reach Sentry's Express handler - the handler has already
 * responded - and debugLog is silent in production, so until now they left no
 * trace anywhere. Call this in the catch block, before the response.
 *
 * Sentry does nothing when SENTRY_DSN is unset, so this is safe locally and in
 * tests. instrument.ts scrubs query parameters out of the event it sends.
 */
export function reportServerError(error: unknown, handler: string): void {
  Sentry.captureException(error, { tags: { handler } });
  console.error(`[${handler}] ${describeError(error)}`);
}

/**
 * For errors a library returns rather than throws, such as Supabase storage's
 * `{ error }`. That error's stack starts inside the library, so the event would
 * not say which handler hit it; this one starts at the caller, and Sentry still
 * shows the original as the linked `cause`.
 */
export function wrapReturnedError(error: unknown, what: string): Error {
  const detail =
    error instanceof Error ? error.message.split("\n", 1)[0] : String(error);
  const wrapped = new Error(`${what}: ${detail}`, { cause: error });
  Error.captureStackTrace(wrapped, wrapReturnedError);
  return wrapped;
}

/**
 * One line that is safe for production logs (SFS-12): the error's name and
 * the first line of its message, never the object itself. A drizzle query
 * error carries every bound parameter - emails, phone numbers, hashes - on the
 * second line of its message, so the driver error underneath is preferred.
 */
export function describeError(error: unknown): string {
  const source = asDatabaseError(error) ?? error;
  if (!(source instanceof Error)) return `non-Error thrown (${typeof source})`;
  const firstLine = source.message.split("\n", 1)[0].slice(0, 300);
  return `${source.name}: ${firstLine}`;
}

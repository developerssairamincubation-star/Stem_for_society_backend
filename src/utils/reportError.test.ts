import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

import * as Sentry from "@sentry/node";
import { DatabaseError } from "pg";
import {
  describeError,
  reportServerError,
  wrapReturnedError,
} from "./reportError";

/** The shape drizzle >= 0.44 throws: bound values on the second line. */
function drizzleQueryError(cause?: unknown): Error {
  const error = new Error(
    'Failed query: insert into "user" ("email") values ($1)\nparams: someone@example.com,9876543210',
  );
  error.name = "DrizzleQueryError";
  (error as { cause?: unknown }).cause = cause;
  return error;
}

describe("describeError", () => {
  it("never includes a drizzle error's bound parameters", () => {
    const line = describeError(drizzleQueryError());
    expect(line).toBe(
      'DrizzleQueryError: Failed query: insert into "user" ("email") values ($1)',
    );
    expect(line).not.toContain("someone@example.com");
  });

  it("prefers the driver error underneath a drizzle error", () => {
    const cause = new DatabaseError(
      'relation "user" does not exist',
      0,
      "error",
    );
    expect(describeError(drizzleQueryError(cause))).toBe(
      'error: relation "user" does not exist',
    );
  });

  it("handles values that are not Errors", () => {
    expect(describeError("boom")).toBe("non-Error thrown (string)");
    expect(describeError(undefined)).toBe("non-Error thrown (undefined)");
  });
});

describe("reportServerError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("captures the error tagged with the handler and logs one safe line", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = drizzleQueryError();

    reportServerError(error, "signIn");

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { handler: "signIn" },
    });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]).toHaveLength(1);
    expect(log.mock.calls[0][0]).toMatch(/^\[signIn\] DrizzleQueryError: /);
    expect(log.mock.calls[0][0]).not.toContain("someone@example.com");
  });
});

describe("wrapReturnedError", () => {
  it("keeps the original as cause and starts the stack at the caller", () => {
    const storageError = new Error("The resource already exists\nmore detail");
    storageError.name = "StorageApiError";

    const wrapped = wrapReturnedError(storageError, "Logo upload failed");

    expect(wrapped.message).toBe(
      "Logo upload failed: The resource already exists",
    );
    expect(wrapped.cause).toBe(storageError);
    expect(wrapped.stack).not.toContain("wrapReturnedError");
    expect(wrapped.stack).toContain("reportError.test.ts");
  });

  it("accepts a value that is not an Error", () => {
    expect(wrapReturnedError("nope", "Upload failed").message).toBe(
      "Upload failed: nope",
    );
  });
});

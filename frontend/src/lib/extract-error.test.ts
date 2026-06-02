import { describe, expect, it } from "vitest";

import { extractError } from "@/lib/extract-error";

describe("extractError", () => {
  it("returns the message of an Error instance", () => {
    expect(extractError(new Error("boom"))).toBe("boom");
  });

  it("returns message from a Supabase-style error object", () => {
    const err = { message: "boom", details: "more info", hint: "try again" };
    expect(extractError(err)).toBe("boom");
  });

  it("falls back to details when message is missing", () => {
    const err = { details: "constraint violation" };
    expect(extractError(err)).toBe("constraint violation");
  });

  it("falls back to hint when only hint is present", () => {
    const err = { hint: "did you forget the where clause?" };
    expect(extractError(err)).toBe("did you forget the where clause?");
  });

  it("returns error_description for OAuth-style errors", () => {
    const err = { error_description: "invalid_grant" };
    expect(extractError(err)).toBe("invalid_grant");
  });

  it("returns JSON.stringify for plain objects with no recognized fields", () => {
    const err = { foo: "bar", baz: 1 };
    expect(extractError(err)).toBe(JSON.stringify(err));
  });

  it("returns a string error as-is", () => {
    expect(extractError("oops")).toBe("oops");
  });

  it("returns 'Unknown error' for null", () => {
    expect(extractError(null)).toBe("Unknown error");
  });

  it("returns 'Unknown error' for undefined", () => {
    expect(extractError(undefined)).toBe("Unknown error");
  });

  it("returns 'Unknown error' for a number", () => {
    expect(extractError(42)).toBe("Unknown error");
  });
});

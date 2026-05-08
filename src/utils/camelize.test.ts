import { describe, expect, it } from "vitest";
import { camelize } from "./camelize.js";

describe("camelize", () => {
  it("returns null and undefined unchanged", () => {
    expect(camelize(null)).toBeNull();
    expect(camelize(undefined)).toBeUndefined();
  });

  it("camelizes object keys recursively", () => {
    expect(camelize({ outer_key: { inner_key: 1 } })).toEqual({
      outerKey: { innerKey: 1 },
    });
  });

  it("camelizes arrays of objects", () => {
    expect(camelize([{ pet_name: "Fido" }, { pet_name: "Max" }])).toEqual([
      { petName: "Fido" },
      { petName: "Max" },
    ]);
  });

  it("handles multiple underscores in a key", () => {
    expect(camelize({ foo_bar_baz: 1 })).toEqual({ fooBarBaz: 1 });
  });

  it("leaves already-camelCase keys unchanged", () => {
    expect(camelize({ petName: "Fido" })).toEqual({ petName: "Fido" });
  });

  it("passes through primitive values unchanged", () => {
    expect(camelize(42 as never)).toBe(42);
    expect(camelize("hello" as never)).toBe("hello");
  });
});

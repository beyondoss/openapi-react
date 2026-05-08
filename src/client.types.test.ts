import { describe, it } from "vitest";
import { createClient, type Input } from "./client.js";

/**
 * Recursively flattens intersections (`A & B`, `A & {}`) into a single object
 * shape. `openapi-fetch`'s body types carry a vestigial `& {}` from `Writable<>`
 * which would otherwise make naive structural equality fail.
 */
type Normalize<T> = T extends object ? { [K in keyof T]: Normalize<T[K]> } : T;

/**
 * Type-level equality after normalization. Resolves to the literal `true` only
 * when `A` and `B` are mutually assignable; produces a compile error otherwise.
 */
type Equal<A, B> = (<T>() => T extends Normalize<A> ? 1 : 2) extends
  <T>() => T extends Normalize<B> ? 1 : 2 ? true : false;

// Type-only assertion: passes at runtime; the work happens in `tsc`.
function assert<T extends true>(): T {
  return true as T;
}

// Reproduces the shape `openapi-typescript` emits for an operation with
// no request body and no parameters: instead of omitting the keys, it
// stamps every absent key as `?: never`. This is the default output and is
// what downstream callers (e.g. `@beyond.dev/auth`) feed into the library.
type OpenApiTypescriptPaths = {
  // No request body, no parameters at all (e.g. `DELETE /v1/sessions/current`).
  "/no-body-no-params": {
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        204: { content: { "application/json": Record<string, never> } };
      };
    };
  };
  // No request body, has path parameters (e.g. `DELETE /v1/orgs/{id}`).
  "/no-body-with-params": {
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: { id: string };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        204: { content: { "application/json": Record<string, never> } };
      };
    };
  };
  // Has request body and parameters (the typical POST/PATCH).
  "/with-body-and-params": {
    post: {
      parameters: {
        query?: never;
        header?: never;
        path: { id: string };
        cookie?: never;
      };
      requestBody: {
        content: { "application/json": { name: string } };
      };
      responses: {
        201: { content: { "application/json": { id: string } } };
      };
    };
  };
  // No parameters but has request body.
  "/with-body-no-params": {
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: { "application/json": { name: string } };
      };
      responses: {
        201: { content: { "application/json": { id: string } } };
      };
    };
  };
};

describe("Input — openapi-typescript shape (`requestBody?: never`)", () => {
  it("op with no body and no params requires no input", () => {
    type Actual = Input<OpenApiTypescriptPaths, "/no-body-no-params", "delete">;
    type Expected = {};
    // Run typecheck and inspect the error to see the actual shape:
    // reveal<{ actual: Actual }>({ actual: {} as never });
    assert<Equal<Actual, Expected>>();
  });

  it("op with no body but with path params requires only the params", () => {
    type Actual = Input<
      OpenApiTypescriptPaths,
      "/no-body-with-params",
      "delete"
    >;
    type Expected = { input: { path: { id: string } } };
    assert<Equal<Actual, Expected>>();
  });

  it("op with body and path params requires both", () => {
    type Actual = Input<
      OpenApiTypescriptPaths,
      "/with-body-and-params",
      "post"
    >;
    type Expected = { input: { path: { id: string }; body: { name: string } } };
    assert<Equal<Actual, Expected>>();
  });

  it("op with body and no params requires only the body", () => {
    type Actual = Input<
      OpenApiTypescriptPaths,
      "/with-body-no-params",
      "post"
    >;
    type Expected = { input: { body: { name: string } } };
    assert<Equal<Actual, Expected>>();
  });
});

// End-to-end: a default `createClient` exposes wire shapes untouched on every
// hook/method. If the generic plumbing breaks at any layer (createClient →
// ClientOptions → UseLoaderResult → Data), one of these will fail.
describe("End-to-end client surface", () => {
  type WireUser = {
    user_id: string;
    primary_email: string;
    org: { org_id: string; org_slug: string };
  };
  type WireSignInBody = {
    grant_type: "password";
    email: string;
    password: string;
  };
  type Paths = {
    "/users/me": {
      get: {
        parameters: {
          query?: never;
          header?: never;
          path?: never;
          cookie?: never;
        };
        requestBody?: never;
        responses: { 200: { content: { "application/json": WireUser } } };
      };
    };
    "/sessions": {
      post: {
        parameters: {
          query?: never;
          header?: never;
          path?: never;
          cookie?: never;
        };
        requestBody: {
          content: { "application/json": WireSignInBody };
        };
        responses: {
          200: { content: { "application/json": WireUser } };
        };
      };
    };
  };

  const client = createClient<Paths>();

  it("useLoader().data carries the wire response shape", () => {
    type Result = ReturnType<typeof client.useLoader<"/users/me">>;
    type SuccessData = (Result & { status: "success" })["data"];
    assert<Equal<SuccessData, WireUser>>();
  });

  it("load() resolves to a CachedResponse with the wire data shape", async () => {
    type Result = Awaited<ReturnType<typeof client.load<"/users/me">>>;
    assert<Equal<Result["data"], WireUser | undefined>>();
  });

  it("hydrate() accepts the wire data shape", () => {
    type HydrateArg = Parameters<typeof client.hydrate<"/users/me">>[0];
    type DataField = HydrateArg["data"];
    assert<Equal<DataField, WireUser>>();
  });

  it("useAction.send accepts the wire body shape", () => {
    type Action = ReturnType<typeof client.useAction<"POST", "/sessions">>;
    type SendArg = Parameters<Action["send"]>[0];
    assert<Equal<SendArg, { body: WireSignInBody }>>();
  });

  it("useAction.send returns the wire response shape", () => {
    type Action = ReturnType<typeof client.useAction<"POST", "/sessions">>;
    type Returned = Awaited<ReturnType<Action["send"]>>;
    assert<Equal<Returned, WireUser>>();
  });
});

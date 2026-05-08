import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorResponse } from "./client.js";
import {
  act,
  deferred,
  makeClient,
  renderAction,
  renderInlineLoader,
  renderLoader,
  server,
  waitFor,
} from "./test/index.js";
import type { Pet, TestPaths } from "./test/index.js";
import { type Camelize, camelize, snakenize } from "./utils/camelize.js";

const pet1: Pet = { id: 1, name: "Fido", status: "active" };
const pet2: Pet = { id: 2, name: "Whiskers", status: "inactive" };

// ---------------------------------------------------------------------------
// useLoader (suspense mode)
// ---------------------------------------------------------------------------

describe("useLoader", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("fetches and returns data", async () => {
    server.get("/pets", () => [pet1, pet2]);

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets" })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(result.current.data).toEqual([pet1, pet2]);
    expect(result.current.error).toBeUndefined();
    expect(result.current.response).toBeInstanceOf(Response);
  });

  it("passes query params", async () => {
    let capturedQuery: URLSearchParams | undefined;
    server.get("/pets", ({ query }) => {
      capturedQuery = query;
      return [pet1];
    });

    const { result } = renderLoader(() =>
      client.useLoader({
        path: "GET /pets",
        input: { query: { status: "active" } },
      })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(capturedQuery?.get("status")).toBe("active");
  });

  it("passes path params", async () => {
    server.get("/pets/:id", ({ params }) => ({
      ...pet1,
      id: Number(params.id),
    }));

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets/{id}", input: { path: { id: 1 } } })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(result.current.data).toMatchObject({ id: 1 });
  });

  it("suspends until deferred response resolves", async () => {
    const d = deferred<Pet[]>();
    server.get("/pets", async () => {
      const data = await d.promise;
      return data;
    });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets" })
    );

    // Still suspended — no result yet
    expect(result.current).toBeNull();

    act(() => d.resolve([pet1]));
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(result.current.data).toEqual([pet1]);
  });

  it("shows stale data while revalidating", async () => {
    let callCount = 0;
    const d = deferred<Pet[]>();
    server.get("/pets", async () => {
      callCount++;
      if (callCount === 1) return [pet1];
      return d.promise;
    });

    // First mount — populates cache
    const first = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(first.result.current?.status).toBe("success"));
    first.unmount();

    // Second mount with staleTime: 0 — stale, triggers revalidation
    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 0 })
    );

    // Immediately has stale data (cache hit), fetchStatus is refetching
    await waitFor(() => expect(result.current?.fetchStatus).toBe("refetching"));
    expect(result.current.data).toEqual([pet1]);

    act(() => d.resolve([pet1, pet2]));
    await waitFor(() => expect(result.current?.fetchStatus).toBe("success"));
    expect(result.current.data).toEqual([pet1, pet2]);
  });

  it("invalidate() triggers a refetch", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return callCount === 1 ? [pet1] : [pet1, pet2];
    });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(result.current.data).toHaveLength(1);

    act(() => {
      result.current.invalidate();
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current?.data).toHaveLength(2));
    expect(callCount).toBe(2);
  });

  it("refetch() method triggers a fresh fetch", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return callCount === 1 ? [pet1] : [pet1, pet2];
    });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));

    await act(() => result.current.refetch());
    expect(result.current.data).toHaveLength(2);
    expect(callCount).toBe(2);
  });

  it("disabled: true skips fetching", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", disabled: true as const })
    );

    await waitFor(() => expect(result.current?.status).toBe("disabled"));
    expect(callCount).toBe(0);
    expect(result.current.data).toBeUndefined();
  });

  it("cache hit within staleTime skips second fetch", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    // First mount populates cache
    const first = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(first.result.current?.status).toBe("success"));
    first.unmount();

    // Second mount — still within staleTime
    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(callCount).toBe(1);
  });

  it("throws to ErrorBoundary on error", async () => {
    server.get("/pets", () => ({
      status: 500,
      body: { error: { message: "server exploded" } },
    }));

    const { result, errors } = renderLoader(() =>
      client.useLoader({ path: "GET /pets" })
    );

    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBeInstanceOf(ErrorResponse);
    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useInlineLoader (no suspense)
// ---------------------------------------------------------------------------

describe("useInlineLoader", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("progresses fetching → success", async () => {
    const d = deferred<Pet[]>();
    server.get("/pets", async () => d.promise);

    const { result } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets" })
    );

    expect(result.current.status).toBe("fetching");
    expect(result.current.data).toBeUndefined();

    act(() => d.resolve([pet1]));
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual([pet1]);
  });

  it("progresses fetching → error", async () => {
    server.get("/pets", () => ({
      status: 500,
      body: { error: { message: "boom" } },
    }));

    const { result } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets" })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeUndefined();
    expect(
      (result.current as { error: { error: { message: string } } }).error,
    ).toMatchObject({
      error: { message: "boom" },
    });
  });

  it("shows stale data with lastError when a refetch fails", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      if (callCount === 1) return [pet1];
      return { status: 500, body: { error: { message: "refetch failed" } } };
    });

    const { result } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets" })
    );

    // First fetch succeeds — data cached
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual([pet1]);

    // Invalidate + focus triggers refetch, which fails
    act(() => {
      result.current.invalidate();
      window.dispatchEvent(new Event("focus"));
    });

    // Stale data still shown (loaderStatus: "success"), lastError populated
    await waitFor(() => expect(result.current.lastError).toBeDefined());
    expect(result.current.data).toEqual([pet1]);
    expect(result.current.status).toBe("success");
    expect(result.current.lastError?.data).toMatchObject({
      error: { message: "refetch failed" },
    });
  });

  it("recovers from error after invalidate + success", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      if (callCount === 1) {
        return { status: 500, body: { error: { message: "fail" } } };
      }
      return [pet1];
    });

    const { result } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets" })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => {
      result.current.invalidate();
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual([pet1]);
  });

  it("disabled: true returns disabled status without fetching", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const { result } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets", disabled: true as const })
    );

    await waitFor(() => expect(result.current.status).toBe("disabled"));
    expect(callCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// useAction (mutations)
// ---------------------------------------------------------------------------

describe("useAction", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("POST: idle → fetching → success", async () => {
    const d = deferred<Pet>();
    server.post("/pets", async () => d.promise, 201);

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets" })
    );

    expect(result.current.status).toBe("idle");

    act(() => {
      void result.current.send({ body: { name: "Rex", status: "active" } });
    });

    await waitFor(() => expect(result.current.status).toBe("fetching"));

    act(() => d.resolve({ id: 3, name: "Rex", status: "active" }));
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("POST: send() returns response data", async () => {
    server.post(
      "/pets",
      ({ body }) => {
        const b = body as Omit<Pet, "id">;
        return { id: 3, ...b };
      },
      201,
    );

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets" })
    );

    let returned: Pet | undefined;
    await act(async () => {
      returned = (await result.current.send({
        body: { name: "Rex", status: "active" },
      })) as Pet;
    });

    expect(returned).toEqual({ id: 3, name: "Rex", status: "active" });
    expect(result.current.status).toBe("success");
  });

  it("POST: idle → fetching → error", async () => {
    server.post("/pets", () => ({
      status: 400,
      body: { error: { message: "invalid" } },
    }));

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets" })
    );

    await act(async () => {
      await result.current
        .send({ body: { name: "Rex", status: "active" } })
        .catch(() => {});
    });

    expect(result.current.status).toBe("error");
  });

  it("onSuccess callback fires with data and response", async () => {
    server.post("/pets", () => pet1, 201);
    const onSuccess = vi.fn();

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets", onSuccess })
    );

    await act(async () => {
      await result.current.send({ body: { name: "Fido", status: "active" } });
    });

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith(pet1, expect.any(Response));
  });

  it("onError callback fires with error data and response", async () => {
    server.post("/pets", () => ({
      status: 400,
      body: { error: { message: "bad request" } },
    }));
    const onError = vi.fn();

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets", onError })
    );

    await act(async () => {
      await result.current
        .send({ body: { name: "Rex", status: "active" } })
        .catch(() => {});
    });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      { error: { message: "bad request" } },
      expect.any(Response),
    );
  });

  it("send uses current path after re-render, not stale path from first render", async () => {
    let postCalls = 0;
    let putCalls = 0;

    server.post("/pets", () => {
      postCalls++;
      return { status: 201, body: { id: 1, name: "Rex", status: "active" } };
    });
    server.put("/pets/:id", () => {
      putCalls++;
      return { id: 2, name: "Max", status: "active" };
    });

    type AnyAction = {
      send: (input?: unknown) => Promise<unknown>;
      status: string;
    };
    const api = client as unknown as {
      useAction: (opts: { path: string }) => AnyAction;
    };

    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => api.useAction({ path }),
      { initialProps: { path: "POST /pets" } },
    );

    rerender({ path: "PUT /pets/{id}" });

    await act(async () => {
      await result.current.send({ path: { id: 2 } });
    });

    expect(putCalls).toBe(1);
    expect(postCalls).toBe(0);
  });

  it("PUT hits the correct path param URL", async () => {
    let capturedUrl: string | undefined;
    server.put("/pets/:id", ({ req }) => {
      capturedUrl = req.url;
      return pet1;
    });

    const { result } = renderAction(() =>
      client.useAction({ path: "PUT /pets/{id}" })
    );

    await act(async () => {
      await result.current.send({ path: { id: 1 }, body: { name: "Updated" } });
    });

    expect(capturedUrl).toMatch(/\/pets\/1/);
  });

  it("DELETE: idle → fetching → success", async () => {
    server.delete("/pets/:id", () => ({ status: 204, body: undefined }));

    const { result } = renderAction(() =>
      client.useAction({ path: "DELETE /pets/{id}" })
    );

    expect(result.current.status).toBe("idle");

    await act(async () => {
      // send() types as void for optional-input actions (exactOptionalPropertyTypes);
      // cast to exercise the runtime path
      await (result.current.send as (i: unknown) => Promise<unknown>)({
        path: { id: 1 },
      });
    });

    expect(result.current.status).toBe("success");
  });

  it("onSettled fires with data and undefined error on success", async () => {
    server.post("/pets", () => pet1, 201);
    const onSettled = vi.fn();

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets", onSettled })
    );

    await act(async () => {
      await result.current.send({ body: { name: "Fido", status: "active" } });
    });

    expect(onSettled).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledWith(
      pet1,
      undefined,
      expect.any(Response),
    );
  });

  it("onSettled fires with undefined data and ErrorResponse on failure", async () => {
    server.post("/pets", () => ({
      status: 400,
      body: { error: { message: "bad request" } },
    }));
    const onSettled = vi.fn();

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets", onSettled })
    );

    await act(async () => {
      await result.current
        .send({ body: { name: "Rex", status: "active" } })
        .catch(() => {});
    });

    expect(onSettled).toHaveBeenCalledOnce();
    expect(onSettled).toHaveBeenCalledWith(
      undefined,
      expect.any(ErrorResponse),
      expect.any(Response),
    );
  });
});

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

describe("cache operations", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("client.invalidate() triggers a fresh fetch", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return callCount === 1 ? [pet1] : [pet1, pet2];
    });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(result.current.data).toHaveLength(1);

    act(() => {
      client.invalidate({ path: "GET /pets" });
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current?.data).toHaveLength(2));
  });

  it("client.purge() removes the cache entry, forcing a fresh fetch on next mount", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const first = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(first.result.current?.status).toBe("success"));
    first.unmount();

    act(() => client.purge({ path: "GET /pets" }));

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(callCount).toBe(2);
  });

  it("client.seed() pre-populates cache so no fetch is made", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    client.hydrate({ path: "GET /pets", data: [pet2] });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(result.current.data).toEqual([pet2]);
    expect(callCount).toBe(0);
  });

  it("match-based invalidate clears all matching cache keys", async () => {
    let pet1Calls = 0;
    let pet2Calls = 0;
    server.get("/pets/:id", ({ params }) => {
      if (Number(params.id) === 1) pet1Calls++;
      else pet2Calls++;
      return { ...pet1, id: Number(params.id) };
    });

    // Populate two separate cache entries
    const h1 = renderLoader(() =>
      client.useLoader({
        path: "GET /pets/{id}",
        input: { path: { id: 1 } },
        staleTime: 60_000,
      })
    );
    const h2 = renderLoader(() =>
      client.useLoader({
        path: "GET /pets/{id}",
        input: { path: { id: 2 } },
        staleTime: 60_000,
      })
    );

    await waitFor(() => expect(h1.result.current?.status).toBe("success"));
    await waitFor(() => expect(h2.result.current?.status).toBe("success"));

    // Invalidate all /pets/* entries via matcher, then trigger refetch via focus
    act(() => {
      client.invalidate({
        match: (key) => (key as { path: string }).path.startsWith("GET /pets/"),
      });
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(pet1Calls).toBe(2));
    await waitFor(() => expect(pet2Calls).toBe(2));

    h1.unmount();
    h2.unmount();
  });
});

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

describe("client options", () => {
  // A path whose response has snake_case keys — only used for camelize tests.
  type SnakePet = { id: number; pet_name: string; owner_id?: number };
  type CamelizePaths = {
    "/snake-pets": {
      get: {
        parameters: {};
        responses: { 200: { content: { "application/json": SnakePet } } };
      };
    };
  };

  it("transform: camelize renames keys at runtime and updates return type", async () => {
    server.get("/snake-pets", () => ({
      id: 1,
      pet_name: "Fido",
      owner_id: 42,
    }));

    const c = makeClient<CamelizePaths>({ transform: camelize });

    const { result } = renderLoader(() =>
      c.useLoader({ path: "GET /snake-pets" })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));

    // Cast needed: TypeScript resolves Transformed<typeof camelize, T> as `unknown`
    // because it substitutes the generic param with `unknown` in conditional type inference.
    // The cast is honest — camelize *does* produce this shape at runtime.
    const data = result.current.data as Camelize<SnakePet>;

    // Runtime: camelized keys present with correct values
    expect(data.petName).toBe("Fido");
    expect(data.ownerId).toBe(42);

    // Type-level: snake_case keys must not exist on Camelize<SnakePet>
    // @ts-expect-error — pet_name is gone after Camelize<SnakePet>
    void data.pet_name;
    // @ts-expect-error — owner_id is gone after Camelize<SnakePet>
    void data.owner_id;

    c.destroy();
  });

  it("retries on 5xx up to the configured count", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      if (callCount < 3) {
        return { status: 503, body: { error: { message: "unavailable" } } };
      }
      return [pet1];
    });

    const client = makeClient<TestPaths>({
      retries: 2,
      // Override jitter for fast tests
      shouldRetry: () => true,
    });

    const { result } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets" })
    );

    await waitFor(() => expect(result.current.status).toBe("success"), {
      timeout: 10_000,
    });
    expect(callCount).toBe(3);

    client.destroy();
  });

  it("shouldRetry: () => false gives up immediately on 5xx", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return { status: 503, body: { error: { message: "unavailable" } } };
    });

    const client = makeClient<TestPaths>({ shouldRetry: () => false });

    const { result } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets" })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(callCount).toBe(1);

    client.destroy();
  });

  it("onEachSuccess fires after a successful mutation", async () => {
    server.post("/pets", () => pet1, 201);
    const onEachSuccess = vi.fn();
    const client = makeClient<TestPaths>({ onEachSuccess });

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets" })
    );

    await act(async () => {
      await result.current.send({ body: { name: "Fido", status: "active" } });
    });

    expect(onEachSuccess).toHaveBeenCalledOnce();
    expect(onEachSuccess).toHaveBeenCalledWith(pet1);

    client.destroy();
  });

  it("onEachError fires after a failed mutation", async () => {
    server.post("/pets", () => ({
      status: 400,
      body: { error: { message: "bad request" } },
    }));
    const onEachError = vi.fn();
    const client = makeClient<TestPaths>({ onEachError });

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets" })
    );

    await act(async () => {
      await result.current
        .send({ body: { name: "Rex", status: "active" } })
        .catch(() => {});
    });

    expect(onEachError).toHaveBeenCalledOnce();
    expect(onEachError).toHaveBeenCalledWith(expect.any(ErrorResponse));

    client.destroy();
  });
});

// ---------------------------------------------------------------------------
// client options — extended
// ---------------------------------------------------------------------------

describe("client options — extended", () => {
  it("requestInit factory injects headers into every request", async () => {
    let capturedHeader: string | undefined;
    server.get("/pets", ({ req }) => {
      capturedHeader = req.headers["x-api-key"] as string;
      return [pet1];
    });

    const c = makeClient<TestPaths>({
      requestInit: () => ({ headers: { "x-api-key": "test-token" } }),
    });

    const { result } = renderLoader(() => c.useLoader({ path: "GET /pets" }));
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(capturedHeader).toBe("test-token");

    c.destroy();
  });

  it("extendCacheKey namespaces cache per tenant", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    let orgId = "org-a";
    const c = makeClient<TestPaths>({
      staleTime: 60_000,
      extendCacheKey: (
        opt: { path: string; input?: Record<string, unknown> },
      ) => ({ ...opt, orgId }),
    });

    await c.load({ path: "GET /pets" });
    expect(callCount).toBe(1);

    orgId = "org-b";
    await c.load({ path: "GET /pets" });
    expect(callCount).toBe(2); // different tenant = different cache key

    // Same org-b again — cache hit
    await c.load({ path: "GET /pets" });
    expect(callCount).toBe(2);

    c.destroy();
  });

  it("default shouldRetry does not retry 4xx errors", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return { status: 400, body: { error: { message: "bad request" } } };
    });

    const c = makeClient<TestPaths>({ retries: 3 });
    const { result } = renderInlineLoader(() =>
      c.useInlineLoader({ path: "GET /pets" })
    );

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(callCount).toBe(1); // 4xx — no retries

    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// useLoader — trigger options
// ---------------------------------------------------------------------------

describe("useLoader trigger options", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("refetchOnMount: false skips the effect-triggered refetch", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    client.hydrate({ path: "GET /pets", data: [pet1] });

    const { result } = renderLoader(() =>
      client.useLoader({
        path: "GET /pets",
        refetchOnMount: false,
        staleTime: 60_000,
      })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(callCount).toBe(0);
  });

  it("refetchOnFocus: true refetches on visibilitychange to visible", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(callCount).toBe(1);

    act(() => {
      result.current.invalidate();
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });
      window.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(callCount).toBe(2));
  });

  it("refetchOnFocus: false suppresses focus-triggered refetch", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const { result } = renderLoader(() =>
      client.useLoader({
        path: "GET /pets",
        refetchOnFocus: false,
        staleTime: 60_000,
      })
    );
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(callCount).toBe(1);

    act(() => {
      result.current.invalidate();
      window.dispatchEvent(new Event("focus"));
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(callCount).toBe(1);
  });

  it("refetchOnReconnect: false suppresses online-triggered refetch", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const { result } = renderLoader(() =>
      client.useLoader({
        path: "GET /pets",
        refetchOnReconnect: false,
        staleTime: 60_000,
      })
    );
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(callCount).toBe(1);

    act(() => {
      result.current.invalidate();
      window.dispatchEvent(new Event("online"));
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(callCount).toBe(1);
  });

  it("refetchInterval polls at the given interval", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const { unmount } = renderInlineLoader(() =>
      client.useInlineLoader({ path: "GET /pets", refetchInterval: 60 })
    );

    await waitFor(() => expect(callCount).toBe(1));
    await waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2), {
      timeout: 2_000,
    });

    unmount();
  });

  it("refetchInterval adaptive starts polling once data is available", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const { result, unmount } = renderInlineLoader(() =>
      client.useInlineLoader({
        path: "GET /pets",
        refetchInterval: (data) => (data ? 60 : false),
      })
    );

    await waitFor(() => expect(result.current.status).toBe("success"));
    const countAfterFirst = callCount;
    await waitFor(() => expect(callCount).toBeGreaterThan(countAfterFirst), {
      timeout: 2_000,
    });

    unmount();
  });
});

// ---------------------------------------------------------------------------
// cache operations — extended
// ---------------------------------------------------------------------------

describe("cache operations — extended", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("hydrate() with input params keys cache correctly", async () => {
    let callCount = 0;
    server.get("/pets/:id", () => {
      callCount++;
      return pet1;
    });

    client.hydrate({
      path: "GET /pets/{id}",
      input: { path: { id: 1 } },
      data: pet1,
    });

    const { result } = renderLoader(() =>
      client.useLoader({
        path: "GET /pets/{id}",
        input: { path: { id: 1 } },
        staleTime: 60_000,
      })
    );

    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(callCount).toBe(0);
    expect(result.current.data).toMatchObject({ id: 1 });
  });

  it("hydrate() is a no-op when a successful entry already exists", async () => {
    server.get("/pets", () => [pet1]);

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(result.current?.status).toBe("success"));

    client.hydrate({ path: "GET /pets", data: [pet2] });
    expect(result.current.data).toEqual([pet1]);
  });

  it("purge() with match function removes all matching entries", async () => {
    let callCount = 0;
    server.get("/pets/:id", ({ params }) => {
      callCount++;
      return { ...pet1, id: Number(params.id) };
    });

    await client.load({ path: "GET /pets/{id}", input: { path: { id: 1 } } });
    await client.load({ path: "GET /pets/{id}", input: { path: { id: 2 } } });
    expect(callCount).toBe(2);

    client.purge({
      match: (key) => (key as { path: string }).path.startsWith("GET /pets/"),
    });

    await client.load({ path: "GET /pets/{id}", input: { path: { id: 1 } } });
    await client.load({ path: "GET /pets/{id}", input: { path: { id: 2 } } });
    expect(callCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// cache key canonicalization
// ---------------------------------------------------------------------------

describe("cache key canonicalization", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("param objects with different key order produce the same cache key", async () => {
    let callCount = 0;
    const d = deferred<Pet[]>();
    server.get("/pets", async () => {
      callCount++;
      return d.promise;
    });

    const p1 = client.load({
      path: "GET /pets",
      input: { query: { status: "active" as const, limit: 10 } },
    });
    const p2 = client.load({
      path: "GET /pets",
      input: { query: { limit: 10, status: "active" as const } },
    });

    d.resolve([pet1]);
    await Promise.all([p1, p2]);
    expect(callCount).toBe(1);
  });

  it("concurrent load() calls for the same key issue only one request", async () => {
    let callCount = 0;
    const d = deferred<Pet[]>();
    server.get("/pets", async () => {
      callCount++;
      return d.promise;
    });

    const p1 = client.load({ path: "GET /pets" });
    const p2 = client.load({ path: "GET /pets" });

    d.resolve([pet1]);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(callCount).toBe(1);
    expect(r1.data).toEqual([pet1]);
    expect(r2.data).toEqual([pet1]);
  });

  it("concurrent load() into a refetching entry awaits the in-flight request", async () => {
    let callCount = 0;
    const d = deferred<Pet[]>();
    server.get("/pets", async () => {
      callCount++;
      if (callCount === 1) return [pet1];
      return d.promise;
    });

    // Populate cache then invalidate so next load enters "refetching"
    await client.load({ path: "GET /pets", staleTime: 60_000 });
    client.invalidate({ path: "GET /pets" });

    // Two concurrent loads — both should await the single in-flight revalidation
    const p1 = client.load({ path: "GET /pets", staleTime: 0 });
    const p2 = client.load({ path: "GET /pets", staleTime: 0 });

    d.resolve([pet1, pet2]);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(callCount).toBe(2); // initial + one revalidation, not three
    expect(r1.data).toEqual([pet1, pet2]);
    expect(r2.data).toEqual([pet1, pet2]);
  });

  it("empty input object is treated as no input for cache key purposes", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    // load with empty query object should hit same key as load with no input
    await client.load({ path: "GET /pets", staleTime: 60_000 });
    await client.load({
      path: "GET /pets",
      input: { query: {} },
      staleTime: 60_000,
    });

    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// imperative API
// ---------------------------------------------------------------------------

describe("imperative API", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("client.fetch() issues a raw request and returns the typed response", async () => {
    server.post(
      "/pets",
      ({ body }) => ({ id: 99, ...(body as Omit<Pet, "id">) }),
      201,
    );

    const { data, error } = await client.fetch("POST /pets", {
      input: { body: { name: "Rex", status: "active" } },
    });

    expect(error).toBeUndefined();
    expect(data).toMatchObject({ id: 99, name: "Rex" });
  });

  it("client.fetch() returns error field for non-2xx without throwing", async () => {
    server.post("/pets", () => ({
      status: 422,
      body: { error: { message: "unprocessable" } },
    }));

    const { data, error } = await client.fetch("POST /pets", {
      input: { body: { name: "Rex", status: "active" } },
    });

    expect(data).toBeUndefined();
    expect(error).toMatchObject({ error: { message: "unprocessable" } });
  });

  it("client.refetch() invalidates and immediately refetches with exact key", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return callCount === 1 ? [pet1] : [pet1, pet2];
    });

    const { result } = renderLoader(() =>
      client.useLoader({ path: "GET /pets", staleTime: 60_000 })
    );
    await waitFor(() => expect(result.current?.status).toBe("success"));
    expect(result.current.data).toHaveLength(1);

    await act(() => client.refetch({ path: "GET /pets" }));
    expect(result.current.data).toHaveLength(2);
    expect(callCount).toBe(2);
  });

  it("client.refetch() with match function refetches all matching entries", async () => {
    let pet1Calls = 0;
    let pet2Calls = 0;
    server.get("/pets/:id", ({ params }) => {
      if (Number(params.id) === 1) pet1Calls++;
      else pet2Calls++;
      return { ...pet1, id: Number(params.id) };
    });

    const h1 = renderLoader(() =>
      client.useLoader({
        path: "GET /pets/{id}",
        input: { path: { id: 1 } },
        staleTime: 60_000,
      })
    );
    const h2 = renderLoader(() =>
      client.useLoader({
        path: "GET /pets/{id}",
        input: { path: { id: 2 } },
        staleTime: 60_000,
      })
    );

    await waitFor(() => expect(h1.result.current?.status).toBe("success"));
    await waitFor(() => expect(h2.result.current?.status).toBe("success"));

    await act(() =>
      client.refetch({
        match: (key) => (key as { path: string }).path.startsWith("GET /pets/"),
      })
    );

    expect(pet1Calls).toBe(2);
    expect(pet2Calls).toBe(2);

    h1.unmount();
    h2.unmount();
  });

  it("client.url() interpolates path params", () => {
    const u = client.url({
      path: "GET /pets/{id}",
      input: { path: { id: 42 } },
    });
    expect(u).toMatch(/\/pets\/42$/);
  });

  it("client.url() serializes query params", () => {
    const u = client.url({
      path: "GET /pets",
      input: { query: { status: "active" } },
    });
    expect(u).toContain("status=active");
  });

  it("load() aborts and returns stale data when signal fires mid-flight", async () => {
    const d = deferred<Pet[]>();
    server.get("/pets", async () => d.promise);

    client.hydrate({ path: "GET /pets", data: [pet1] });
    client.invalidate({ path: "GET /pets" });

    const controller = new AbortController();
    const loadPromise = client.load({
      path: "GET /pets",
      staleTime: 0,
      signal: controller.signal,
    });

    controller.abort();
    d.resolve([]);

    const result = await loadPromise;
    expect(result.data).toEqual([pet1]);
  });

  it("load() throws AbortError when aborted with no stale data", async () => {
    const d = deferred<Pet[]>();
    server.get("/pets", async () => d.promise);

    const controller = new AbortController();
    const loadPromise = client.load({
      path: "GET /pets",
      signal: controller.signal,
    });

    controller.abort();
    d.resolve([]);

    await expect(loadPromise).rejects.toMatchObject({ name: "AbortError" });
  });
});

// ---------------------------------------------------------------------------
// cache eviction
// ---------------------------------------------------------------------------

describe("cache eviction", () => {
  it("evicts unmounted entries after cacheTime elapses", async () => {
    // cacheTime: 50ms → eviction interval fires every ~12ms
    const c = makeClient<TestPaths>({ cacheTime: 50, staleTime: 60_000 });

    // Pre-populate via hydrate so no network call is needed (refCount stays 0)
    c.hydrate({ path: "GET /pets", data: [pet1] });

    // Wait past cacheTime + one eviction tick
    await new Promise((r) => setTimeout(r, 200));

    // Register the route AFTER the wait so stray in-flight requests from other
    // tests cannot match it and inflate the count
    let fetched = false;
    server.get("/pets", () => {
      fetched = true;
      return [pet2];
    });

    // staleTime: 60_000 — a live cache entry would be served without fetching;
    // if the entry was evicted we must go to the network
    const result = await c.load({ path: "GET /pets", staleTime: 60_000 });

    expect(fetched).toBe(true);
    expect(result.data).toEqual([pet2]);

    c.destroy();
  });

  it("does not evict entries while a component is mounted (refCount > 0)", async () => {
    let callCount = 0;
    server.get("/pets", () => {
      callCount++;
      return [pet1];
    });

    const c = makeClient<TestPaths>({ cacheTime: 50, staleTime: 60_000 });

    const { result, unmount } = renderInlineLoader(() =>
      c.useInlineLoader({ path: "GET /pets" })
    );
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(callCount).toBe(1);

    // Wait past cacheTime while the component is still mounted (refCount > 0)
    await new Promise((r) => setTimeout(r, 200));

    // Eviction should not have fired — refCount > 0 blocks it
    expect(callCount).toBe(1);

    unmount();
    c.destroy();
  });
});

// ---------------------------------------------------------------------------
// useAction — concurrent sends
// ---------------------------------------------------------------------------

describe("useAction — concurrent sends", () => {
  let client: ReturnType<typeof makeClient<TestPaths>>;

  beforeEach(() => {
    client = makeClient<TestPaths>();
  });

  afterEach(() => {
    client.destroy();
  });

  it("last send wins: earlier result does not flip status to success", async () => {
    const d1 = deferred<Pet>();
    const d2 = deferred<Pet>();
    let callCount = 0;
    server.post(
      "/pets",
      () => {
        callCount++;
        return callCount === 1 ? d1.promise : d2.promise;
      },
      201,
    );

    const { result } = renderAction(() =>
      client.useAction({ path: "POST /pets" })
    );

    act(() => {
      void result.current.send({ body: { name: "First", status: "active" } });
    });
    await waitFor(() => expect(result.current.status).toBe("fetching"));

    act(() => {
      void result.current.send({ body: { name: "Second", status: "active" } });
    });

    act(() => d1.resolve({ id: 1, name: "First", status: "active" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.status).toBe("fetching");

    act(() => d2.resolve({ id: 2, name: "Second", status: "active" }));
    await waitFor(() => expect(result.current.status).toBe("success"));
  });
});

// ---------------------------------------------------------------------------
// ErrorResponse
// ---------------------------------------------------------------------------

describe("ErrorResponse", () => {
  it("extracts message from data.error.message", () => {
    const err = new ErrorResponse({ error: { message: "not found" } });
    expect(err.message).toBe("not found");
  });

  it("falls back to 'API error' when message is absent", () => {
    expect(new ErrorResponse({}).message).toBe("API error");
    expect(new ErrorResponse(null as never).message).toBe("API error");
  });

  it("stores data, response, and name on the instance", () => {
    const response = new Response(null, { status: 404 });
    const err = new ErrorResponse(
      { error: { message: "not found" } },
      response,
    );
    expect(err.data).toEqual({ error: { message: "not found" } });
    expect(err.response).toBe(response);
    expect(err.name).toBe("ErrorResponse");
  });
});

// ---------------------------------------------------------------------------
// utils: camelize
// ---------------------------------------------------------------------------

describe("utils: camelize", () => {
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

// ---------------------------------------------------------------------------
// utils: snakenize
// ---------------------------------------------------------------------------

describe("utils: snakenize", () => {
  it("converts top-level camelCase keys to snake_case", () => {
    expect(snakenize({ petName: "Fido", ownerId: 1 })).toEqual({
      pet_name: "Fido",
      owner_id: 1,
    });
  });

  it("handles multiple capitals", () => {
    expect(snakenize({ petOwnerName: "Alice" })).toEqual({
      pet_owner_name: "Alice",
    });
  });

  it("does NOT recurse into nested objects (shallow only)", () => {
    const result = snakenize({ petInfo: { petName: "Fido" } });
    expect(result).toEqual({ pet_info: { petName: "Fido" } });
    expect(
      (result["pet_info"] as Record<string, unknown>)["petName"],
    ).toBe("Fido");
  });

  it("leaves already-snake_case keys unchanged", () => {
    expect(snakenize({ pet_name: "Fido" })).toEqual({ pet_name: "Fido" });
  });

  it("passes values through without modification", () => {
    const nested = { a: 1 };
    const result = snakenize({ myData: nested });
    expect(result["my_data"]).toBe(nested);
  });
});

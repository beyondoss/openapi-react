# openapi-react Architecture

Takes an OpenAPI-typed `Paths` schema and produces React hooks (`useLoader`, `useInlineLoader`, `useAction`) and imperative APIs (`load`, `hydrate`, `invalidate`, `refetch`, `purge`) backed by a shared in-memory cache with observable change propagation.

## Data Flow

**Load / useLoader (cached GET)**

```
useLoader(options)
  │
  ├─► encodeKey(path, input)
  │        │
  │        ▼
  │   SubjectMap lookup
  │        │
  │   hit + within staleTime? ──► return cached data immediately
  │        │
  │   miss or stale?
  │        │
  │        ▼
  │   retry(fn, { retries, shouldRetry })
  │        │
  │        ▼
  │   openapi-fetch client[GET](path, init)
  │        │
  │   success                    error
  │        │                       │
  │   transform(data)     ErrorResponse (cached)
  │        │                       │
  │        └──────────┬────────────┘
  │                   ▼
  │           SubjectMap.set(key, entry)
  │                   │
  │           Subject.setState → notify observers
  │
  └─► useSyncExternalStore(subscribe, getSnapshot)
            │
       render with { data, error, status, response }
```

**Action / useAction (uncached mutation)**

```
useAction().send(input, init)
  │
  ▼
fetch_(method, path, init)        ← raw, no caching
  │
  ▼
openapi-fetch client[METHOD](path, init)
  │
  ├─ success → transform → onSuccess(data)
  └─ error   → onError(err) → throw ErrorResponse
```

**Cache eviction (background interval)**

```
every min(cacheTime / 4, 5000) ms:
  for each entry in SubjectMap:
    if createdAt + cacheTime < now AND refCount === 0:
      SubjectMap.delete(key)
```

**Subscription / refetch triggers**

```
mount → (refetchOnMount) → load()
window "focus" event ───────────► invalidate → load()
document "visibilitychange" ────► invalidate → load()
window "online" event ──────────► invalidate → load()
refetchInterval timer ──────────► invalidate → load()
manual invalidate() / refetch() ► invalidate → load()
```

## Concepts & Terminology

| Term               | What It Controls                                                                                    | NOT                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `staleTime`        | Window (ms) after a successful fetch during which cached data is served without re-fetching         | When data is deleted from cache                      |
| `cacheTime`        | How long a cache entry survives after its last subscriber unmounts                                  | How long data is considered fresh                    |
| `refCount`         | Active subscriber count per cache key; eviction is gated on `refCount === 0`                        | A render count                                       |
| `SubjectMap`       | The shared in-memory cache; a `Map` with microtask-batched change notifications                     | A persistent or distributed store                    |
| `Subject`          | Single observable slot wrapping `SubjectMap`'s change stream; drives `useSyncExternalStore`         | A reactive stream or Rx observable                   |
| `encodeKey`        | Deterministic JSON serialization (sorted keys, empty values removed) for cache lookup               | A hash; collisions are possible if JSON is identical |
| `LoadablePaths`    | Union of `Paths` keys that have a `get` method — the only paths valid for `useLoader` / `load`      | All paths in the schema                              |
| `transform`        | Optional user-supplied `(data: T) => unknown` applied to every successful response before caching   | Middleware; runs once at load, not on each render    |
| `ErrorResponse<T>` | Subclass of `Error` carrying `.data` and `.response`; thrown by hooks and cached as the error state | A plain fetch rejection                              |

## Core Mechanism

### `createClient<Paths, F>(options)`

Returns a closed-over object sharing one `SubjectMap` (cache), one `openapi-fetch` client instance, and one eviction interval. All hooks and imperative helpers from a single `createClient` call share this cache — hooks from different `createClient` calls do not.

### Cache key (`encodeKey`)

```
encodeKey({ path, input }) → JSON string
```

- Recursively sorts object keys and removes `undefined`/`null`/empty-string values before serializing
- Ensures `GET /users?page=1&limit=10` and `GET /users?limit=10&page=1` map to the same cache slot
- See `client.ts:encodeKey()` and `client.ts:sortObject()`

### `load(options)` — the cache read/write path

1. Compute `key = encodeKey(path, input)`
2. If `SubjectMap` has a non-stale entry (within `staleTime`) → return immediately
3. If a fetch is already in-flight for this key (same `promise` object) → await that instead of issuing a second request
4. Call `retry(fetchFn, retryOptions)` with exponential backoff
5. On success: apply `transform`, write `CachedResponse` with `status: "success"` into `SubjectMap`
6. On abort: if stale data exists, resolve with it silently; otherwise rethrow
7. On error: write `CachedResponse` with `status: "error"` and `error: ErrorData`; notify observers
8. Every write calls `Subject.setState`, which batches downstream notifications via `queueMicrotask`

See `client.ts:load()`.

### `useLoader` vs `useInlineLoader`

Both subscribe to the same cache via `useSyncExternalStore`. The difference is in the snapshot shape:

- **`useLoader`**: Returns a single object `{ data, error, status, ... }` regardless of state; callers may wrap in a `<Suspense>` boundary. When `suspense: true` and data is loading, the hook throws a promise.
- **`useInlineLoader`**: Returns a discriminated union `{ status: "success" | "fetching" | "error", ... }` for inline conditional rendering without a `<Suspense>` boundary.

### Retry strategy (`retry`)

```
attempt → fetch
  on error:
    if shouldRetry(error, attemptCount) → wait (base * 2^attempt) ms → retry
    else → throw
```

Default `shouldRetry`: retries 5xx errors up to `retries` times; never retries 4xx. Custom `shouldRetry` can return `boolean | void | Promise<boolean | void>`. See `client.ts:retry()`.

### `useAction`

Thin wrapper that calls `fetch_` (raw `openapi-fetch` with no caching) and manages a local `status` subject. Each `send()` call replaces the previous in-flight status. No cache reads or writes. See `client.ts:useAction()`.

## State Machine — useLoader / useInlineLoader

```
disabled ──► (enabled=true) ──► fetching
                                    │
                              success / error
                                    │
                          ┌────────►▼◄───────────┐
                          │       loaded         │
                          │   (success/error)    │
                          │         │            │
                          │  invalidate/refetch  │
                          │         │            │
                          └──── refetching ──────┘
```

| From         | Event                           | To           | What Actually Happens                                                     |
| ------------ | ------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `disabled`   | `enabled` becomes truthy        | `fetching`   | `load()` called; component re-renders with `status: "fetching"`           |
| `fetching`   | fetch succeeds                  | `success`    | Data written to cache; component re-renders with `data`                   |
| `fetching`   | fetch fails                     | `error`      | `ErrorResponse` written to cache; component re-renders with `error`       |
| `success`    | `invalidate()` or trigger fires | `refetching` | `status` set to `refetching`; stale data remains visible; `load()` called |
| `error`      | `invalidate()` or trigger fires | `refetching` | Same as above; previous error cleared after new fetch completes           |
| `refetching` | fetch succeeds                  | `success`    | Cache updated; fresh data rendered                                        |
| `refetching` | fetch fails                     | `error`      | Error replaces previous state                                             |

## Why It Behaves This Way

### Why stale data remains visible during refetch

The cache always holds the last good entry. On `refetch`, status becomes `refetching` but `data` stays populated. This avoids a loading flash on every background refresh — common for window-focus refetches. If the refetch fails, the component surfaces the error without discarding the last-known-good data.

### Why cache eviction is gated on `refCount === 0`

If a component is mounted, its data must survive even past `cacheTime`. The eviction interval only deletes entries with no active subscribers. This prevents mid-render cache misses when `cacheTime` is shorter than a component's lifetime.

### Why `SubjectMap` uses microtask-batched notifications

Multiple cache keys can be written in the same synchronous frame (e.g., `hydrate` pre-populating several routes). Batching via `queueMicrotask` coalesces redundant observer notifications so React only re-renders once per microtask. See `client.ts:SubjectMap`.

### Why `snakenize` is shallow while `camelize` is deep

Request bodies often include nested structures (e.g., WebAuthn credential objects, binary blobs) that must not be transformed. `snakenize` converts only the top-level keys on outgoing payloads. `camelize` converts deeply on incoming responses where the full object is application-controlled. See `src/utils/camelize.ts`.

### Why there is no server-side rendering (SSR) cache

The `SubjectMap` is created inside `createClient`, which is module-level. SSR would share cache state across requests. The library is intentionally client-only; `hydrate()` exists to pre-populate cache from server-fetched data passed as props.

## Configuration

| Option            | Default               | Runtime Effect                                                             |
| ----------------- | --------------------- | -------------------------------------------------------------------------- |
| `baseUrl`         | `""`                  | Prepended to every request path                                            |
| `staleTime`       | `1000` ms             | Data within this age is served from cache without re-fetching              |
| `cacheTime`       | `300_000` ms (5 min)  | Unmounted entries are evicted after this duration                          |
| `retries`         | `3`                   | Max retry attempts on 5xx; does not apply to 4xx                           |
| `shouldRetry`     | retry 5xx, skip 4xx   | Custom predicate — return `false` to abort, `true` to retry                |
| `transform`       | identity              | Applied once to response data before caching; result is what hooks receive |
| `debug`           | `false`               | Logs each response (status, URL, headers, body) to console                 |
| `requestInit`     | `undefined`           | Merged into every request: `cache`, `credentials`, `mode`, `headers`       |
| `querySerializer` | openapi-fetch default | Replaces the entire query string serialization                             |
| `onEachSuccess`   | noop                  | Called after every successful `useAction` send; useful for analytics       |
| `onEachError`     | noop                  | Called after every failed `useAction` send                                 |
| `extendCacheKey`  | identity              | Add custom fields (e.g., tenant ID) to every cache key                     |

## Failure Modes

| Failure                        | What Actually Happens                                                                                 | Recovery                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| HTTP 4xx response              | Wrapped in `ErrorResponse`; not retried; cached as `status: "error"`; hook renders error state        | Manual `refetch()` or user action            |
| HTTP 5xx response              | Retried up to `retries` times with exponential backoff; on exhaustion, cached as `status: "error"`    | Automatic on next refetch trigger            |
| Fetch aborted (unmount)        | If stale data exists, resolves silently with it; otherwise rethrows `AbortError`                      | No action needed; next mount re-fetches      |
| `transform` throws             | Error propagates as an uncaught rejection from `load()`; cache entry is not written                   | Fix the transform; or wrap it with try/catch |
| Network offline                | `fetch` rejects; treated as retriable error; browser `online` event triggers refetch when reconnected | Automatic via `window "online"` listener     |
| Concurrent mounts for same key | Second subscriber awaits the in-flight `promise` from the first; no duplicate requests issued         | Handled transparently by the cache           |

## File Map

| File                    | What It Does                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/index.ts`          | Public surface: re-exports everything from `client.ts` and `utils/camelize.ts`                          |
| `src/client.ts`         | `createClient` factory; `SubjectMap`, `Subject`, `retry`, `encodeKey`, all hooks and imperative helpers |
| `src/utils/camelize.ts` | `camelize` (deep snake→camel), `snakenize` (shallow camel→snake), `Camelize<T>` type                    |

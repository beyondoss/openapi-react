/// <reference types="node" />
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

type JsonResult = unknown | { status: number; body: unknown };

type RouteHandler = (ctx: {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  req: IncomingMessage;
}) => JsonResult | Promise<JsonResult>;

interface Route {
  method: string;
  re: RegExp;
  paramNames: string[];
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

function toPattern(path: string): { re: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const re = path.replace(/:(\w+)/g, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { re: new RegExp(`^${re}$`), paramNames };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString();
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

class TestServer {
  private routes: Route[] = [];
  private _server = createServer(this._dispatch.bind(this));
  baseUrl = "";

  start(): Promise<void> {
    return new Promise((resolve) => {
      this._server.listen(0, "localhost", () => {
        const { port } = this._server.address() as AddressInfo;
        this.baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._server.close((err: Error | undefined) =>
        err ? reject(err) : resolve()
      );
    });
  }

  reset(): void {
    this.routes = [];
  }

  on(
    method: string,
    path: string,
    handler: RouteHandler,
    defaultStatus = 200,
  ): void {
    const { re, paramNames } = toPattern(path);
    this.routes.unshift({
      method: method.toUpperCase(),
      re,
      paramNames,
      handler: async (req, res) => {
        const url = new URL(req.url!, this.baseUrl);
        const match = url.pathname.match(re)!;
        const params = Object.fromEntries(
          paramNames.map((n, i) => [n, match[i + 1]!]),
        );
        const body = await readBody(req);
        const result = await handler({
          params,
          query: url.searchParams,
          body,
          req,
        });

        let resStatus: number;
        let resBody: unknown;
        if (
          result !== null
          && typeof result === "object"
          && "status" in result
          && "body" in result
          && typeof (result as Record<string, unknown>).status === "number"
        ) {
          resStatus = (result as { status: number; body: unknown }).status;
          resBody = (result as { status: number; body: unknown }).body;
        } else {
          resStatus = defaultStatus;
          resBody = result;
        }

        res.writeHead(resStatus, { "Content-Type": "application/json" });
        res.end(resBody !== undefined ? JSON.stringify(resBody) : "");
      },
    });
  }

  get(path: string, handler: RouteHandler, status = 200): void {
    this.on("GET", path, handler, status);
  }

  post(path: string, handler: RouteHandler, status = 200): void {
    this.on("POST", path, handler, status);
  }

  put(path: string, handler: RouteHandler, status = 200): void {
    this.on("PUT", path, handler, status);
  }

  delete(path: string, handler: RouteHandler, status = 204): void {
    this.on("DELETE", path, handler, status);
  }

  private _dispatch(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url!, this.baseUrl);
    const route = this.routes.find(
      (r) => r.method === req.method && r.re.test(url.pathname),
    );

    if (!route) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: `No handler: ${req.method} ${req.url}` },
        }),
      );
      return;
    }

    route.handler(req, res).catch((err: unknown) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(err) } }));
    });
  }
}

export const server = new TestServer();

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

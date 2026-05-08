import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server.js";

beforeAll(() => server.start());
afterEach(() => {
  cleanup();
  server.reset();
});
afterAll(() => server.close());

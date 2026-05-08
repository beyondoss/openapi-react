import { act, renderHook, waitFor } from "@testing-library/react";
import { Component, type ReactNode, Suspense } from "react";
import { type ClientOptions, createClient } from "../client.js";
import { server } from "./server.js";

interface ErrorBoundaryProps {
  children: ReactNode;
  onError: (error: Error) => void;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, { caught: boolean }> {
  state = { caught: false };

  static getDerivedStateFromError() {
    return { caught: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  render() {
    if (this.state.caught) return null;
    return this.props.children;
  }
}

export function renderLoader<T>(hookFn: () => T) {
  const errors: Error[] = [];

  const wrapper = ({ children }: { children: ReactNode }) => (
    <ErrorBoundary onError={(e) => errors.push(e)}>
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );

  const result = renderHook(hookFn, { wrapper });
  return { ...result, errors };
}

export function renderInlineLoader<T>(hookFn: () => T) {
  return renderHook(hookFn);
}

export function renderAction<T>(hookFn: () => T) {
  return renderHook(hookFn);
}

// Infer F from opts.transform so callers only need to write
// makeClient<MyPaths>({ transform: camelize }) — no second type arg required.
type InferTransform<Paths extends {}, Opts> = Opts extends {
  transform: infer F extends <T>(data: T) => unknown;
} ? ClientOptions<Paths, F>
  : ClientOptions<Paths>;

export function makeClient<
  Paths extends {},
  Opts extends Partial<ClientOptions<Paths>> = {},
>(opts?: Opts) {
  return createClient({
    baseUrl: server.baseUrl,
    staleTime: 0,
    retries: 0,
    ...opts,
  } as InferTransform<Paths, Opts>);
}

export { act, waitFor };

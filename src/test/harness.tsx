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

export function makeClient<Paths extends {}>(
  opts?: Partial<ClientOptions<Paths>>,
) {
  return createClient<Paths>({
    baseUrl: server.baseUrl,
    staleTime: 0,
    retries: 0,
    ...opts,
  });
}

export { act, waitFor };

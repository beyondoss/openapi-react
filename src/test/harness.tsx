import {
  act,
  renderHook,
  type waitForOptions as WaitForOptions,
} from "@testing-library/react";
import React, { Component, type ReactNode, Suspense, useState } from "react";
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

// React.use() defers Suspense retries via the Scheduler, but jsdom never
// drives those retries in practice — the fake act callback node left on
// root.callbackNode by renderHook's sync act() causes the retry to short-
// circuit instead of scheduling new work. The fix: when waitFor polls, it
// triggers a state update on the Suspense wrapper. That parent re-render
// causes React to revisit the suspended child; since the promise is now
// fulfilled, React.use() returns the value instead of throwing, and the
// component commits normally.
const _wrapperUpdaters = new Set<() => void>();

export function renderLoader<T>(hookFn: () => T) {
  const errors: Error[] = [];

  const wrapper = ({ children }: { children: ReactNode }) => {
    const [, setTick] = useState(0);
    const update = React.useCallback(() => setTick((n) => n + 1), []);
    React.useLayoutEffect(() => {
      _wrapperUpdaters.add(update);
      return () => {
        _wrapperUpdaters.delete(update);
      };
    }, [update]);
    return (
      <ErrorBoundary onError={(e) => errors.push(e)}>
        <Suspense fallback={null}>{children}</Suspense>
      </ErrorBoundary>
    );
  };

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

export async function waitFor<T>(
  callback: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<T> {
  const timeout = options.timeout ?? 1000;
  const interval = options.interval ?? 50;
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
    await act(async () => {
      _wrapperUpdaters.forEach((fn) => fn());
    });
    try {
      return await Promise.resolve(callback());
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError;
}

export { act };

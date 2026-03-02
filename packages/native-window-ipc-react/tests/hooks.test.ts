import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import type { TypedChannel } from "@nativewindow/ipc";

// ── Mock channel ──────────────────────────────────────────────────

interface MockChannel extends TypedChannel<any> {
  _listeners: Map<string, Set<(payload: any) => void>>;
  _simulateEvent: (type: string, payload: unknown) => void;
}

function createMockChannel(): MockChannel {
  const listeners = new Map<string, Set<(payload: any) => void>>();
  return {
    send: vi.fn(),
    on: vi.fn((type: string, handler: (payload: any) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(handler);
    }),
    off: vi.fn((type: string, handler: (payload: any) => void) => {
      listeners.get(type)?.delete(handler);
    }),
    _listeners: listeners,
    _simulateEvent(type: string, payload: unknown) {
      listeners.get(type)?.forEach((fn) => fn(payload));
    },
  };
}

// ── Mock schema ───────────────────────────────────────────────────

const mockSchema = {
  _zod: { output: null as unknown },
  safeParse: (data: unknown) => ({ success: true as const, data }),
};

// ── Mock createChannelClient ──────────────────────────────────────

let mockChannel: MockChannel;

vi.mock("@nativewindow/ipc/client", () => ({
  createChannelClient: vi.fn(() => mockChannel),
}));

// Import after vi.mock (vitest hoists the mock)
import {
  ChannelProvider,
  useChannel,
  useChannelEvent,
  useSend,
  createChannelHooks,
} from "../index.ts";

import { createChannelClient } from "@nativewindow/ipc/client";

// ── Helpers ───────────────────────────────────────────────────────

function createWrapper(schemas: Record<string, any>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(ChannelProvider, { schemas, children });
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe("ChannelProvider", () => {
  beforeEach(() => {
    mockChannel = createMockChannel();
    vi.clearAllMocks();
  });

  test("creates channel client once on mount", () => {
    const schemas = { ping: mockSchema };
    const wrapper = createWrapper(schemas);

    const { rerender } = renderHook(() => useChannel(), { wrapper });
    rerender();

    expect(createChannelClient).toHaveBeenCalledTimes(1);
  });

  test("passes schemas and onValidationError to createChannelClient", () => {
    const schemas = { ping: mockSchema };
    const onValidationError = vi.fn();

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(ChannelProvider, {
        schemas,
        onValidationError,
        children,
      });
    }

    renderHook(() => useChannel(), { wrapper: Wrapper });

    expect(createChannelClient).toHaveBeenCalledWith({
      schemas,
      onValidationError,
    });
  });

  test("provides stable channel reference across re-renders", () => {
    const schemas = { ping: mockSchema };
    const wrapper = createWrapper(schemas);

    const { result, rerender } = renderHook(() => useChannel(), { wrapper });
    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });
});

describe("useChannel", () => {
  beforeEach(() => {
    mockChannel = createMockChannel();
    vi.clearAllMocks();
  });

  test("returns channel from context", () => {
    const wrapper = createWrapper({ ping: mockSchema });

    const { result } = renderHook(() => useChannel(), { wrapper });

    expect(result.current).toBe(mockChannel);
  });

  test("throws when used outside ChannelProvider", () => {
    // Suppress React error boundary console output
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useChannel());
    }).toThrow("useChannel() must be used inside a <ChannelProvider>.");

    consoleSpy.mockRestore();
  });
});

describe("useChannelEvent", () => {
  beforeEach(() => {
    mockChannel = createMockChannel();
    vi.clearAllMocks();
  });

  test("subscribes to event on mount", () => {
    const handler = vi.fn();
    const wrapper = createWrapper({ ping: mockSchema });

    renderHook(() => useChannelEvent("ping", handler), { wrapper });

    expect(mockChannel.on).toHaveBeenCalledTimes(1);
    expect(mockChannel.on).toHaveBeenCalledWith("ping", expect.any(Function));
  });

  test("unsubscribes on unmount", () => {
    const handler = vi.fn();
    const wrapper = createWrapper({ ping: mockSchema });

    const { unmount } = renderHook(() => useChannelEvent("ping", handler), { wrapper });

    const subscribedHandler = vi.mocked(mockChannel.on).mock.calls[0]![1];
    unmount();

    expect(mockChannel.off).toHaveBeenCalledTimes(1);
    expect(mockChannel.off).toHaveBeenCalledWith("ping", subscribedHandler);
  });

  test("calls latest handler without re-subscribing", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const wrapper = createWrapper({ ping: mockSchema });

    const { rerender } = renderHook(({ handler }) => useChannelEvent("ping", handler), {
      wrapper,
      initialProps: { handler: handler1 },
    });

    // Re-render with a new handler
    rerender({ handler: handler2 });

    // on() should still have been called only once
    expect(mockChannel.on).toHaveBeenCalledTimes(1);

    // Simulate event — should call handler2, not handler1
    mockChannel._simulateEvent("ping", "hello");
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith("hello");
  });

  test("re-subscribes when event type changes", () => {
    const handler = vi.fn();
    const wrapper = createWrapper({ ping: mockSchema, pong: mockSchema });

    const { rerender } = renderHook(
      ({ type }: { type: string }) => useChannelEvent(type, handler),
      { wrapper, initialProps: { type: "ping" } },
    );

    rerender({ type: "pong" });

    expect(mockChannel.off).toHaveBeenCalledWith("ping", expect.any(Function));
    expect(mockChannel.on).toHaveBeenCalledWith("pong", expect.any(Function));
  });

  test("delivers event payload to handler", () => {
    const handler = vi.fn();
    const wrapper = createWrapper({ ping: mockSchema });

    renderHook(() => useChannelEvent("ping", handler), { wrapper });

    mockChannel._simulateEvent("ping", { x: 1, y: 2 });

    expect(handler).toHaveBeenCalledWith({ x: 1, y: 2 });
  });
});

describe("useSend", () => {
  beforeEach(() => {
    mockChannel = createMockChannel();
    vi.clearAllMocks();
  });

  test("returns a stable function across re-renders", () => {
    const wrapper = createWrapper({ ping: mockSchema });

    const { result, rerender } = renderHook(() => useSend(), { wrapper });
    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });

  test("delegates to channel.send()", () => {
    const wrapper = createWrapper({ ping: mockSchema });

    const { result } = renderHook(() => useSend(), { wrapper });

    act(() => {
      result.current("ping", "hello");
    });

    expect(mockChannel.send).toHaveBeenCalledWith("ping", "hello");
  });
});

// ── createChannelHooks ────────────────────────────────────────────

describe("createChannelHooks", () => {
  beforeEach(() => {
    mockChannel = createMockChannel();
    vi.clearAllMocks();
  });

  test("creates typed hooks from schemas", () => {
    const hooks = createChannelHooks({ ping: mockSchema, pong: mockSchema });

    expect(hooks.ChannelProvider).toBeTypeOf("function");
    expect(hooks.useChannel).toBeTypeOf("function");
    expect(hooks.useChannelEvent).toBeTypeOf("function");
    expect(hooks.useSend).toBeTypeOf("function");
  });

  test("provider creates channel client once", () => {
    const schemas = { ping: mockSchema };
    const hooks = createChannelHooks(schemas);

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks.ChannelProvider, { children });
    }

    const { rerender } = renderHook(() => hooks.useChannel(), {
      wrapper: Wrapper,
    });
    rerender();

    expect(createChannelClient).toHaveBeenCalledTimes(1);
    expect(createChannelClient).toHaveBeenCalledWith({
      schemas,
      onValidationError: undefined,
    });
  });

  test("passes onValidationError option to createChannelClient", () => {
    const schemas = { ping: mockSchema };
    const onValidationError = vi.fn();
    const hooks = createChannelHooks(schemas, { onValidationError });

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks.ChannelProvider, { children });
    }

    renderHook(() => hooks.useChannel(), { wrapper: Wrapper });

    expect(createChannelClient).toHaveBeenCalledWith({
      schemas,
      onValidationError,
    });
  });

  test("useChannel returns channel from context", () => {
    const hooks = createChannelHooks({ ping: mockSchema });

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks.ChannelProvider, { children });
    }

    const { result } = renderHook(() => hooks.useChannel(), {
      wrapper: Wrapper,
    });

    expect(result.current).toBe(mockChannel);
  });

  test("useChannel throws when used outside provider", () => {
    const hooks = createChannelHooks({ ping: mockSchema });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => hooks.useChannel());
    }).toThrow(
      "useChannel() must be used inside the <ChannelProvider> returned by createChannelHooks().",
    );

    consoleSpy.mockRestore();
  });

  test("useChannelEvent subscribes and unsubscribes", () => {
    const hooks = createChannelHooks({ ping: mockSchema });
    const handler = vi.fn();

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks.ChannelProvider, { children });
    }

    const { unmount } = renderHook(() => hooks.useChannelEvent("ping", handler), {
      wrapper: Wrapper,
    });

    expect(mockChannel.on).toHaveBeenCalledTimes(1);
    expect(mockChannel.on).toHaveBeenCalledWith("ping", expect.any(Function));

    const subscribedHandler = vi.mocked(mockChannel.on).mock.calls[0]![1];
    unmount();

    expect(mockChannel.off).toHaveBeenCalledWith("ping", subscribedHandler);
  });

  test("useChannelEvent delivers payload to handler", () => {
    const hooks = createChannelHooks({ ping: mockSchema });
    const handler = vi.fn();

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks.ChannelProvider, { children });
    }

    renderHook(() => hooks.useChannelEvent("ping", handler), {
      wrapper: Wrapper,
    });

    mockChannel._simulateEvent("ping", "hello");

    expect(handler).toHaveBeenCalledWith("hello");
  });

  test("useSend delegates to channel.send()", () => {
    const hooks = createChannelHooks({ ping: mockSchema });

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks.ChannelProvider, { children });
    }

    const { result } = renderHook(() => hooks.useSend(), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current("ping", "hello");
    });

    expect(mockChannel.send).toHaveBeenCalledWith("ping", "hello");
  });

  test("useSend returns a stable function across re-renders", () => {
    const hooks = createChannelHooks({ ping: mockSchema });

    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks.ChannelProvider, { children });
    }

    const { result, rerender } = renderHook(() => hooks.useSend(), {
      wrapper: Wrapper,
    });
    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });

  test("each factory call creates independent contexts", () => {
    const hooks1 = createChannelHooks({ ping: mockSchema });
    const hooks2 = createChannelHooks({ pong: mockSchema });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // hooks2.useChannel should throw even when hooks1's provider is present
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(hooks1.ChannelProvider, { children });
    }

    expect(() => {
      renderHook(() => hooks2.useChannel(), { wrapper: Wrapper });
    }).toThrow(
      "useChannel() must be used inside the <ChannelProvider> returned by createChannelHooks().",
    );

    consoleSpy.mockRestore();
  });
});

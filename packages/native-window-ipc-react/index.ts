/**
 * React hooks for the native-window typed IPC channel (webview-side).
 *
 * Provides lifecycle wrappers around `createChannelClient` from
 * `@nativewindow/ipc/client` for use inside a React app
 * running in a native webview.
 *
 * The recommended approach is to use {@link createChannelHooks} to get
 * a set of pre-typed hooks that infer event types from your schemas:
 *
 * @example
 * ```tsx
 * import { z } from "zod";
 * import { createChannelHooks } from "@nativewindow/react";
 *
 * const { ChannelProvider, useChannel, useChannelEvent, useSend } =
 *   createChannelHooks({
 *     counter: z.number(),
 *     title: z.string(),
 *   });
 *
 * function App() {
 *   const send = useSend();
 *   useChannelEvent("title", (t) => { document.title = t; });
 *   return <button onClick={() => send("counter", 1)}>+1</button>;
 * }
 *
 * function Root() {
 *   return (
 *     <ChannelProvider>
 *       <App />
 *     </ChannelProvider>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

// ── Type re-exports ────────────────────────────────────────────────

export type {
  EventMap,
  SchemaLike,
  SchemaMap,
  InferSchemaMap,
  InferOutput,
  SendArgs,
  ValidationErrorHandler,
  TypedChannel,
} from "@nativewindow/ipc";

export type { ChannelClientOptions } from "@nativewindow/ipc/client";

// ── Imports ────────────────────────────────────────────────────────

import { createContext, createElement, useCallback, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type {
  EventMap,
  SendArgs,
  SchemaMap,
  InferSchemaMap,
  TypedChannel,
  ValidationErrorHandler,
} from "@nativewindow/ipc";
import { createChannelClient } from "@nativewindow/ipc/client";

// ── Context (internal) ─────────────────────────────────────────────

/** @internal React context holding the channel instance. */
const ChannelContext = createContext<TypedChannel<any> | null>(null);

// ── ChannelProvider ────────────────────────────────────────────────

/**
 * Props for {@link ChannelProvider}.
 *
 * @example
 * ```tsx
 * <ChannelProvider schemas={schemas}>
 *   <App />
 * </ChannelProvider>
 * ```
 */
export interface ChannelProviderProps<S extends SchemaMap> {
  /** Schemas for each event. Provides both TypeScript types and runtime validation. */
  schemas: S;
  /**
   * Called when an incoming payload fails schema validation.
   * If not provided, failed payloads are silently dropped.
   */
  onValidationError?: ValidationErrorHandler;
  /** React children. */
  children: ReactNode;
}

/**
 * Provides a typed IPC channel to the React tree.
 *
 * Creates the channel client exactly once (on initial mount) via
 * `createChannelClient` from `@nativewindow/ipc/client`.
 * The channel instance is stable for the lifetime of the provider.
 *
 * @example
 * ```tsx
 * import { z } from "zod";
 * import { ChannelProvider } from "@nativewindow/react";
 *
 * const schemas = {
 *   counter: z.number(),
 *   title: z.string(),
 * };
 *
 * function Root() {
 *   return (
 *     <ChannelProvider schemas={schemas}>
 *       <App />
 *     </ChannelProvider>
 *   );
 * }
 * ```
 */
export function ChannelProvider<S extends SchemaMap>(props: ChannelProviderProps<S>): ReactNode {
  const { schemas, onValidationError, children } = props;
  const channelRef = useRef<TypedChannel<InferSchemaMap<S>> | null>(null);

  if (channelRef.current === null) {
    channelRef.current = createChannelClient({ schemas, onValidationError });
  }

  return createElement(ChannelContext.Provider, { value: channelRef.current }, children);
}

// ── useChannel ─────────────────────────────────────────────────────

/**
 * Access the typed IPC channel from context.
 *
 * Must be called inside a {@link ChannelProvider}. Throws if the
 * provider is missing.
 *
 * @example
 * ```tsx
 * import { useChannel } from "@nativewindow/react";
 *
 * type Events = { counter: number; title: string };
 *
 * function StatusBar() {
 *   const channel = useChannel<Events>();
 *   channel.send("counter", 1);
 * }
 * ```
 */
export function useChannel<T extends EventMap = EventMap>(): TypedChannel<T> {
  const channel = useContext(ChannelContext);
  if (channel === null) {
    throw new Error("useChannel() must be used inside a <ChannelProvider>.");
  }
  return channel as TypedChannel<T>;
}

// ── useChannelEvent ────────────────────────────────────────────────

/**
 * Subscribe to a specific IPC event type with automatic cleanup.
 *
 * The handler is stored in a ref to avoid re-subscribing when the
 * handler function identity changes between renders. The subscription
 * itself only re-runs when `type` changes.
 *
 * @example
 * ```tsx
 * import { useChannelEvent } from "@nativewindow/react";
 *
 * type Events = { title: string };
 *
 * function TitleDisplay() {
 *   useChannelEvent<Events, "title">("title", (title) => {
 *     document.title = title;
 *   });
 *   return null;
 * }
 * ```
 */
export function useChannelEvent<
  T extends EventMap = EventMap,
  K extends keyof T & string = keyof T & string,
>(type: K, handler: (payload: T[K]) => void): void {
  const channel = useChannel<T>();
  const handlerRef = useRef(handler);

  // Keep the ref current without re-subscribing
  handlerRef.current = handler;

  useEffect(() => {
    const stableHandler = (payload: T[K]): void => {
      handlerRef.current(payload);
    };

    channel.on(type, stableHandler);
    return () => {
      channel.off(type, stableHandler);
    };
  }, [channel, type]);
}

// ── useSend ────────────────────────────────────────────────────────

/**
 * Returns a stable `send` function from the channel.
 *
 * A convenience wrapper around `useChannel().send`. The returned
 * function has a stable identity (does not change between renders).
 *
 * @example
 * ```tsx
 * import { useSend } from "@nativewindow/react";
 *
 * type Events = { counter: number; title: string };
 *
 * function Counter() {
 *   const send = useSend<Events>();
 *   return <button onClick={() => send("counter", 1)}>Increment</button>;
 * }
 * ```
 */
export function useSend<T extends EventMap = EventMap>(): <K extends keyof T & string>(
  ...args: SendArgs<T, K>
) => void {
  const channel = useChannel<T>();

  return useCallback(
    <K extends keyof T & string>(...args: SendArgs<T, K>): void => {
      channel.send(...args);
    },
    [channel],
  );
}

// ── createChannelHooks (factory) ───────────────────────────────────

/**
 * Options for {@link createChannelHooks}.
 *
 * @example
 * ```tsx
 * createChannelHooks(schemas, {
 *   onValidationError: (type, payload) => console.warn(type, payload),
 * });
 * ```
 */
export interface ChannelHooksOptions {
  /**
   * Called when an incoming payload fails schema validation.
   * If not provided, failed payloads are silently dropped.
   */
  onValidationError?: ValidationErrorHandler;
}

/**
 * The set of pre-typed React hooks and provider returned by
 * {@link createChannelHooks}.
 *
 * All hooks are bound to the same internal context and typed to `T`,
 * so event names and payload types are inferred automatically without
 * requiring generic type parameters at the call site.
 */
export interface TypedChannelHooks<T extends EventMap> {
  /**
   * Context provider that creates the channel client once.
   * Wrap your React app with this at the root.
   */
  ChannelProvider: (props: { children: ReactNode }) => ReactNode;
  /** Access the typed channel from context. Throws if outside the provider. */
  useChannel: () => TypedChannel<T>;
  /** Subscribe to a typed event with automatic cleanup. */
  useChannelEvent: <K extends keyof T & string>(type: K, handler: (payload: T[K]) => void) => void;
  /** Returns a stable typed `send` function. */
  useSend: () => <K extends keyof T & string>(...args: SendArgs<T, K>) => void;
}

/**
 * Create a set of pre-typed React hooks for the IPC channel.
 *
 * Types are inferred from the `schemas` argument — no need to pass
 * generic type parameters to individual hooks. Each call creates its
 * own React context, so multiple independent channels are supported.
 *
 * @example
 * ```tsx
 * import { z } from "zod";
 * import { createChannelHooks } from "@nativewindow/react";
 *
 * // Types are inferred: { counter: number; title: string }
 * const { ChannelProvider, useChannel, useChannelEvent, useSend } =
 *   createChannelHooks({
 *     counter: z.number(),
 *     title: z.string(),
 *   });
 *
 * function App() {
 *   const send = useSend();                        // fully typed
 *   useChannelEvent("title", (t) => {              // t: string
 *     document.title = t;
 *   });
 *   return <button onClick={() => send("counter", 1)}>+1</button>;
 * }
 *
 * function Root() {
 *   return (
 *     <ChannelProvider>
 *       <App />
 *     </ChannelProvider>
 *   );
 * }
 * ```
 */
export function createChannelHooks<S extends SchemaMap>(
  schemas: S,
  options?: ChannelHooksOptions,
): TypedChannelHooks<InferSchemaMap<S>> {
  type T = InferSchemaMap<S>;

  // Each factory call gets its own context — supports multiple channels
  const HooksContext = createContext<TypedChannel<T> | null>(null);

  function HooksProvider(props: { children: ReactNode }): ReactNode {
    const channelRef = useRef<TypedChannel<T> | null>(null);

    if (channelRef.current === null) {
      channelRef.current = createChannelClient({
        schemas,
        onValidationError: options?.onValidationError,
      });
    }

    return createElement(HooksContext.Provider, { value: channelRef.current }, props.children);
  }

  function hooks_useChannel(): TypedChannel<T> {
    const channel = useContext(HooksContext);
    if (channel === null) {
      throw new Error(
        "useChannel() must be used inside the <ChannelProvider> returned by createChannelHooks().",
      );
    }
    return channel;
  }

  function hooks_useChannelEvent<K extends keyof T & string>(
    type: K,
    handler: (payload: T[K]) => void,
  ): void {
    const channel = hooks_useChannel();
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
      const stableHandler = (payload: T[K]): void => {
        handlerRef.current(payload);
      };

      channel.on(type, stableHandler);
      return () => {
        channel.off(type, stableHandler);
      };
    }, [channel, type]);
  }

  function hooks_useSend(): <K extends keyof T & string>(...args: SendArgs<T, K>) => void {
    const channel = hooks_useChannel();

    return useCallback(
      <K extends keyof T & string>(...args: SendArgs<T, K>): void => {
        channel.send(...args);
      },
      [channel],
    );
  }

  return {
    ChannelProvider: HooksProvider,
    useChannel: hooks_useChannel,
    useChannelEvent: hooks_useChannelEvent,
    useSend: hooks_useSend,
  };
}

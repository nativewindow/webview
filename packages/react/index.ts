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
 *     host: { title: z.string() },
 *     client: { counter: z.number() },
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
const ChannelContext = createContext<TypedChannel<any, any> | null>(null);

// ── ChannelProvider ────────────────────────────────────────────────

/**
 * Props for {@link ChannelProvider}.
 *
 * @example
 * ```tsx
 * <ChannelProvider schemas={{ host: hostSchemas, client: clientSchemas }}>
 *   <App />
 * </ChannelProvider>
 * ```
 */
export interface ChannelProviderProps<H extends SchemaMap, C extends SchemaMap> {
  /**
   * Directional schemas for the channel.
   * - `host`: events the host sends to the client (validated on receive).
   * - `client`: events the client sends to the host (type-checked on send).
   */
  schemas: { host: H; client: C };
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
 *   host: { title: z.string() },
 *   client: { counter: z.number() },
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
export function ChannelProvider<H extends SchemaMap, C extends SchemaMap>(
  props: ChannelProviderProps<H, C>,
): ReactNode {
  const { schemas, onValidationError, children } = props;
  const channelRef = useRef<TypedChannel<InferSchemaMap<C>, InferSchemaMap<H>> | null>(null);

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
 * @typeParam Send - Events this side can send (client events).
 * @typeParam Receive - Events this side can receive (host events).
 *
 * @example
 * ```tsx
 * import { useChannel } from "@nativewindow/react";
 *
 * type ClientEvents = { counter: number };
 * type HostEvents = { title: string };
 *
 * function StatusBar() {
 *   const channel = useChannel<ClientEvents, HostEvents>();
 *   channel.send("counter", 1);
 * }
 * ```
 */
export function useChannel<
  Send extends EventMap = EventMap,
  Receive extends EventMap = EventMap,
>(): TypedChannel<Send, Receive> {
  const channel = useContext(ChannelContext);
  if (channel === null) {
    throw new Error("useChannel() must be used inside a <ChannelProvider>.");
  }
  return channel as TypedChannel<Send, Receive>;
}

// ── useChannelEvent ────────────────────────────────────────────────

/**
 * Subscribe to a specific incoming IPC event type with automatic cleanup.
 *
 * The handler is stored in a ref to avoid re-subscribing when the
 * handler function identity changes between renders. The subscription
 * itself only re-runs when `type` changes.
 *
 * @typeParam Receive - The event map for incoming (receivable) events.
 * @typeParam K - The specific event key to subscribe to.
 *
 * @example
 * ```tsx
 * import { useChannelEvent } from "@nativewindow/react";
 *
 * type HostEvents = { title: string };
 *
 * function TitleDisplay() {
 *   useChannelEvent<HostEvents, "title">("title", (title) => {
 *     document.title = title;
 *   });
 *   return null;
 * }
 * ```
 */
export function useChannelEvent<
  Receive extends EventMap = EventMap,
  K extends keyof Receive & string = keyof Receive & string,
>(type: K, handler: (payload: Receive[K]) => void): void {
  const channel = useChannel<EventMap, Receive>();
  const handlerRef = useRef(handler);

  // Keep the ref current without re-subscribing
  handlerRef.current = handler;

  useEffect(() => {
    const stableHandler = (payload: Receive[K]): void => {
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
 * @typeParam Send - The event map for outgoing (sendable) events.
 *
 * @example
 * ```tsx
 * import { useSend } from "@nativewindow/react";
 *
 * type ClientEvents = { counter: number };
 *
 * function Counter() {
 *   const send = useSend<ClientEvents>();
 *   return <button onClick={() => send("counter", 1)}>Increment</button>;
 * }
 * ```
 */
export function useSend<Send extends EventMap = EventMap>(): <K extends keyof Send & string>(
  ...args: SendArgs<Send, K>
) => void {
  const channel = useChannel<Send, EventMap>();

  return useCallback(
    <K extends keyof Send & string>(...args: SendArgs<Send, K>): void => {
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
 * All hooks are bound to the same internal context and typed with
 * separate Send/Receive maps, so event names and payload types are
 * inferred automatically without requiring generic type parameters
 * at the call site.
 *
 * @typeParam Send - Events the client sends to the host.
 * @typeParam Receive - Events the client receives from the host.
 */
export interface TypedChannelHooks<Send extends EventMap, Receive extends EventMap> {
  /**
   * Context provider that creates the channel client once.
   * Wrap your React app with this at the root.
   */
  ChannelProvider: (props: { children: ReactNode }) => ReactNode;
  /** Access the typed channel from context. Throws if outside the provider. */
  useChannel: () => TypedChannel<Send, Receive>;
  /** Subscribe to a typed incoming (host) event with automatic cleanup. */
  useChannelEvent: <K extends keyof Receive & string>(
    type: K,
    handler: (payload: Receive[K]) => void,
  ) => void;
  /** Returns a stable typed `send` function for outgoing (client) events. */
  useSend: () => <K extends keyof Send & string>(...args: SendArgs<Send, K>) => void;
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
 * // Types are inferred from directional schemas
 * const { ChannelProvider, useChannel, useChannelEvent, useSend } =
 *   createChannelHooks({
 *     host: { title: z.string() },
 *     client: { counter: z.number() },
 *   });
 *
 * function App() {
 *   const send = useSend();                        // fully typed (client events)
 *   useChannelEvent("title", (t) => {              // t: string (host events)
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
export function createChannelHooks<H extends SchemaMap, C extends SchemaMap>(
  schemas: { host: H; client: C },
  options?: ChannelHooksOptions,
): TypedChannelHooks<InferSchemaMap<C>, InferSchemaMap<H>> {
  // Client sends C events, receives H events
  type Send = InferSchemaMap<C>;
  type Receive = InferSchemaMap<H>;

  // Each factory call gets its own context — supports multiple channels
  const HooksContext = createContext<TypedChannel<Send, Receive> | null>(null);

  function HooksProvider(props: { children: ReactNode }): ReactNode {
    const channelRef = useRef<TypedChannel<Send, Receive> | null>(null);

    if (channelRef.current === null) {
      channelRef.current = createChannelClient({
        schemas,
        onValidationError: options?.onValidationError,
      });
    }

    return createElement(HooksContext.Provider, { value: channelRef.current }, props.children);
  }

  function hooks_useChannel(): TypedChannel<Send, Receive> {
    const channel = useContext(HooksContext);
    if (channel === null) {
      throw new Error(
        "useChannel() must be used inside the <ChannelProvider> returned by createChannelHooks().",
      );
    }
    return channel;
  }

  function hooks_useChannelEvent<K extends keyof Receive & string>(
    type: K,
    handler: (payload: Receive[K]) => void,
  ): void {
    const channel = hooks_useChannel();
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
      const stableHandler = (payload: Receive[K]): void => {
        handlerRef.current(payload);
      };

      channel.on(type, stableHandler);
      return () => {
        channel.off(type, stableHandler);
      };
    }, [channel, type]);
  }

  function hooks_useSend(): <K extends keyof Send & string>(...args: SendArgs<Send, K>) => void {
    const channel = hooks_useChannel();

    return useCallback(
      <K extends keyof Send & string>(...args: SendArgs<Send, K>): void => {
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

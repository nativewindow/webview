import { z } from "zod";

// In a real app, put these in a shared file (e.g. shared/schemas.ts).
export const schemas = {
  /** Webview -> Bun: counter incremented */
  setCounter: z.number(),
  randomize: z.void(),
  /** Bun -> Webview: echo back the last message */
  counter: z.number(),
};

export type IpcSchemas = typeof schemas;

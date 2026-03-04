import { z } from "zod";

// In a real app, put these in a shared file (e.g. shared/schemas.ts).
export const schemas = {
  host: {
    /** Bun -> Webview: echo back the last message */
    counter: z.number(),
  },
  client: {
    /** Webview -> Bun: counter incremented */
    setCounter: z.number(),
    randomize: z.void(),
  },
};

export type IpcSchemas = typeof schemas;

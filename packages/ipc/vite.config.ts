import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import dts from "vite-plugin-dts";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "index.ts"),
        client: resolve(__dirname, "client.ts"),
      },
      formats: ["es"],
    },
    outDir: "dist",
    minify: false,
    rollupOptions: {
      external: ["@nativewindow/webview", "zod"],
    },
  },
  plugins: [dts({ tsconfigPath: "./tsconfig.build.json" }) as any],
});

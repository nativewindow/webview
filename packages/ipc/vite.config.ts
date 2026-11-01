import { resolve } from "node:path";
import { defineConfig, lazyPlugins } from "vite-plus";
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
  plugins: lazyPlugins(() => [dts({ tsconfigPath: "./tsconfig.build.json" })]),
});

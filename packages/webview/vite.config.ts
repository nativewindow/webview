import { resolve } from "node:path";
import { defineConfig, lazyPlugins } from "vite-plus";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    minify: false,
    rollupOptions: {
      external: [
        "node:module",
        // Platform-specific native addon packages
        /^@nativewindow\/webview-/,
      ],
    },
  },
  plugins: lazyPlugins(() => [
    dts({
      tsconfigPath: "./tsconfig.build.json",
      outDir: "dist",
    }),
  ]),
});

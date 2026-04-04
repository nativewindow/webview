import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "index.ts"),
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
  plugins: [
    dts({
      tsconfigPath: "./tsconfig.build.json",
    }),
  ],
});

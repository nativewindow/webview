import { resolve } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import dts from "vite-plugin-dts";

/**
 * Rewrites `./native-window.js` imports to `../native-window.js` so the
 * built output in `dist/` correctly resolves the napi binding at the
 * package root.
 */
function rewriteNativeImport(): Plugin {
  return {
    name: "rewrite-native-import",
    enforce: "pre",
    resolveId(source) {
      if (source === "./native-window.js") {
        return { id: "../native-window.js", external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    minify: false,
  },
  plugins: [
    rewriteNativeImport(),
    dts({
      tsconfigPath: "./tsconfig.build.json",
      beforeWriteFile: (filePath, content) => ({
        filePath,
        content: content.replace(/\.\/native-window\.js/g, "../native-window.js"),
      }),
    }),
  ],
});

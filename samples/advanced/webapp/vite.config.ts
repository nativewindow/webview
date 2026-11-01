import type { PluginOption } from "vite-plus";
import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// https://vite.dev/config/
export default defineConfig({
  plugins: lazyPlugins(() => [react(), viteSingleFile() as PluginOption]),
});

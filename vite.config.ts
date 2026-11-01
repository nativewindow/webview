import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/*.md", "**/*.mdx"],
    printWidth: 100,
    tabWidth: 2,
    singleQuote: false,
    semi: true,
    trailingComma: "all",
  },
  test: {
    projects: ["packages/ipc", "packages/react", "packages/tsdb"],
  },
});

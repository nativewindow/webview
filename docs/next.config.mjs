import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  images: {
    unoptimized: true,
  },
  experimental: {
    turbopackFileSystemCacheForBuild: true,
    turbopackFileSystemCacheForDev: true,
  },
  reactCompiler: true,
  reactStrictMode: true,
};

export default withMDX(config);

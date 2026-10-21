import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local-only test database (loaded dynamically, never bundled).
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    root: path.resolve("."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

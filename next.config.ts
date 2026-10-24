import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hides the round "N" badge shown in `next dev` (it never appears in production builds).
  devIndicators: false,
  // Local-only test database and the native canvas used to render scanned PDF pages (both loaded dynamically, never bundled).
  serverExternalPackages: ["@electric-sql/pglite", "@napi-rs/canvas"],
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

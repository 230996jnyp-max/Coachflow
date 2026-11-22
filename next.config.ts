import path from "node:path";
import type { NextConfig } from "next";

/**
 * Headers sent with every response. Camera, microphone and location stay available to the app itself (barcode and QR scanning, "Hey
 * Flow", nearby places) and are off for anything embedded. `frame-ancestors 'none'` (with X-Frame-Options for older browsers) stops
 * the app being shown inside another site, which is how a "clickjacking" trick is set up. `object-src`, `base-uri` and `form-action`
 * close three other well-known gaps. Script and style sources are not restricted here yet: the app's own inline scripts need a
 * per-request nonce first (see the security review notes), and a wrong rule would break the live site.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(self), usb=(), serial=(), bluetooth=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Signed-in answers are never kept by a browser or a shared cache. (Pictures under /api/media set their own, longer rule.)
      { source: "/api/:path((?!media/).*)", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  // A second dev server in the same folder (for testing next to the main one) needs its own build folder: set NEXT_DIST_DIR=.next-test
  distDir: process.env.NEXT_DIST_DIR || ".next",
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

import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

/**
 * React's development build needs `eval` (and a websocket for hot reload), so
 * the policy is relaxed for `next dev` only. Without this the dev server
 * serves a page that never hydrates. Production keeps the strict policy.
 */
const scriptSrc = ["'self'", "'unsafe-inline'", isDevelopment ? "'unsafe-eval'" : null]
  .filter(Boolean)
  .join(" ");
const connectSrc = ["'self'", isDevelopment ? "ws: http://127.0.0.1:* http://localhost:*" : null]
  .filter(Boolean)
  .join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src ${connectSrc}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), interest-cohort=()",
  },
];

/** Sensitive routes are never indexed and never cached. */
const privateHeaders = [
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
];

const config: NextConfig = {
  // The dev server is reached over 127.0.0.1 during end-to-end runs.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/quiz", headers: privateHeaders },
      { source: "/quiz/:path*", headers: privateHeaders },
      { source: "/results", headers: privateHeaders },
      { source: "/results/:path*", headers: privateHeaders },
      { source: "/compare", headers: privateHeaders },
      { source: "/compare/:path*", headers: privateHeaders },
      { source: "/api/:path*", headers: privateHeaders },
    ];
  },
};

export default config;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {},
};

// TODO(Wave 2): wrap with withSentryConfig from @sentry/nextjs
// import { withSentryConfig } from "@sentry/nextjs";
// export default withSentryConfig(nextConfig, { silent: true });
export default nextConfig;

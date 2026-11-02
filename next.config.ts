import type { NextConfig } from "next";

// Inlined at build into server and client bundles, so /api/version and the client's
// VersionWatcher compare values from the same build ('dev' disables the watcher).
const appVersion = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || 'dev';

const nextConfig: NextConfig = {
  env: { CC_APP_VERSION: appVersion },
};

export default nextConfig;

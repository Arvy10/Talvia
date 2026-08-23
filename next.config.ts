import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This checkout runs alongside the parent workspace; isolate generated
  // development artifacts so the two Next processes never contend for a lock.
  distDir: ".next-talvia",
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;

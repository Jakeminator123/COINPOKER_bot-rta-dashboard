/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Allow cross-origin dev access from local network devices
  allowedDevOrigins: [
    '192.168.68.*',  // Local network devices
    '192.168.*.*',   // All local network ranges
    'localhost',     // Localhost variants
    '127.0.0.1'
  ],

  experimental: {
    serverActions: { allowedOrigins: ['*'] }
  },
  // Turbopack configuration (moved from experimental.turbo)
  turbopack: {
    root: process.cwd(), // Explicitly set the root to current working directory
    resolveAlias: {
      // Optimize module resolution
    }
  },
  // Skip type checking during dev for faster builds
  typescript: {
    ignoreBuildErrors: false,
    tsconfigPath: './tsconfig.json'
  }
};
export default nextConfig;

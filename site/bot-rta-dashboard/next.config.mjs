/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // QUICK WIN: Performance & Security improvements
  compress: true,              // Enable gzip compression
  poweredByHeader: false,      // Remove X-Powered-By header for security

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
  // Turbopack configuration
  turbopack: {
    root: process.cwd()
  },
  // Skip type checking during dev for faster builds
  typescript: {
    ignoreBuildErrors: false,
    tsconfigPath: './tsconfig.json'
  }
};
export default nextConfig;

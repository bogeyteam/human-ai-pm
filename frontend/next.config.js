/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // We don't run ESLint in the CI build path right now; the dependency
  // isn't installed, so Vercel fails out. Lint locally when adding it
  // back later (`pnpm install --save-dev eslint eslint-config-next`).
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;

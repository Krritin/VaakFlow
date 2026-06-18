/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Foundation build should never be blocked by lint; keep type-checking on.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

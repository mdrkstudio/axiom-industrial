import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // WebGL post-processing owns imperative GPU resources; double-mounting the
  // renderer in development can invalidate its context before passes attach.
  reactStrictMode: false,
  poweredByHeader: false,
  compress: true,
}

export default nextConfig

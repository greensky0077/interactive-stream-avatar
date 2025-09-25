/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "files.heygen.ai",
      },
      {
        protocol: "https",
        hostname: "files2.heygen.ai",
      },
    ],
  },
  // Handle font loading issues gracefully
  experimental: {
    optimizePackageImports: ['@radix-ui/react-icons'],
  },
}

export default nextConfig

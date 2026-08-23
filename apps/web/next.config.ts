import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Tenant/user images are served only through ownership-checked BFF artifacts;
  // do not invoke Next's sharp/libvips optimizer on untrusted media.
  images: { unoptimized: true },
};

export default nextConfig;

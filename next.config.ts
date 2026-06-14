import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;

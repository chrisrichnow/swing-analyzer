import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "ffmpeg-static",
    "ffprobe-static",
    "@tensorflow/tfjs-core",
    "@tensorflow/tfjs-converter",
    "@tensorflow/tfjs-backend-wasm",
    "@tensorflow-models/pose-detection",
  ],
  experimental: {
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;

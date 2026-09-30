import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 用 127.0.0.1 打开时，Chrome 会带上 Origin。不放行的话开发态 WebSocket 会被拒绝，页面停在加载。
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["unpdf"],
  experimental: {
    proxyClientMaxBodySize: "80mb",
    serverActions: {
      bodySizeLimit: "80mb",
    },
  },
};

export default nextConfig;

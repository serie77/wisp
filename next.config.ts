import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "@solana/web3.js"],
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  async redirects() {
    return [{ source: "/docs", destination: "/ai", permanent: false }, { source: "/docs/:path*", destination: "/ai", permanent: false }];
  },
  async headers() {
    const cors = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET, POST, DELETE, OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Authorization, X-API-Key, Content-Type, If-None-Match" },
      { key: "Access-Control-Expose-Headers", value: "ETag" },
    ];
    return ["/api/:path*", "/mcp", "/openapi.json", "/skill.md", "/llms.txt", "/.well-known/:path*", "/m/:path*"].map((source) => ({ source, headers: cors }));
  },
};

export default nextConfig;

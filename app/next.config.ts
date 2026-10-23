import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Los JSON de data/ se leen en el servidor; hay que incluirlos en el bundle
  // de las funciones de Vercel porque no se importan de forma estática.
  outputFileTracingIncludes: { "/**": ["./data/**/*.json"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

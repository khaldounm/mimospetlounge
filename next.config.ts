import type { NextConfig } from "next";
import path from "node:path";

const ROBOTS_HEADER_VALUE =
  "noindex, nofollow, noarchive, nosnippet, noimageindex";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next.js doesn't pick up a stray lockfile in $HOME.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async redirects() {
    return [
      // The account page used to live here; old bookmarks still do.
      { source: "/reset-password", destination: "/account", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: ROBOTS_HEADER_VALUE,
          },
        ],
      },
    ];
  },
};

export default nextConfig;

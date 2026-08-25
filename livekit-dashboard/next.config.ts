import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["livekit-server-sdk"],
  transpilePackages: ["@tremor/react", "@livekit/components-react", "@livekit/components-styles"],
};

export default nextConfig;

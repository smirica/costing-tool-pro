import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Vinext treats multipart POSTs as progressive server-action requests before
    // dispatching route handlers. Keep this above the app's 20 MB file limit so
    // multipart boundaries and headers do not reject otherwise valid PDFs.
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;

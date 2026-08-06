/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // uploads are base64-encoded over the server action, which inflates size ~33%;
      // 7MB (our upload cap) + encoding overhead needs headroom above the 1mb default.
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;

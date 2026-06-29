/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "community.cloudflare.steamstatic.com" },
      { protocol: "https", hostname: "steamcommunity-a.akamaihd.net" },
      { protocol: "https", hostname: "steamcdn-a.akamaihd.net" },
    ],
  },
};

export default nextConfig;

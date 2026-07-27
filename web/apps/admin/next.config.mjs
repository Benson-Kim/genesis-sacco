/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@genesis/tokens', '@genesis/ui', '@genesis/api-client'],
  eslint: {
    // We run `next lint --max-warnings 0` as a separate, explicit CI step
    // (web:lint); don't let `next build` silently re-run a looser pass.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

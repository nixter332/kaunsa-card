// Analytics go through this site's own address (/kc-relay) instead of posthog.com,
// so privacy browsers like Brave don't silently drop them. PostHog recommends this setup.
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
const assets = host.replace("://eu.i.", "://eu-assets.i.").replace("://us.i.", "://us-assets.i.");

/** @type {import('next').NextConfig} */
export default {
  skipTrailingSlashRedirect: true, // PostHog's API paths end in "/"
  async rewrites() {
    return [
      { source: "/kc-relay/static/:path*", destination: `${assets}/static/:path*` },
      { source: "/kc-relay/:path*", destination: `${host}/:path*` },
    ];
  },
};

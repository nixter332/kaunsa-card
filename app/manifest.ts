import type { MetadataRoute } from "next";

// Makes the site installable: "Add to Home Screen" opens it full-screen like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kaunsa Card",
    short_name: "Kaunsa Card",
    description: "Pick the credit card that gives the most back on every payment.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d1311",
    theme_color: "#0d1311",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Bridgeport Severe Weather",
    short_name: "BSW",
    description: "Hyperlocal severe-weather tracking for Bridgeport, Chicago",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0b1119",
    theme_color: "#1d3a56",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/api/app-icon?v=2",
        sizes: "192x192",
        type: "image/jpeg",
        purpose: "any",
      },
    ],
  };
}

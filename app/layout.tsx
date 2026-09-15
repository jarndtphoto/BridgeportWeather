import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./bright-theme.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Bridgeport Storm Watch",
  description: "Hyperlocal severe-weather tracking for Bridgeport, Chicago",
  applicationName: "BSW",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "BSW",
  },
  icons: {
    icon: [
      { url: "/bsw-icon.png?v=4", sizes: "1254x1254", type: "image/png" },
    ],
    apple: [
      { url: "/bsw-icon.png?v=4", sizes: "1254x1254", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d3a56",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./bright-theme.css";
import "leaflet/dist/leaflet.css";

export const metadata: Metadata = {
  title: "Bridgeport Storm Watch",
  description: "Hyperlocal severe-weather tracking for Bridgeport, Chicago",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d3a56",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

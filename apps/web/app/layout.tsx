import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import ServiceWorkerRegister from "../components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "VaakFlow — Voice Field Assistant",
  description: "Hands-free voice assistant for solar-farm field maintenance.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "VaakFlow", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#07080b" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

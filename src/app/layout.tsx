import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CoachFlow — PT Tracker & Booking",
  description:
    "Personal trainer client tracker, Hevy-style workout logger and session booking app.",
  applicationName: "CoachFlow",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "CoachFlow",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/pwa-icon/192", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/pwa-icon/180", sizes: "180x180", type: "image/png" }],
  },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#090B10",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("coachflow_theme");if(t!=="white"&&t!=="navy")t="black";var d=document.documentElement;d.setAttribute("data-theme",t);d.style.colorScheme=t==="white"?"light":"dark";var c={black:"#090B10",white:"#F8FAFC",navy:"#0A1128"}[t];var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="black" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Applies the saved theme before the first paint (no flash). Black is the default. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full bg-bg text-ink">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";

import "./globals.css";

/* Almanac — type loading.
 *
 * next/font/google does not yet export IBM Plex Sans SC (the Simplified
 * Chinese face), even though Google Fonts publishes it. The other three
 * Plex families ship via next/font for self-host + zero-CLS. Plex Sans SC
 * is loaded via <link> tags below so the bilingual pairing still lands
 * on day one. When next-font/google exposes IBM_Plex_Sans_SC in a future
 * Next.js release, swap the <link> for an import and update globals.css
 * so --font-plex-sc points at the injected variable. */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["italic"],
  variable: "--font-plex-serif",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI Manager Platform",
  description: "Single-state, agent-driven project management for small teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexSerif.variable} ${plexMono.variable}`}
    >
      <head>
        {/* IBM Plex Sans SC — loaded directly because next/font/google
            does not export the SC face yet. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+SC:wght@400;500;600&display=swap"
        />
        {/* B5 — apply the saved theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.theme==='dark')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen bg-paper text-ink antialiased">
        {children}
      </body>
    </html>
  );
}

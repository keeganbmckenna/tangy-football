import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { getThemeBootstrapScript, THEME_COLORS } from "@/lib/theme";
import { ThemeProvider } from "@/hooks/useTheme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tangy Football",
  description: "Advanced fantasy football analytics and insights powered by Sleeper. Track standings, analyze weekly performance, and discover season trends.",
  keywords: ["fantasy football", "sleeper", "analytics", "statistics", "football"],
  authors: [{ name: "Fantasy Football Analytics" }],
  appleWebApp: { capable: true, title: "Tangy Football", statusBarStyle: "black" },
  openGraph: {
    title: "Tangy Football",
    description: "Advanced fantasy football analytics and insights",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: getThemeBootstrapScript(),
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
        {/* FantasyCalc's terms ask for a link in the page's first HTML, wherever their values are used */}
        <footer className="pb-6 text-center text-xs text-[var(--muted)]">
          Trade market values from{' '}
          <a href="https://fantasycalc.com" target="_blank" rel="noreferrer" className="underline">
            FantasyCalc
          </a>
        </footer>
      </body>
    </html>
  );
}

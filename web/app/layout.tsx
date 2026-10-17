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
  title: "Tangy Football - Fantasy Football Analytics",
  description: "Advanced fantasy football analytics and insights powered by Sleeper. Track standings, analyze weekly performance, and discover season trends.",
  keywords: ["fantasy football", "sleeper", "analytics", "statistics", "football"],
  authors: [{ name: "Fantasy Football Analytics" }],
  appleWebApp: { capable: true, title: "Tangy Football", statusBarStyle: "black" },
  openGraph: {
    title: "Tangy Football - Fantasy Football Analytics",
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
      </body>
    </html>
  );
}

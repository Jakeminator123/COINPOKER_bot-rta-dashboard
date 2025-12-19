/**
 * Root Layout
 * ===========
 * Alias: "Layout" | "Root" | "App Layout"
 * File: app/layout.tsx
 *
 * The root layout wrapping all pages. Provides:
 * - NextAuth SessionProvider for authentication
 * - Global fonts (Space Grotesk, Geist Mono)
 * - Global styles
 * - Vercel Analytics
 */
import type { Metadata } from "next";
import { Space_Grotesk, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import SessionProviderWrapper from "@/components/SessionProviderWrapper";
import { DarkModeProvider } from "@/lib/DarkModeContext";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Bot & RTA Detection Dashboard",
  description: "Real-time bot and RTA detection system for online poker",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <SessionProviderWrapper>
          <DarkModeProvider>{children}</DarkModeProvider>
        </SessionProviderWrapper>
        <Analytics />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MyResend - Self-hosted Mail Gateway with Resend-compatible API",
  description:
    "Open-source, self-hosted mail gateway built on Amazon SES v2 with a Resend-compatible API and DNS provider abstraction (DigitalOcean / Route53).",
  keywords: "resend alternative, self-hosted email, amazon ses, ses v2, route53, transactional email, email api, open source, mail gateway",
  authors: [{ name: "Park Seunghun / Orchemi", url: "https://github.com/Orchemi" }],
  creator: "Park Seunghun / Orchemi",
  openGraph: {
    title: "MyResend - Self-hosted Mail Gateway",
    description: "Resend-compatible API • Amazon SES backend • Self-hosted, open-source",
    url: "https://github.com/Orchemi/my-resend",
    siteName: "MyResend",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MyResend - Self-hosted Mail Gateway",
    description: "Resend-compatible API • Amazon SES backend • Self-hosted, open-source",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

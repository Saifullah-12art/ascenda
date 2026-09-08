import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Ascenda",
  description: "Rise every day.",
};

// The app is dark-only, so the browser's own chrome — mobile Safari's address
// bar, Chrome's task-switcher header — is tinted to the page color instead of
// framing the app in white.
export const viewport: Viewport = {
  themeColor: "#070B16",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="bg-page">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-page font-sans text-ink antialiased`}
      >
        {children}
      </body>
    </html>
  );
}

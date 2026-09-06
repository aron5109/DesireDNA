import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "DesireDNA — Decode what you both desire", template: "%s | DesireDNA" },
  description:
    "A private 18+ preference quiz for consenting adults. Answer privately, receive your DesireCode, and compare mutual interests.",
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: "#0c080e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

/**
 * The header and footer live in the pages that want them, so the quiz can own
 * the whole screen without marketing chrome competing for space.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}

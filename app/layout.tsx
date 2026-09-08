import type { Metadata } from "next";
import "./globals.css";
import "./clause.css";
import "./readability.css";

export const metadata: Metadata = {
  title: "Clause — A clearer point of view",
  description: "Your private PDF workspace. Understand documents with source-grounded AI, share securely, and review together.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

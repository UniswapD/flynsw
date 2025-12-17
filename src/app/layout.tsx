import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlyNSW - NSW Paragliding Conditions",
  description: "Real-time flyability scores for NSW paragliding sites",
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

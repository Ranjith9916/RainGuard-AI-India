import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Flood-AI Weather · India Inundation Early Warning System",
  description:
    "AI/ML-Based Integrated Heavy Rainfall Early Warning & Inundation Prediction System for India. Real-time weather, satellite rainfall, flood detection, and cloudburst prediction.",
  keywords: [
    "RainGuard-AI",
    "India flood warning",
    "inundation monitoring",
    "NASA IMERG",
    "OpenWeatherMap",
    "OpenStreetMap",
    "disaster management",
    "monsoon tracking",
    "cloudburst prediction",
    "Next.js",
  ],
  authors: [{ name: "Flood-AI System" }],
  openGraph: {
    title: "Flood-AI Weather · India",
    description: "Real-time pan-India inundation early warning matrix",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

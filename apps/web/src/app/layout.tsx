import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import FeedbackButton from "@/components/FeedbackButton";
import { verifySession } from "@/lib/auth/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mentors International",
  description: "AI-powered mentorship for micro-entrepreneurs",
  icons: {
    icon: "/mentors_international_logo.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await verifySession();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <FeedbackButton userRole={session?.role ?? null} />
      </body>
    </html>
  );
}

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
  title: "Audio Montage — MP3 to music-reactive video",
  description: "Drop in an MP3 and get a music-reactive MP4 video. Powered by ffmpeg + librosa, inspired by OpenMontage.",
  keywords: ["audio visualizer", "mp3 to video", "music video generator", "ffmpeg", "OpenMontage"],
  authors: [{ name: "Audio Montage" }],
  icons: { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
  openGraph: {
    title: "Audio Montage — MP3 to music-reactive video",
    description: "Drop in an MP3 and get a music-reactive MP4. Powered by ffmpeg + librosa.",
    url: "https://chat.z.ai",
    siteName: "Audio Montage",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "Audio Montage", description: "Drop MP3 → get a music-reactive MP4." },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}

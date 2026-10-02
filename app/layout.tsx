import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Kalam, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });
const serif = Source_Serif_4({ variable: "--font-serif-4", subsets: ["latin"], weight: ["400", "600", "700"] });
// Handwriting for anything a student or examiner writes by hand. Kalam is by the Indian Type Foundry.
const hand = Kalam({ variable: "--font-kalam", subsets: ["latin"], weight: ["300", "400", "700"] });

export const metadata: Metadata = {
  title: "Intellect - Study-to-Grade",
  description: "See where your answer loses marks, by your college's rubric and what your professor actually taught, before you hand it in.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable} ${hand.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

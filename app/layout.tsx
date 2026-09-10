import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "布局验证台｜微购店铺装修方案",
  description: "用同一批商品素材比较三种可复刻的微购首页布局。",
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
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import "./constraints.css";
import "./mvp-actions.css";
import "./metrics.css";
import "./test-category.css";

export const metadata: Metadata = {
  title: "店铺装修生成｜微购首页方案",
  description: "上传商品与经营目标，生成三套可在微购复刻的完整店铺首页。",
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

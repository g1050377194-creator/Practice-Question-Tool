import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "二造600母题",
  description: "2026 二级造价工程师《600母题》选择题练习，科目为土木建筑工程与建设工程造价管理。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}

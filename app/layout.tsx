import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "모임픽 | 모일 날짜 정하기",
  description: "링크를 보내면 각자 안 되는 날을 표시하고, 다 같이 되는 날을 바로 알려줘요.",
  openGraph: {
    title: "모임픽 | 모일 날짜 정하기",
    description: "안 되는 날만 표시해 주세요. 다 같이 되는 날을 바로 알려드려요.",
    locale: "ko_KR",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f2f3ef",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

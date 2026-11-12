import type { Metadata } from "next";
import { Suspense } from "react";
import { EVENT_ID_PATTERN } from "@/lib/api";
import { getStore } from "@/lib/store";
import EventClient from "./EventClient";

// 카카오톡 등에 링크를 붙였을 때 모임 이름이 미리보기에 뜨게 한다
export async function generateMetadata({ params }: PageProps<"/e/[id]">): Promise<Metadata> {
  const { id } = await params;
  try {
    const event = EVENT_ID_PATTERN.test(id) ? await getStore().getEvent(id) : null;
    if (!event) return {};
    const title = `${event.title} 날짜 정하기`;
    const description = "안 되는 날만 눌러 주세요. 1분이면 끝나요.";
    return { title, description, openGraph: { title, description, locale: "ko_KR", type: "website" } };
  } catch {
    return {};
  }
}

export default function EventPage() {
  return (
    <Suspense
      fallback={
        <main className="page">
          <p className="brand">모임픽</p>
          <p className="status">모임을 불러오는 중…</p>
        </main>
      }
    >
      <EventClient />
    </Suspense>
  );
}

import { Suspense } from "react";
import EventClient from "./EventClient";

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

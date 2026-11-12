import { fail, handleError, isAdminRequest, json } from "@/lib/api";
import { confirmedOf, eventSlots } from "@/lib/slots";
import { getStore } from "@/lib/store";

// 저장된 모든 모임 (사이트 관리자만)
export async function GET(request: Request) {
  try {
    const store = getStore();
    if (!(await isAdminRequest(request, store)))
      return fail("관리자만 볼 수 있어요.", 403);
    const events = await store.listAllEvents(500);
    events.sort((a, b) => b.createdAt - a.createdAt);
    const counts = await Promise.all(
      events.map((e) => store.countResponses(e.id)),
    );
    const owners = await Promise.all(
      events.map((e) =>
        e.hostHash ? store.getHostAccount(e.hostHash) : Promise.resolve(null),
      ),
    );
    return json({
      events: events.map((e, i) => ({
        id: e.id,
        title: e.title,
        start: e.dates[0],
        end: e.dates[e.dates.length - 1],
        slots: eventSlots(e),
        createdAt: e.createdAt,
        responses: counts[i],
        /** 만든 모임장의 계정 아이디 (계정 없이 만든 모임은 null) */
        owner: owners[i],
        searchable: e.searchable !== false,
        confirmed: confirmedOf(e),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

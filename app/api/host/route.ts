import { fail, handleError, hostHashOf, json, readBody, tooMany } from "@/lib/api";
import { confirmedOf, eventSlots, parseSlotKey } from "@/lib/slots";
import { getStore } from "@/lib/store";

const BLOCKS_MAX = 600;

// 모임장 본인의 "안 되는 시간"과 만든 모임 목록
export async function GET(request: Request) {
  try {
    const store = getStore();
    const hostHash = await hostHashOf(request, store);
    if (!hostHash) return fail("모임장 정보가 없어요.", 401);
    const [host, events, account] = await Promise.all([
      store.getHost(hostHash),
      store.listHostEvents(hostHash),
      store.getHostAccount(hostHash),
    ]);
    events.sort((a, b) => b.createdAt - a.createdAt);
    return json({
      account,
      blocks: host?.blocks ?? [],
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.dates[0],
        end: e.dates[e.dates.length - 1],
        slots: eventSlots(e),
        confirmed: confirmedOf(e),
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}

// 모임장 본인의 "안 되는 시간" 저장
export async function PUT(request: Request) {
  const body = await readBody(request);
  if (!body || !Array.isArray(body.blocks)) return fail("요청 형식이 올바르지 않아요.");
  const blocks = [
    ...new Set(body.blocks.filter((k): k is string => typeof k === "string" && parseSlotKey(k) !== null)),
  ].sort();
  if (blocks.length > BLOCKS_MAX) return fail("안 되는 시간이 너무 많아요.");
  try {
    const store = getStore();
    const hostHash = await hostHashOf(request, store);
    if (!hostHash) return fail("모임장 정보가 없어요.", 401);
    if (await tooMany(request, "host", 120, store.hit)) {
      return fail("요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.", 429);
    }
    await store.putHost(hostHash, { blocks, updatedAt: Date.now() });
    return json({ blocks });
  } catch (error) {
    return handleError(error);
  }
}

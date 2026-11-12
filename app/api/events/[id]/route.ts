import {
  EVENT_ID_PATTERN,
  fail,
  handleError,
  json,
  publicEvent,
  readBody,
  sha256,
} from "@/lib/api";
import { isStation } from "@/lib/stations";
import { getStore } from "@/lib/store";
import type { EventPayload } from "@/lib/types";

// 모임 정보 + 지금까지의 응답
export async function GET(_request: Request, ctx: RouteContext<"/api/events/[id]">) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요. 링크가 맞는지 확인해 주세요.", 404);
    // 검색 기능이 생기기 전에 만든 모임도 한 번 열리면 검색 목록에 올린다
    if (event.searchable === undefined) await store.setIndexed(event, true);
    const responses = await store.listResponses(id);
    responses.sort((a, b) => a.updatedAt - b.updatedAt);
    const payload: EventPayload = { event: publicEvent(event), responses };
    return json(payload);
  } catch (error) {
    return handleError(error);
  }
}

// 모임 삭제 (만든 사람만: 관리용 토큰 필요)
export async function DELETE(request: Request, ctx: RouteContext<"/api/events/[id]">) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  const token = request.headers.get("x-admin-token") ?? "";
  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요.", 404);
    if (!event.adminHash || !token || (await sha256(token)) !== event.adminHash) {
      return fail("이 모임을 지울 권한이 없어요. 모임을 만든 기기나 관리 링크로 열어 주세요.", 403);
    }
    await store.deleteEvent(id);
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

// 날짜·장소 확정 또는 확정 취소 (주최자만)
export async function PATCH(request: Request, ctx: RouteContext<"/api/events/[id]">) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  const token = request.headers.get("x-admin-token") ?? "";
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");
  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요.", 404);
    if (!event.adminHash || !token || (await sha256(token)) !== event.adminHash) {
      return fail("주최자만 확정할 수 있어요.", 403);
    }
    if (body.confirmed === null) {
      event.confirmed = null;
    } else {
      const c = body.confirmed as { date?: unknown; station?: unknown } | undefined;
      const date = typeof c?.date === "string" ? c.date : "";
      const station = typeof c?.station === "string" ? c.station : "";
      if (!event.dates.includes(date)) return fail("후보에 있는 날짜만 확정할 수 있어요.");
      if (station && !isStation(station)) return fail("목록에 있는 역만 고를 수 있어요.");
      event.confirmed = { date, station };
    }
    await store.createEvent(event); // 같은 키에 덮어쓴다
    return json({ event: publicEvent(event) });
  } catch (error) {
    return handleError(error);
  }
}


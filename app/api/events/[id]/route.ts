import {
  canManage,
  EVENT_ID_PATTERN,
  fail,
  handleError,
  hostHashOf,
  json,
  publicEvent,
  readBody,
  sha256,
} from "@/lib/api";
import { blockedFor } from "@/lib/blocks";
import { eventSlots, normalizeUnavailable, slotKey } from "@/lib/slots";
import { isStation } from "@/lib/stations";
import { getStore } from "@/lib/store";
import type { EventPayload, Slot } from "@/lib/types";

type Ctx = RouteContext<"/api/events/[id]">;

// 모임 정보 + 지금까지의 응답 + 고를 수 없는 칸
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event)
      return fail("모임을 찾을 수 없어요. 링크가 맞는지 확인해 주세요.", 404);
    // 검색 기능이 생기기 전에 만든 모임도 한 번 열리면 검색 목록에 올린다
    if (event.searchable === undefined) await store.setIndexed(event, true);
    const [responses, blocked, manage] = await Promise.all([
      store.listResponses(id),
      blockedFor(event, store),
      canManage(request, event, store),
    ]);
    responses.sort((a, b) => a.updatedAt - b.updatedAt);
    const payload: EventPayload = {
      event: { ...publicEvent(event), slots: eventSlots(event) },
      responses: responses.map((r) => ({
        ...r,
        unavailable: normalizeUnavailable(event, r.unavailable),
      })),
      blocked,
      canManage: manage,
      hosted: Boolean(event.hostHash),
    };
    return json(payload);
  } catch (error) {
    return handleError(error);
  }
}

// 모임 삭제 (모임을 만든 기기 또는 모임장)
export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요.", 404);
    if (!(await canManage(request, event, store))) {
      return fail(
        "이 모임을 지울 권한이 없어요. 모임을 만든 기기나 관리 링크로 열어 주세요.",
        403,
      );
    }
    await store.deleteEvent(id);
    if (event.hostHash) await store.linkHostEvent(event.hostHash, id, false);
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

// 확정·확정 취소, 모임장 계정에 묶기 (관리 권한 필요)
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");
  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요.", 404);

    // 모임장 계정에 묶기: 모임을 만든 기기(관리 토큰)에서만 가능
    if (body.claim === true) {
      const admin = request.headers.get("x-admin-token") ?? "";
      const hostHash = await hostHashOf(request, store);
      if (
        !admin ||
        !event.adminHash ||
        (await sha256(admin)) !== event.adminHash ||
        !hostHash
      ) {
        return fail("모임을 만든 기기에서만 할 수 있어요.", 403);
      }
      if (event.hostHash !== hostHash) {
        if (event.hostHash)
          await store.linkHostEvent(event.hostHash, id, false);
        event.hostHash = hostHash;
        await store.createEvent(event);
        await store.linkHostEvent(hostHash, id, true);
      }
      return json({ ok: true });
    }

    if (!(await canManage(request, event, store)))
      return fail("모임장만 확정할 수 있어요.", 403);

    if (body.confirmed === null) {
      event.confirmed = null;
    } else {
      const c = body.confirmed as
        { date?: unknown; slot?: unknown; station?: unknown } | undefined;
      const date = typeof c?.date === "string" ? c.date : "";
      const station = typeof c?.station === "string" ? c.station : "";
      const slots = eventSlots(event);
      const slot =
        slots.find((s) => s === c?.slot) ??
        (slots.length === 1 ? slots[0] : null);
      if (!event.dates.includes(date))
        return fail("후보에 있는 날짜만 확정할 수 있어요.");
      if (!slot) return fail("점심인지 저녁인지 골라 주세요.");
      if (station && !isStation(station))
        return fail("목록에 있는 역만 고를 수 있어요.");
      const blocked = await blockedFor(event, store);
      if (blocked[slotKey(date, slot as Slot)]) {
        return fail("그 시간은 모임장 일정과 겹쳐서 확정할 수 없어요.", 409);
      }
      event.confirmed = { date, slot, station };
    }
    await store.createEvent(event); // 같은 키에 덮어쓴다
    return json({ event: publicEvent(event) });
  } catch (error) {
    return handleError(error);
  }
}

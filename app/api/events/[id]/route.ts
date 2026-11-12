import { EVENT_ID_PATTERN, fail, handleError, json, publicEvent, sha256 } from "@/lib/api";
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


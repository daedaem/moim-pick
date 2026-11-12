import { EVENT_ID_PATTERN, fail, handleError, json } from "@/lib/api";
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
    const payload: EventPayload = { event, responses };
    return json(payload);
  } catch (error) {
    return handleError(error);
  }
}

import { cleanLine, EVENT_ID_PATTERN, fail, handleError, json, readBody } from "@/lib/api";
import { getStore } from "@/lib/store";
import { LIMITS } from "@/lib/types";

type Ctx = RouteContext<"/api/events/[id]/responses">;

function validName(value: unknown): string | null {
  const name = cleanLine(value);
  if (!name || name.length > LIMITS.nameMax) return null;
  return name;
}

// 내 응답 저장 (같은 이름이면 덮어씀)
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");

  const name = validName(body.name);
  if (!name) return fail(`이름을 1~${LIMITS.nameMax}자로 입력해 주세요.`);
  if (!Array.isArray(body.unavailable)) return fail("날짜 정보가 올바르지 않아요.");

  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요.", 404);

    // 후보 날짜에 없는 값은 버린다
    const candidates = new Set(event.dates);
    const picked = new Set(
      body.unavailable.filter((d): d is string => typeof d === "string" && candidates.has(d)),
    );
    const unavailable = event.dates.filter((d) => picked.has(d));

    const exists = await store.hasResponse(id, name);
    if (!exists && (await store.countResponses(id)) >= LIMITS.participantsMax) {
      return fail(`한 모임에 ${LIMITS.participantsMax}명까지만 응답할 수 있어요.`, 409);
    }

    const response = { name, unavailable, updatedAt: Date.now() };
    await store.putResponse(id, response);
    return json({ response });
  } catch (error) {
    return handleError(error);
  }
}

// 내 응답 지우기
export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  const body = await readBody(request);
  const name = validName(body?.name);
  if (!name) return fail("이름이 올바르지 않아요.");
  try {
    await getStore().deleteResponse(id, name);
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

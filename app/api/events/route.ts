import { cleanLine, fail, handleError, json, newEventId, readBody } from "@/lib/api";
import { buildCandidates, parseYmd } from "@/lib/dates";
import { getStore } from "@/lib/store";
import { LIMITS, type MoimEvent } from "@/lib/types";

// 모임 만들기
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");

  const title = cleanLine(body.title);
  const memo = cleanLine(body.memo);
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  const weekdays = Array.isArray(body.weekdays)
    ? [...new Set(body.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))]
    : [];

  if (!title) return fail("모임 이름을 입력해 주세요.");
  if (title.length > LIMITS.titleMax) return fail(`모임 이름은 ${LIMITS.titleMax}자까지 쓸 수 있어요.`);
  if (memo.length > LIMITS.memoMax) return fail(`메모는 ${LIMITS.memoMax}자까지 쓸 수 있어요.`);

  const s = parseYmd(start);
  const e = parseYmd(end);
  if (!s || !e) return fail("시작일과 종료일을 골라 주세요.");
  if (s > e) return fail("종료일이 시작일보다 빨라요.");
  const span = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  if (span > LIMITS.rangeDaysMax) return fail(`기간은 최대 ${LIMITS.rangeDaysMax}일까지 잡을 수 있어요.`);
  if (weekdays.length === 0) return fail("요일을 하나 이상 골라 주세요.");

  const dates = buildCandidates(start, end, weekdays);
  if (dates.length === 0) return fail("이 기간에는 고른 요일에 해당하는 날이 없어요.");

  try {
    const store = getStore();
    const event: MoimEvent = { id: newEventId(), title, memo, dates, createdAt: Date.now() };
    await store.createEvent(event);
    return json({ event }, 201);
  } catch (error) {
    return handleError(error);
  }
}

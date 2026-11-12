import {
  accountOf,
  cleanLine,
  fail,
  handleError,
  json,
  newAdminToken,
  newEventId,
  publicEvent,
  readBody,
  sha256,
  tooMany,
} from "@/lib/api";
import { addDays, buildCandidates, parseYmd } from "@/lib/dates";
import { SLOT_ORDER } from "@/lib/slots";
import { getStore } from "@/lib/store";
import {
  LIMITS,
  type EventSummary,
  type MoimEvent,
  type Slot,
} from "@/lib/types";

// 모임 만들기
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");

  const title = cleanLine(body.title);
  const memo = cleanLine(body.memo);
  const start = typeof body.start === "string" ? body.start : "";
  const end = typeof body.end === "string" ? body.end : "";
  const weekdays = Array.isArray(body.weekdays)
    ? [
        ...new Set(
          body.weekdays.filter(
            (d): d is number => Number.isInteger(d) && d >= 0 && d <= 6,
          ),
        ),
      ]
    : [];
  const requested = Array.isArray(body.slots) ? body.slots : ["D"];
  const slots: Slot[] = SLOT_ORDER.filter((s) => requested.includes(s));

  if (!title) return fail("모임 이름을 입력해 주세요.");
  if (title.length > LIMITS.titleMax)
    return fail(`모임 이름은 ${LIMITS.titleMax}자까지 쓸 수 있어요.`);
  if (memo.length > LIMITS.memoMax)
    return fail(`메모는 ${LIMITS.memoMax}자까지 쓸 수 있어요.`);
  if (slots.length === 0) return fail("점심, 저녁 중 하나 이상 골라 주세요.");

  const s = parseYmd(start);
  const e = parseYmd(end);
  if (!s || !e) return fail("시작일과 종료일을 골라 주세요.");
  if (s > e) return fail("종료일이 시작일보다 빨라요.");
  // 이미 다 지난 기간으로는 만들지 않는다 (시간대 차이를 감안해 하루 여유를 둔다)
  if (end < addDays(new Date().toISOString().slice(0, 10), -1))
    return fail("이미 지난 날짜예요. 기간을 다시 골라 주세요.");
  const span = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  if (span > LIMITS.rangeDaysMax)
    return fail(`기간은 최대 ${LIMITS.rangeDaysMax}일까지 잡을 수 있어요.`);
  if (weekdays.length === 0) return fail("요일을 하나 이상 골라 주세요.");

  const dates = buildCandidates(start, end, weekdays);
  if (dates.length === 0)
    return fail("이 기간에는 고른 요일에 해당하는 날이 없어요.");

  try {
    const store = getStore();
    // 모임은 로그인한 사람만 만들 수 있다 (누가 만든 모임인지 항상 남는다)
    const owner = await accountOf(request, store);
    if (!owner) return fail("모임을 만들려면 먼저 로그인해 주세요.", 401);
    if (await tooMany(request, "create", 20, store.hit)) {
      return fail(
        "모임을 너무 많이 만들었어요. 한 시간 뒤에 다시 시도해 주세요.",
        429,
      );
    }
    // 관리용 토큰은 만든 사람에게 이번 한 번만 알려 주고, 서버에는 해시만 남긴다
    const adminToken = newAdminToken();
    const hostHash = owner.hostHash;
    const event: MoimEvent = {
      id: newEventId(),
      title,
      memo,
      dates,
      slots,
      createdAt: Date.now(),
      adminHash: await sha256(adminToken),
      searchable: body.searchable !== false,
      hostHash,
    };
    await store.createEvent(event);
    if (event.searchable) await store.setIndexed(event, true);
    await store.linkHostEvent(hostHash, event.id, true);
    return json({ event: publicEvent(event), adminToken }, 201);
  } catch (error) {
    return handleError(error);
  }
}

// 모임 이름으로 찾기. 검색을 허용한 모임만, 제목과 기간만 돌려준다.
export async function GET(request: Request) {
  const q = cleanLine(new URL(request.url).searchParams.get("q")).toLowerCase();
  if (q.length < 2) return json({ events: [] });
  try {
    const events = await getStore().listIndexed(300);
    const compact = q.replace(/\s+/g, "");
    const found: EventSummary[] = events
      .filter((e) => e.searchable !== false)
      .filter((e) =>
        e.title.toLowerCase().replace(/\s+/g, "").includes(compact),
      )
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        title: e.title,
        memo: e.memo,
        start: e.dates[0],
        end: e.dates[e.dates.length - 1],
      }));
    return json({ events: found });
  } catch (error) {
    return handleError(error);
  }
}

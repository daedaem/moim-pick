import { displayName } from "@/lib/account";
import {
  canManage,
  cleanLine,
  EVENT_ID_PATTERN,
  fail,
  handleError,
  hostHashOf,
  json,
  parseExpected,
  publicEvent,
  readBody,
  sha256,
} from "@/lib/api";
import { blockedFor, bumpHostEvents } from "@/lib/blocks";
import { eventSlots, normalizeUnavailable, slotKey } from "@/lib/slots";
import { isStation } from "@/lib/stations";
import { getStore } from "@/lib/store";
import { LIMITS, type EventPayload, type Slot } from "@/lib/types";

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
    const [responses, blocked, manage, version, hostKey] = await Promise.all([
      store.listResponses(id),
      blockedFor(event, store),
      canManage(request, event, store),
      store.getVersion(id),
      event.hostHash ? store.getHostAccount(event.hostHash) : null,
    ]);
    responses.sort((a, b) => a.updatedAt - b.updatedAt);
    // 이름을 '모임장에게만' 공개한 응답은 모임장·본인 기기가 아니면 가린다
    const deviceToken = request.headers.get("x-device-token") ?? "";
    const myDevice = /^[0-9a-f]{20,64}$/.test(deviceToken)
      ? await sha256(deviceToken)
      : "";
    const used = new Set<string>();
    const payload: EventPayload = {
      event: { ...publicEvent(event), slots: eventSlots(event) },
      responses: responses.map(({ deviceHash, ...r }) => {
        const mine = Boolean(myDevice && deviceHash === myDevice);
        const masked = Boolean(r.hidden && !manage && !mine);
        let name = r.name;
        if (masked) {
          const base = maskName(r.name);
          name = base;
          for (let n = 2; used.has(name); n++) name = `${base} (${n})`;
        }
        used.add(name);
        return {
          ...r,
          name,
          masked,
          unavailable: normalizeUnavailable(event, r.unavailable),
        };
      }),
      blocked,
      canManage: manage,
      hosted: Boolean(event.hostHash),
      version,
      hostName: displayName(hostKey),
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
    if (event.hostHash) {
      await store.linkHostEvent(event.hostHash, id, false);
      // 확정된 모임이었다면 다른 모임에서 막혀 있던 날이 풀린다
      if (event.confirmed) await bumpHostEvents(event.hostHash, store);
    }
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
      return fail("모임장만 바꿀 수 있어요.", 403);

    // 모임 정보 바꾸기 (이름, 예상 인원)
    if (typeof body.title === "string" || "expected" in body) {
      if (typeof body.title === "string") {
        const title = cleanLine(body.title);
        if (!title) return fail("모임 이름을 입력해 주세요.");
        if (title.length > LIMITS.titleMax)
          return fail(`모임 이름은 ${LIMITS.titleMax}자까지 쓸 수 있어요.`);
        event.title = title;
      }
      if ("expected" in body) {
        const expected = parseExpected(body.expected);
        if (expected === undefined)
          return fail(
            `예상 인원은 2~${LIMITS.participantsMax}명 사이로 적어 주세요.`,
          );
        if (expected) event.expected = expected;
        else delete event.expected;
      }
      await store.createEvent(event); // 같은 키에 덮어쓴다
      return json({ event: publicEvent(event) });
    }

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
    // 같은 모임장의 다른 모임은 이 확정 때문에 막히는 날이 바뀐다
    if (event.hostHash) await bumpHostEvents(event.hostHash, store);
    return json({ event: publicEvent(event) });
  } catch (error) {
    return handleError(error);
  }
}

/** "김민수" → "김*수", "김수" → "김*" */
function maskName(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

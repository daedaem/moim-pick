import {
  canManage,
  cleanLine,
  EVENT_ID_PATTERN,
  fail,
  handleError,
  json,
  newAdminToken,
  readBody,
  sha256,
  tooMany,
} from "@/lib/api";
import { normalizeUnavailable } from "@/lib/slots";
import { isStation } from "@/lib/stations";
import { getStore } from "@/lib/store";
import { LIMITS, RELATIONS, type MoimEvent } from "@/lib/types";

type Ctx = RouteContext<"/api/events/[id]/responses">;

function validName(value: unknown): string | null {
  const name = cleanLine(value);
  if (!name || name.length > LIMITS.nameMax) return null;
  return name;
}

/**
 * 이미 있는 응답을 고치거나 지울 수 있는지 확인한다.
 * 응답한 기기(수정 토큰)이거나 모임 관리 권한이 있어야 한다.
 * 수정 토큰이 생기기 전에 저장된 응답(editHash 없음)은 관리자만 손댈 수 있다.
 */
async function mayChange(
  request: Request,
  event: MoimEvent,
  editHash: string,
): Promise<boolean> {
  if (await canManage(request, event)) return true;
  const edit = request.headers.get("x-edit-token") ?? "";
  return Boolean(edit && editHash && (await sha256(edit)) === editHash);
}

// 내 응답 저장
export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");

  const name = validName(body.name);
  if (!name) return fail(`이름을 1~${LIMITS.nameMax}자로 입력해 주세요.`);
  const relation = cleanLine(body.relation);
  if (!(RELATIONS as readonly string[]).includes(relation))
    return fail("관계를 골라 주세요.");
  const station = cleanLine(body.station);
  if (station && !isStation(station))
    return fail("목록에 있는 역을 골라 주세요.");
  if (!Array.isArray(body.unavailable))
    return fail("날짜 정보가 올바르지 않아요.");

  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요.", 404);

    // 이 모임에 없는 칸은 버린다
    const unavailable = normalizeUnavailable(event, body.unavailable);

    if (await tooMany(request, "respond", 120, store.hit)) {
      return fail("요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.", 429);
    }

    const current = await store.getResponseMeta(id, name);
    const deviceToken = request.headers.get("x-device-token") ?? "";
    const deviceHash = /^[0-9a-f]{20,64}$/.test(deviceToken) ? await sha256(deviceToken) : "";
    let meta = current ?? { editHash: "", deviceHash };
    let editToken: string | undefined;

    if (current === null) {
      const manage = await canManage(request, event);
      // 한 기기에서는 한 번만 응답한다 (모임장은 다른 사람 대신 입력할 수 있다)
      if (deviceHash && !manage) {
        const already = await store.findNameByDevice(id, deviceHash);
        if (already) {
          return fail(
            `이 기기에서는 이미 '${already}' 이름으로 응답했어요. 그 응답을 고쳐 주세요. 다른 사람이라면 본인 휴대폰에서 응답해 주세요.`,
            409,
          );
        }
      }
      if ((await store.countResponses(id)) >= LIMITS.participantsMax) {
        return fail(`한 모임에 ${LIMITS.participantsMax}명까지만 응답할 수 있어요.`, 409);
      }
      // 새 응답: 이 기기만 아는 수정 토큰을 발급한다
      editToken = newAdminToken();
      // 모임장이 대신 입력한 응답은 모임장 기기에 묶지 않는다
      meta = { editHash: await sha256(editToken), deviceHash: manage ? "" : deviceHash };
    } else if (!(await mayChange(request, event, current.editHash))) {
      return fail(
        "이미 같은 이름으로 응답한 사람이 있어요. 다른 사람이라면 이름을 조금 다르게 적어 주세요. 본인이라면 응답했던 기기에서 고칠 수 있어요.",
        409,
      );
    }

    const response = {
      name,
      relation,
      station,
      unavailable,
      updatedAt: Date.now(),
    };
    await store.putResponse(id, response, meta);
    return json({ response, editToken });
  } catch (error) {
    return handleError(error);
  }
}

// 응답 지우기 (응답한 기기 또는 주최자)
export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  const body = await readBody(request);
  const name = validName(body?.name);
  if (!name) return fail("이름이 올바르지 않아요.");
  try {
    const store = getStore();
    const event = await store.getEvent(id);
    if (!event) return fail("모임을 찾을 수 없어요.", 404);
    const current = await store.getResponseMeta(id, name);
    if (current === null) return json({ ok: true });
    if (!(await mayChange(request, event, current.editHash))) {
      return fail("이 응답은 응답한 기기나 주최자만 지울 수 있어요.", 403);
    }
    await store.deleteResponse(id, name);
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

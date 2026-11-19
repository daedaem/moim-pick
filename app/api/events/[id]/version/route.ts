import { EVENT_ID_PATTERN, fail, handleError, json } from "@/lib/api";
import { getStore } from "@/lib/store";

/**
 * 자동 새로고침용: 모임 화면 내용이 바뀌었는지만 가볍게 확인한다 (데이터베이스 호출 1번).
 * 번호가 달라졌을 때만 화면이 전체 내용을 다시 불러온다.
 */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/events/[id]/version">,
) {
  const { id } = await ctx.params;
  if (!EVENT_ID_PATTERN.test(id)) return fail("모임을 찾을 수 없어요.", 404);
  try {
    return json({ version: await getStore().getVersion(id) });
  } catch (error) {
    return handleError(error);
  }
}

import { handleError, json, sha256 } from "@/lib/api";
import { getStore } from "@/lib/store";

// 로그아웃: 이 기기의 로그인 세션을 지운다
export async function POST(request: Request) {
  const token = request.headers.get("x-host-token") ?? "";
  try {
    if (/^[0-9a-f]{32,64}$/.test(token))
      await getStore().deleteSession(await sha256(token));
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

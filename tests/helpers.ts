// 테스트 공용: 라우트 함수를 서버 없이 바로 부른다 (메모리 저장소 사용)
import { randomBytes } from "node:crypto";

// 라우트마다 두 번째 인자(ctx) 타입이 달라서 넓게 받는다
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (request: Request, ctx: any) => Promise<Response>;

/** 테스트에서 응답 본문은 자유롭게 읽는다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;

let ipSeq = 0;
/** 도배 방지 횟수 제한에 걸리지 않게 요청마다 다른 IP를 쓴다 */
const nextIp = () => `10.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}.1`;

export const device = () => randomBytes(16).toString("hex");

export async function call(
  handler: Handler,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    id?: string;
    query?: string;
  } = {},
): Promise<{ status: number; body: Body }> {
  const { method = "GET", body, headers = {}, id, query = "" } = options;
  const request = new Request(`http://test/api${query}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextIp(),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = id ? { params: Promise.resolve({ id }) } : undefined;
  const res = await handler(request, ctx);
  return { status: res.status, body: (await res.json()) as Body };
}

/** 가입하고 세션 토큰을 돌려준다 */
export async function signupAs(
  signup: Handler,
  id: string,
  name: string,
  pin: string,
): Promise<string> {
  const res = await call(signup, {
    method: "POST",
    body: { id, name, pin },
    headers: { "x-host-token": device() },
  });
  if (res.status !== 201)
    throw new Error(`가입 실패 ${id}: ${res.status} ${res.body.error}`);
  return res.body.token as string;
}

/** 오늘부터 며칠 뒤 (YYYY-MM-DD) */
export function daysFromNow(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

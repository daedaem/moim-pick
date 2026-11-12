import { StoreNotConfiguredError } from "./store";

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function fail(message: string, status = 400) {
  return json({ error: message }, status);
}

export function handleError(error: unknown) {
  if (error instanceof StoreNotConfiguredError) {
    return fail(
      "저장소가 아직 연결되지 않았어요. Vercel 프로젝트의 Storage 탭에서 Upstash Redis를 연결한 뒤 다시 배포해 주세요.",
      503,
    );
  }
  console.error(error);
  return fail("서버에서 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.", 500);
}

export async function readBody(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 이름·제목 등 한 줄 입력값 정리: 앞뒤 공백 제거, 연속 공백 하나로 */
export function cleanLine(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

export const EVENT_ID_PATTERN = /^[a-z0-9]{8}$/;

export function newEventId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // 헷갈리는 글자(l, o, 0, 1) 제외
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

/** 모임을 만든 사람만 아는 관리용 토큰 */
export function newAdminToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** 응답으로 내보낼 때는 관리용 해시를 뺀다 */
export function publicEvent<T extends { adminHash?: string }>(
  event: T,
): Omit<T, "adminHash"> {
  const { adminHash: _omit, ...rest } = event;
  void _omit;
  return rest;
}

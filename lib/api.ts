import { unstable_rethrow } from "next/navigation";
import { isSiteAdmin } from "./admin";
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
  // Next.js가 내부적으로 던지는 신호(미리 그리기 중단 등)는 삼키지 않고 그대로 넘긴다
  unstable_rethrow(error);
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

/** 응답으로 내보낼 때는 관리용·모임장 해시를 뺀다 */
export function publicEvent<
  T extends { adminHash?: string; hostHash?: string },
>(event: T): Omit<T, "adminHash" | "hostHash"> {
  const { adminHash: _a, hostHash: _h, ...rest } = event;
  void _a;
  void _h;
  return rest;
}

type SessionSource = {
  getSessionHost(sessionHash: string): Promise<string | null>;
  getHostAccount(hostHash: string): Promise<string | null>;
};

/**
 * 요청에 실린 모임장 토큰이 가리키는 모임장 해시 (없으면 빈 문자열).
 * 토큰은 두 가지다: 계정으로 로그인해서 받은 세션 토큰, 또는 계정 없이 브라우저가 만든 토큰.
 */
export async function hostHashOf(
  request: Request,
  store: SessionSource,
): Promise<string> {
  const token = request.headers.get("x-host-token") ?? "";
  if (!/^[0-9a-f]{32,64}$/.test(token)) return "";
  const hash = await sha256(token);
  const fromSession = await store.getSessionHost(hash);
  if (fromSession) return fromSession;
  // 계정이 있는 모임장은 로그인 세션으로만 인정한다.
  // 계정을 만들기 전에 쓰던 브라우저 토큰이나 모임장 링크는 그때부터 통하지 않는다.
  return (await store.getHostAccount(hash)) ? "" : hash;
}

/**
 * 로그인한 계정으로 온 요청이면 모임장 해시와 계정 이름을 돌려준다. 아니면 null.
 * 모임 만들기처럼 로그인이 꼭 필요한 일에 쓴다.
 */
export async function accountOf(
  request: Request,
  store: SessionSource,
): Promise<{ hostHash: string; account: string } | null> {
  const hostHash = await hostHashOf(request, store);
  if (!hostHash) return null;
  const account = await store.getHostAccount(hostHash);
  return account ? { hostHash, account } : null;
}

/**
 * 이 요청이 모임을 관리할 수 있는지.
 * 모임을 만든 기기(관리 토큰)이거나, 그 모임의 모임장이거나, 사이트 관리자여야 한다.
 */
export async function canManage(
  request: Request,
  event: { adminHash?: string; hostHash?: string },
  store: SessionSource,
): Promise<boolean> {
  const admin = request.headers.get("x-admin-token") ?? "";
  if (admin && event.adminHash && (await sha256(admin)) === event.adminHash)
    return true;
  const host = await hostHashOf(request, store);
  if (!host) return false;
  if (event.hostHash && host === event.hostHash) return true;
  // 사이트 관리자 계정은 모든 모임을 관리할 수 있다
  return isSiteAdmin(await store.getHostAccount(host));
}

/**
 * 같은 곳(IP)에서 너무 자주 요청하면 true. 한 시간 단위로 센다.
 * 회사·학교처럼 여러 사람이 한 IP를 쓰는 경우가 있어 한도는 넉넉하게 잡는다.
 */
export async function tooMany(
  request: Request,
  action: string,
  limitPerHour: number,
  hit: (key: string, windowSeconds: number) => Promise<number>,
): Promise<boolean> {
  const ip =
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
  return (await hit(`${action}:${ip}`, 3600)) > limitPerHour;
}

/** 이 요청이 사이트 관리자 계정으로 로그인한 것인지 */
export async function isAdminRequest(
  request: Request,
  store: SessionSource,
): Promise<boolean> {
  const host = await hostHashOf(request, store);
  return host ? isSiteAdmin(await store.getHostAccount(host)) : false;
}

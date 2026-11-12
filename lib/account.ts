import { newAdminToken, sha256 } from "./api";
import type { getStore } from "./store";

type Store = ReturnType<typeof getStore>;

// 모임장 계정: 아이디 + 숫자 4자리.
// 숫자 4자리는 경우의 수가 1만 개뿐이라, 틀린 횟수를 세서 잠그는 것이 실제 방어선이다.

export const PIN_PATTERN = /^\d{4}$/;
export const FAILS_PER_15_MIN = 5;
export const FAILS_PER_DAY = 20;

/**
 * 계정 이름 정리. 실명 형태(한글 2~5자)만 받는다. 맞지 않으면 null.
 * 실제로 본인 이름인지까지 확인하지는 못한다. 영문·숫자·기호가 섞인 별명을 막는 정도다.
 */
export function normalizeAccountId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.normalize("NFC").replace(/\s+/g, "");
  return /^[가-힣]{2,5}$/.test(id) ? id : null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/** 숫자를 그대로 두지 않고, 계정마다 다른 소금값과 함께 여러 번 섞은 값만 저장한다 */
export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations: 120_000,
    },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

/** 로그인 세션을 만들고, 브라우저에 줄 토큰을 돌려준다 (서버에는 해시만 남는다) */
export async function openSession(
  store: Store,
  hostHash: string,
): Promise<string> {
  const token = newAdminToken();
  await store.putSession(await sha256(token), hostHash);
  return token;
}

/**
 * 한 모임장(from)의 일정과 모임을 다른 모임장(to)에게 합친다.
 * 계정 없이 쓰던 기기에서 로그인했을 때, 그 기기에서 만든 모임과 적어 둔 일정을 계정으로 옮기는 데 쓴다.
 */
export async function mergeHost(
  store: Store,
  from: string,
  to: string,
): Promise<void> {
  if (!from || from === to) return;
  const [fromHost, toHost, events] = await Promise.all([
    store.getHost(from),
    store.getHost(to),
    store.listHostEvents(from),
  ]);
  const blocks = [
    ...new Set([...(toHost?.blocks ?? []), ...(fromHost?.blocks ?? [])]),
  ].sort();
  if (blocks.length > 0 || toHost)
    await store.putHost(to, { blocks, updatedAt: Date.now() });
  for (const event of events) {
    event.hostHash = to;
    await store.createEvent(event);
    await store.linkHostEvent(to, event.id, true);
  }
  await store.deleteHost(from);
}

import { newAdminToken, sha256 } from "./api";
import type { getStore } from "./store";

type Store = ReturnType<typeof getStore>;

// 모임장 계정: 이름(실명) + 숫자 4자리.
// 숫자 4자리는 경우의 수가 1만 개뿐이라, 틀린 횟수를 세서 잠그는 것이 실제 방어선이다.
//
// 동명이인: 같은 이름으로도 가입할 수 있고, 로그인할 때 숫자 4자리로 구별한다.
//  - 그 이름의 첫 계정은 키가 이름 그대로("김민수"), 다음부터는 "김민수#3fa2"처럼 꼬리표가 붙는다.
//  - 화면에는 꼬리표를 뺀 이름만 보인다.
//  - 사이트 관리자는 키로 확인하므로, 같은 이름으로 새로 가입해도 관리자가 되지 않는다.

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

/** 화면에 보일 이름 (동명이인 꼬리표를 뺀다) */
export function displayName(key: string | null | undefined): string {
  return key ? key.split("#")[0] : "";
}

/** 이 이름으로 가입한 모든 계정 */
export async function accountsByName(store: Store, name: string) {
  const keys = [...new Set([name, ...(await store.listNameAccounts(name))])];
  const found = await Promise.all(keys.map((k) => store.getAccount(k)));
  return found.filter((a): a is NonNullable<typeof a> => a !== null);
}

/** 이름과 숫자 4자리가 맞는 계정 (없으면 null) */
export async function matchAccount(store: Store, name: string, pin: string) {
  for (const account of await accountsByName(store, name)) {
    if ((await hashPin(pin, account.salt)) === account.pinHash) return account;
  }
  return null;
}

/** 새 계정의 키: 그 이름이 비어 있으면 이름 그대로, 아니면 꼬리표를 붙인다 */
export function accountKeyFor(name: string, taken: boolean): string {
  if (!taken) return name;
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return `${name}#${toHex(bytes)}`;
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

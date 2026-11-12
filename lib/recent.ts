// 이 브라우저에서 만들었거나 열어 본 모임 목록 (localStorage). 없어도 동작에는 지장 없음.

export type RecentEvent = { id: string; title: string };

const KEY = "mp:recent";

/** localStorage에 들어 있는 원문. useSyncExternalStore의 스냅샷으로 쓴다(문자열이라 값이 같으면 다시 그리지 않음). */
export function readRecentRaw(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function parseRecent(raw: string): RecentEvent[] {
  try {
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list
          .filter(
            (x) => x && typeof x.id === "string" && typeof x.title === "string",
          )
          .slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export function readRecent(): RecentEvent[] {
  return parseRecent(readRecentRaw());
}

export function rememberEvent(event: RecentEvent) {
  try {
    const next = [
      event,
      ...readRecent().filter((x) => x.id !== event.id),
    ].slice(0, 8);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장 못 해도 무시 */
  }
}

export function readName(eventId: string): string {
  try {
    return (
      window.localStorage.getItem(`mp:name:${eventId}`) ??
      window.localStorage.getItem("mp:name") ??
      // 로그인한 계정이 있으면 그 이름을 먼저 채워 둔다
      window.localStorage.getItem("mp:account") ??
      ""
    );
  } catch {
    return "";
  }
}

export function rememberName(eventId: string, name: string) {
  try {
    window.localStorage.setItem(`mp:name:${eventId}`, name);
    window.localStorage.setItem("mp:name", name);
  } catch {
    /* 무시 */
  }
}

export function readStation(): string {
  try {
    return window.localStorage.getItem("mp:station") ?? "";
  } catch {
    return "";
  }
}

export function rememberStation(station: string) {
  try {
    window.localStorage.setItem("mp:station", station);
  } catch {
    /* 무시 */
  }
}

export function readAdminToken(eventId: string): string {
  try {
    return window.localStorage.getItem(`mp:admin:${eventId}`) ?? "";
  } catch {
    return "";
  }
}

export function rememberAdminToken(eventId: string, token: string) {
  try {
    window.localStorage.setItem(`mp:admin:${eventId}`, token);
  } catch {
    /* 무시 */
  }
}

export function forgetEvent(eventId: string) {
  try {
    window.localStorage.removeItem(`mp:admin:${eventId}`);
    window.localStorage.removeItem(`mp:name:${eventId}`);
    const next = readRecent().filter((x) => x.id !== eventId);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 무시 */
  }
}

export function readEditToken(eventId: string, name: string): string {
  try {
    return window.localStorage.getItem(`mp:edit:${eventId}:${name}`) ?? "";
  } catch {
    return "";
  }
}

export function rememberEditToken(
  eventId: string,
  name: string,
  token: string,
) {
  try {
    window.localStorage.setItem(`mp:edit:${eventId}:${name}`, token);
  } catch {
    /* 무시 */
  }
}

// ---------- 모임장 ----------
// 모임장 토큰: 여러 모임을 만든 "한 사람"임을 증명하는 값. 이 브라우저에만 저장된다.

export function readHostToken(): string {
  try {
    return window.localStorage.getItem("mp:host") ?? "";
  } catch {
    return "";
  }
}

export function rememberHostToken(token: string) {
  try {
    window.localStorage.setItem("mp:host", token);
  } catch {
    /* 무시 */
  }
}

/** 모임장 토큰이 없으면 새로 만든다 */
export function ensureHostToken(): string {
  const existing = readHostToken();
  if (existing) return existing;
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  rememberHostToken(token);
  return readHostToken();
}

/** 주소에 붙어 온 토큰(#이름=값)을 꺼내고 주소에서는 지운다 */
export function takeHashToken(name: "admin" | "host"): string {
  const match = new RegExp(`^#${name}=([0-9a-f]{20,64})$`).exec(
    window.location.hash,
  );
  if (!match) return "";
  window.history.replaceState(null, "", window.location.pathname);
  return match[1];
}

/** 이 기기에서 이미 안내를 본 "고를 수 없는 칸" 목록 */
export function readSeenBlocked(eventId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(`mp:blocked-seen:${eventId}`);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list : null;
  } catch {
    return null;
  }
}

export function rememberSeenBlocked(eventId: string, keys: string[]) {
  try {
    window.localStorage.setItem(
      `mp:blocked-seen:${eventId}`,
      JSON.stringify(keys),
    );
  } catch {
    /* 무시 */
  }
}

export function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setFlag(key: string) {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* 무시 */
  }
}

/** 이 브라우저를 나타내는 값. 한 기기에서 한 모임에 여러 번 응답하는 것을 막는 데 쓴다. */
export function deviceToken(): string {
  try {
    const existing = window.localStorage.getItem("mp:device");
    if (existing) return existing;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    window.localStorage.setItem("mp:device", token);
    return token;
  } catch {
    return "";
  }
}

// ---------- 모임장 계정 ----------

/** 이 기기에서 로그인한 모임장 아이디 (화면에 보여 주는 용도) */
export function readAccountId(): string {
  try {
    return window.localStorage.getItem("mp:account") ?? "";
  } catch {
    return "";
  }
}

/** 로그인·가입에 성공했을 때: 세션 토큰과 아이디를 기억한다 */
export function rememberLogin(token: string, accountId: string) {
  try {
    window.localStorage.setItem("mp:host", token);
    window.localStorage.setItem("mp:account", accountId);
  } catch {
    /* 무시 */
  }
}

/** 로그아웃: 이 기기에서 모임장 정보를 지운다 */
export function forgetLogin() {
  try {
    window.localStorage.removeItem("mp:host");
    window.localStorage.removeItem("mp:account");
  } catch {
    /* 무시 */
  }
}

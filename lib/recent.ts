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

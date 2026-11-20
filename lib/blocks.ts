import { eventSlots, parseSlotKey, slotKey } from "./slots";
import type { BlockReason, MoimEvent } from "./types";

type HostSource = {
  getHost(hostHash: string): Promise<{ blocks: string[] } | null>;
  listHostEvents(hostHash: string): Promise<MoimEvent[]>;
};

/**
 * 이 모임에서 고를 수 없는 칸.
 *  - busy: 모임장이 "안 되는 시간"으로 적어 둔 칸
 *  - fixed: 모임장의 다른 모임이 확정된 날 (그날은 점심·저녁 모두 막는다)
 *  - past: 이미 지난 날 (한국 시간 기준 어제까지)
 */
export async function blockedFor(
  event: MoimEvent,
  store: HostSource,
): Promise<Record<string, BlockReason>> {
  const dates = new Set(event.dates);
  const slots = eventSlots(event);
  const out: Record<string, BlockReason> = {};
  const [host, others] = event.hostHash
    ? await Promise.all([
        store.getHost(event.hostHash),
        store.listHostEvents(event.hostHash),
      ])
    : [null, []];

  for (const key of host?.blocks ?? []) {
    const parsed = parseSlotKey(key);
    if (parsed && dates.has(parsed.date) && slots.includes(parsed.slot))
      out[key] = "busy";
  }
  for (const other of others) {
    const date = other.confirmed?.date;
    if (other.id === event.id || !date || !dates.has(date)) continue;
    for (const slot of slots) out[slotKey(date, slot)] = "fixed";
  }
  // 지난 날은 후보에서 뺀다 (이유 표시는 '지난 날'이 먼저)
  const today = todayInSeoul();
  for (const date of event.dates) {
    if (date >= today) continue;
    for (const slot of slots) out[slotKey(date, slot)] = "past";
  }
  return out;
}

/** 모임장의 모든 모임에 "바뀜"을 알린다 (모임장 일정·다른 모임 확정이 바뀌었을 때) */
export async function bumpHostEvents(
  hostHash: string,
  store: {
    listHostEvents(hostHash: string): Promise<MoimEvent[]>;
    bumpVersion(id: string): Promise<void>;
  },
): Promise<void> {
  const events = await store.listHostEvents(hostHash);
  await Promise.all(events.map((e) => store.bumpVersion(e.id)));
}

/** 한국 시간 기준 오늘 (YYYY-MM-DD) */
export function todayInSeoul(now = Date.now()): string {
  return new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
}

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
 */
export async function blockedFor(
  event: MoimEvent,
  store: HostSource,
): Promise<Record<string, BlockReason>> {
  if (!event.hostHash) return {};
  const [host, others] = await Promise.all([
    store.getHost(event.hostHash),
    store.listHostEvents(event.hostHash),
  ]);
  const dates = new Set(event.dates);
  const slots = eventSlots(event);
  const out: Record<string, BlockReason> = {};

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
  return out;
}

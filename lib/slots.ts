import { formatKorean, formatShort } from "./dates";
import type { MoimEvent, Slot } from "./types";

// 시간대(점심·저녁) 다루기.
// 한 칸은 "날짜:시간대" 문자열로 적는다. 예: "2026-11-23:D" = 11월 23일 저녁

export const SLOT_ORDER: Slot[] = ["L", "D"];
export const SLOT_LABELS: Record<Slot, string> = { L: "점심", D: "저녁" };

export const slotKey = (date: string, slot: Slot) => `${date}:${slot}`;

export function parseSlotKey(key: string): { date: string; slot: Slot } | null {
  const m = /^(\d{4}-\d{2}-\d{2}):([LD])$/.exec(key);
  return m ? { date: m[1], slot: m[2] as Slot } : null;
}

/** 이 모임이 받는 시간대. 시간대 기능 전에 만든 모임은 저녁 하나로 본다. */
export function eventSlots(event: Pick<MoimEvent, "slots">): Slot[] {
  const picked = SLOT_ORDER.filter((s) => event.slots?.includes(s));
  return picked.length > 0 ? picked : ["D"];
}

/** 모임의 모든 칸 (날짜 × 시간대) */
export function allSlotKeys(
  event: Pick<MoimEvent, "dates" | "slots">,
): string[] {
  const slots = eventSlots(event);
  return event.dates.flatMap((date) =>
    slots.map((slot) => slotKey(date, slot)),
  );
}

/**
 * 저장된 "안 되는 칸" 목록을 이 모임의 칸으로 정리한다.
 * 시간대 기능 전에 저장된 값(날짜만 적힌 것)은 그날 전체가 안 되는 것으로 푼다.
 */
export function normalizeUnavailable(
  event: Pick<MoimEvent, "dates" | "slots">,
  list: unknown[],
): string[] {
  const valid = new Set(allSlotKeys(event));
  const slots = eventSlots(event);
  const picked = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    if (valid.has(item)) picked.add(item);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(item)) {
      for (const slot of slots) {
        const key = slotKey(item, slot);
        if (valid.has(key)) picked.add(key);
      }
    }
  }
  return [...valid].filter((key) => picked.has(key));
}

/** 확정 내용. 시간대 기능 전에 확정한 모임은 그 모임의 첫 시간대로 본다. */
export function confirmedOf(
  event: Pick<MoimEvent, "confirmed" | "dates" | "slots">,
): { date: string; slot: Slot; station: string } | null {
  const c = event.confirmed;
  if (!c || !event.dates.includes(c.date)) return null;
  const slots = eventSlots(event);
  const slot = c.slot && slots.includes(c.slot) ? c.slot : slots[0];
  return { date: c.date, slot, station: c.station };
}

/** "11월 23일 (월) 저녁" */
export function formatSlot(date: string, slot: Slot): string {
  return `${formatKorean(date)} ${SLOT_LABELS[slot]}`;
}

/** "11/23(월) 저녁" */
export function formatSlotShort(key: string): string {
  const parsed = parseSlotKey(key);
  return parsed
    ? `${formatShort(parsed.date)} ${SLOT_LABELS[parsed.slot]}`
    : key;
}

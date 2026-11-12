"use client";

import { formatKorean, parseYmd, WEEKDAY_LABELS } from "@/lib/dates";
import { SLOT_LABELS, slotKey } from "@/lib/slots";
import type { Slot } from "@/lib/types";

type Props = {
  date: string;
  slots: Slot[];
  /** 안 된다고 표시한 칸 */
  off: Set<string>;
  /** 고를 수 없는 칸과 그 이유 */
  blocked?: Map<string, string>;
  onToggle: (key: string) => void;
};

/**
 * 달력에서 고른 하루의 점심·저녁을 따로 바꾸는 줄.
 * 달력의 반원은 너무 작아서 직접 누르기 어렵기 때문에, 큰 버튼을 따로 둔다.
 */
export default function DayEditor({
  date,
  slots,
  off,
  blocked,
  onToggle,
}: Props) {
  return (
    <div
      className="day-editor"
      role="group"
      aria-label={`${formatKorean(date)} 점심·저녁`}
    >
      <span className="day-editor-date" aria-hidden="true">
        {parseYmd(date)!.getUTCDate()}일 (
        {WEEKDAY_LABELS[parseYmd(date)!.getUTCDay()]})
      </span>
      {slots.map((slot) => {
        const key = slotKey(date, slot);
        const reason = blocked?.get(key);
        if (reason) {
          return (
            <span
              key={slot}
              className="slot-btn locked"
              role="img"
              aria-label={`${SLOT_LABELS[slot]} ${reason}, 고를 수 없음`}
            >
              <span className="slot-name">{SLOT_LABELS[slot]}</span>
              <span className="slot-state">{reason}</span>
            </span>
          );
        }
        const no = off.has(key);
        return (
          <button
            type="button"
            key={slot}
            className={`slot-btn${no ? " no" : ""}`}
            aria-pressed={no}
            aria-label={`${SLOT_LABELS[slot]} ${no ? "안 됨" : "가능"}`}
            onClick={() => onToggle(key)}
          >
            <span className="slot-name">{SLOT_LABELS[slot]}</span>
            <span className="slot-state">{no ? "안 됨" : "가능"}</span>
          </button>
        );
      })}
    </div>
  );
}

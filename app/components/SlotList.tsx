"use client";

import { parseYmd, WEEKDAY_LABELS } from "@/lib/dates";
import { SLOT_LABELS, slotKey } from "@/lib/slots";
import type { Slot } from "@/lib/types";

type Props = {
  dates: string[];
  slots: Slot[];
  /** 안 된다고 표시한 칸 */
  off: Set<string>;
  /** 고를 수 없는 칸과 그 이유 */
  blocked?: Map<string, string>;
  onToggle: (key: string) => void;
};

/**
 * 날짜마다 한 줄씩, 점심·저녁을 따로 누르는 목록.
 * 달력 칸을 둘로 쪼개면 휴대폰에서 누르기 어려워서 목록으로 보여 준다.
 */
export default function SlotList({
  dates,
  slots,
  off,
  blocked,
  onToggle,
}: Props) {
  return (
    <div className="slot-list">
      {dates.map((date, index) => {
        const d = parseYmd(date)!;
        const month = date.slice(0, 7);
        const showMonth = index === 0 || dates[index - 1].slice(0, 7) !== month;
        const weekday = d.getUTCDay();
        const dayLabel = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${WEEKDAY_LABELS[weekday]}요일`;
        return (
          <div key={date}>
            {showMonth && (
              <h3 className="month-title slot-month">
                {d.getUTCFullYear()}년 {d.getUTCMonth() + 1}월
              </h3>
            )}
            <div className="slot-row">
              <span
                className={`slot-date${weekday === 0 ? " sun" : weekday === 6 ? " sat" : ""}`}
              >
                <span className="slot-day">{d.getUTCDate()}</span>
                <span className="slot-week">{WEEKDAY_LABELS[weekday]}</span>
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
                      aria-label={`${dayLabel} ${SLOT_LABELS[slot]} ${reason}, 고를 수 없음`}
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
                    aria-label={`${dayLabel} ${SLOT_LABELS[slot]} ${no ? "안 됨" : "가능"}`}
                    onClick={() => onToggle(key)}
                  >
                    <span className="slot-name">{SLOT_LABELS[slot]}</span>
                    <span className="slot-state">
                      {no ? "안 돼요" : "가능"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

import { useMemo } from "react";
import {
  buildMonthGrids,
  formatKorean,
  parseYmd,
  WEEKDAY_LABELS,
} from "@/lib/dates";

/** 원(또는 반원) 하나의 상태 */
export type HalfTone =
  | "ok" // 가능 (입력 화면)
  | "no" // 안 됨 (입력 화면)
  | "locked" // 모임장 일정으로 고를 수 없음
  | "perfect" // 모두 가능 (결과 화면)
  | "plain" // 누군가 안 됨, 또는 아직 응답 없음 (결과 화면)
  | "confirmed"; // 확정

export type DayCell = {
  /** 하나면 원 전체, 둘이면 위(점심)·아래(저녁) 반원 */
  halves: HalfTone[];
  /** 숫자 아래 작은 글씨 */
  sub: string;
  subTone?: "blue" | "red" | "ink" | "muted";
  /** 화면 낭독용 설명 */
  label: string;
  disabled?: boolean;
};

type Props = {
  dates: string[];
  cells: Map<string, DayCell>;
  selected?: string | null;
  onSelect: (date: string) => void;
};

/**
 * 후보 날짜만 누를 수 있는 달력.
 * 점심·저녁을 따로 받는 모임은 원을 위아래로 나눠, 위 반쪽은 점심, 아래 반쪽은 저녁을 나타낸다.
 */
export default function Calendar({ dates, cells, selected, onSelect }: Props) {
  const grids = useMemo(() => buildMonthGrids(dates), [dates]);
  const candidates = useMemo(() => new Set(dates), [dates]);

  return (
    <div className="months">
      {grids.map((grid) => (
        <section
          className="month"
          key={grid.key}
          aria-label={`${grid.year}년 ${grid.month}월`}
        >
          <h3 className="month-title">
            {grid.year}년 {grid.month}월
          </h3>
          <div className="week-labels" aria-hidden="true">
            {WEEKDAY_LABELS.map((label, i) => (
              <span
                key={label}
                className={i === 0 ? "sun" : i === 6 ? "sat" : undefined}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="grid">
            {visibleCells(grid.cells, candidates).map(({ date, index }) => {
              if (!date)
                return <span className="cell blank" key={`b${index}`} />;
              const day = parseYmd(date)!.getUTCDate();
              const cell = cells.get(date);

              if (!candidates.has(date) || !cell) {
                return (
                  <span className="cell off" key={date} aria-hidden="true">
                    <span className="num">{day}</span>
                  </span>
                );
              }

              // 점심·저녁 상태가 같으면 원 하나로 그린다. 다를 때만 위아래로 나눈다.
              const halves = cell.halves.every(
                (tone) => tone === cell.halves[0],
              )
                ? [cell.halves[0]]
                : cell.halves;
              const disc = (
                <span
                  className={`disc ${halves.length === 2 ? "split" : "single"}`}
                  aria-hidden="true"
                >
                  {halves.map((tone, i) => (
                    <span className={`half ${tone}`} key={i}>
                      <span className="num">{day}</span>
                    </span>
                  ))}
                </span>
              );
              const sub = (
                <span className={`sub ${cell.subTone ?? "muted"}`}>
                  {cell.sub}
                </span>
              );
              const label = `${formatKorean(date)} ${cell.label}`;

              if (cell.disabled) {
                return (
                  <span
                    className="cell day"
                    key={date}
                    role="img"
                    aria-label={label}
                  >
                    {disc}
                    {sub}
                  </span>
                );
              }
              return (
                <button
                  type="button"
                  key={date}
                  className={`cell day${selected === date ? " selected" : ""}`}
                  aria-pressed={
                    selected === undefined ? undefined : selected === date
                  }
                  aria-label={label}
                  onClick={() => onSelect(date)}
                >
                  {disc}
                  {sub}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** 후보 날짜가 하나도 없는 주는 빼고 보여 준다 (휴대폰에서 스크롤을 줄이려고). */
function visibleCells(cells: (string | null)[], candidates: Set<string>) {
  const out: { date: string | null; index: number }[] = [];
  for (let start = 0; start < cells.length; start += 7) {
    const week = cells.slice(start, start + 7);
    if (!week.some((d) => d && candidates.has(d))) continue;
    week.forEach((date, i) => out.push({ date, index: start + i }));
  }
  return out;
}

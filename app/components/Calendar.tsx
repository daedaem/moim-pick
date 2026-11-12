"use client";

import { useMemo } from "react";
import {
  buildMonthGrids,
  formatKorean,
  parseYmd,
  WEEKDAY_LABELS,
} from "@/lib/dates";

type CheckProps = {
  mode: "check";
  dates: string[];
  /** 안 된다고 표시한 날 */
  off: Set<string>;
  /** 고를 수 없는 날과 그 이유 */
  blocked: Map<string, string>;
  onToggle: (date: string) => void;
};

export type ResultCell = {
  tone: "perfect" | "plain" | "blocked" | "confirmed";
  /** 숫자 아래 작은 글씨 */
  sub: string;
};

type ResultProps = {
  mode: "result";
  dates: string[];
  cells: Map<string, ResultCell>;
  selected: string | null;
  onSelect: (date: string) => void;
};

export default function Calendar(props: CheckProps | ResultProps) {
  const { dates } = props;
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

              if (!candidates.has(date)) {
                return (
                  <span className="cell off" key={date} aria-hidden="true">
                    <span className="num">{day}</span>
                  </span>
                );
              }

              if (props.mode === "check") {
                const reason = props.blocked.get(date);
                if (reason) {
                  return (
                    <span
                      className="cell locked"
                      key={date}
                      role="img"
                      aria-label={`${formatKorean(date)} ${reason}, 고를 수 없음`}
                    >
                      <span className="num">{day}</span>
                      <span className="sub">{reason}</span>
                    </span>
                  );
                }
                const no = props.off.has(date);
                return (
                  <button
                    type="button"
                    key={date}
                    className={`cell pick${no ? " no" : ""}`}
                    aria-pressed={no}
                    aria-label={`${formatKorean(date)} ${no ? "안 되는 날" : "되는 날"}`}
                    onClick={() => props.onToggle(date)}
                  >
                    <span className="num">{day}</span>
                    <span className="sub">{no ? "안 돼요" : "가능"}</span>
                  </button>
                );
              }

              const cell = props.cells.get(date) ?? {
                tone: "plain" as const,
                sub: "",
              };
              const selected = props.selected === date;
              return (
                <button
                  type="button"
                  key={date}
                  className={`cell show ${cell.tone}${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  aria-label={`${formatKorean(date)} ${cell.sub}`}
                  onClick={() => props.onSelect(date)}
                >
                  <span className="num">{day}</span>
                  <span className="sub">{cell.sub}</span>
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

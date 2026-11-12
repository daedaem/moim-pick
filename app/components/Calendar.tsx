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
  unavailable: Set<string>;
  onToggle: (date: string) => void;
};

type ResultProps = {
  mode: "result";
  dates: string[];
  /** 날짜별 안 되는 사람 수 */
  missing: Map<string, number>;
  total: number;
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
                const no = props.unavailable.has(date);
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
                    <span className="sub">{no ? "안 돼요" : ""}</span>
                  </button>
                );
              }

              const miss = props.missing.get(date) ?? 0;
              const perfect = props.total > 0 && miss === 0;
              const selected = props.selected === date;
              return (
                <button
                  type="button"
                  key={date}
                  className={`cell show${perfect ? " perfect" : ""}${selected ? " selected" : ""}`}
                  aria-pressed={selected}
                  aria-label={
                    props.total === 0
                      ? formatKorean(date)
                      : perfect
                        ? `${formatKorean(date)} 모두 가능`
                        : `${formatKorean(date)} ${miss}명 불가`
                  }
                  onClick={() => props.onSelect(date)}
                >
                  <span className="num">{day}</span>
                  <span className="sub">
                    {props.total === 0
                      ? ""
                      : perfect
                        ? "모두 가능"
                        : `${miss}명 불가`}
                  </span>
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

"use client";

import { useMemo } from "react";
import { buildMonthGrids, formatKorean, parseYmd, WEEKDAY_LABELS } from "@/lib/dates";
import { MarkerCircle, Slash } from "./Marks";

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
};

export default function Calendar(props: CheckProps | ResultProps) {
  const { dates } = props;
  const grids = useMemo(() => buildMonthGrids(dates), [dates]);
  const candidates = useMemo(() => new Set(dates), [dates]);

  return (
    <div className="months">
      {grids.map((grid) => (
        <section className="sheet" key={grid.key} aria-label={`${grid.year}년 ${grid.month}월`}>
          <header className="sheet-head">
            <span className="sheet-month">{grid.month}월</span>
            <span className="sheet-year">{grid.year}</span>
          </header>
          <div className="week-labels" aria-hidden="true">
            {WEEKDAY_LABELS.map((label, i) => (
              <span key={label} className={i === 0 ? "sun" : i === 6 ? "sat" : undefined}>
                {label}
              </span>
            ))}
          </div>
          <div className="grid">
            {visibleCells(grid.cells, candidates).map(({ date, index }) => {
              if (!date) return <span className="cell blank" key={`b${index}`} />;
              const day = parseYmd(date)!.getUTCDate();
              const weekday = index % 7;
              const tone = weekday === 0 ? " sun" : weekday === 6 ? " sat" : "";

              if (!candidates.has(date)) {
                return (
                  <span className={`cell off${tone}`} key={date} aria-hidden="true">
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
                    className={`cell pick${tone}${no ? " no" : ""}`}
                    aria-pressed={no}
                    aria-label={`${formatKorean(date)} ${no ? "안 되는 날" : "되는 날"}`}
                    onClick={() => props.onToggle(date)}
                  >
                    <span className="num">{day}</span>
                    {no && <Slash className="slash" />}
                  </button>
                );
              }

              const miss = props.missing.get(date) ?? 0;
              const perfect = props.total > 0 && miss === 0;
              return (
                <span
                  key={date}
                  className={`cell show${tone}${perfect ? " perfect" : ""}`}
                  aria-label={
                    props.total === 0
                      ? formatKorean(date)
                      : perfect
                        ? `${formatKorean(date)} 모두 가능`
                        : `${formatKorean(date)} ${miss}명 불가`
                  }
                >
                  <span className="num">{day}</span>
                  {perfect && <MarkerCircle className="circle" />}
                  {props.total > 0 && !perfect && <span className="miss">{miss}명 불가</span>}
                </span>
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

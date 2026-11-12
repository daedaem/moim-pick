"use client";

import { useMemo, useState } from "react";
import { searchStations, stationInfo, stationLabel } from "@/lib/stations";

type Props = {
  value: string;
  onChange: (name: string) => void;
};

/** 지하철역 검색 입력. 고른 역은 알약 모양으로 보여 주고, 지우면 다시 검색할 수 있다. */
export default function StationPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchStations(query), [query]);
  const selected = value ? stationInfo(value) : null;

  if (selected) {
    return (
      <div className="station-picked">
        <span className="station-name">{stationLabel(selected.name)}</span>
        <LineDots lines={selected.lines} />
        <button
          type="button"
          className="station-clear"
          onClick={() => onChange("")}
        >
          바꾸기
        </button>
      </div>
    );
  }

  return (
    <div className="station-search">
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="역 이름 검색 (예: 범계, 강남)"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label="출발하기 편한 지하철역 검색"
      />
      {query.trim() !== "" && (
        <ul className="station-results">
          {results.length === 0 ? (
            <li className="station-none">
              찾는 역이 없어요. 수도권 전철역만 검색돼요.
            </li>
          ) : (
            results.map((station) => (
              <li key={station.name}>
                <button
                  type="button"
                  className="station-option"
                  onClick={() => {
                    onChange(station.name);
                    setQuery("");
                  }}
                >
                  <span className="station-name">
                    {stationLabel(station.name)}
                  </span>
                  <LineDots lines={station.lines} withNames />
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function LineDots({
  lines,
  withNames = false,
}: {
  lines: { ko: string; colour: string }[];
  withNames?: boolean;
}) {
  return (
    <span className="line-dots">
      {lines.map((line) => (
        <span className="line-dot" key={line.ko}>
          <i style={{ background: line.colour }} aria-hidden="true" />
          {withNames ? line.ko : <span className="sr-only">{line.ko}</span>}
        </span>
      ))}
    </span>
  );
}

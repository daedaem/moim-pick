"use client";

import StationPicker from "@/app/components/StationPicker";
import { stationLabel } from "@/lib/stations";

type Props = {
  values: string[];
  onChange: (next: string[]) => void;
  max?: number;
};

/** 장소(역)를 여러 곳 고른다. 고른 역은 칩으로 보이고 ✕로 뺀다. */
export default function StationsPicker({ values, onChange, max = 3 }: Props) {
  return (
    <div className="stations-picker">
      {values.length > 0 && (
        <ul className="picked-list">
          {values.map((name, i) => (
            <li key={name} className="picked-chip">
              <span className="picked-order">{i + 1}</span>
              {stationLabel(name)}
              <button
                type="button"
                className="picked-remove"
                aria-label={`${stationLabel(name)} 빼기`}
                onClick={() => onChange(values.filter((v) => v !== name))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {values.length < max ? (
        <StationPicker
          value=""
          onChange={(name) => {
            if (name && !values.includes(name)) onChange([...values, name]);
          }}
        />
      ) : (
        <p className="hint">
          {max}곳까지 고를 수 있어요. 바꾸려면 ✕로 빼 주세요.
        </p>
      )}
    </div>
  );
}

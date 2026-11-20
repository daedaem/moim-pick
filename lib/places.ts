/** 고를 수 있는 음식 종류 (맛집 찾기 메뉴와 같다) */
export const FOODS = [
  "한식",
  "고기",
  "회·일식",
  "중식",
  "양식",
  "술집",
  "카페",
] as const;

import type { MoimResponse } from "./types";

/** 응답의 장소 목록 (예전 응답은 station 하나) */
export function stationsOf(
  r: Pick<MoimResponse, "station" | "stations">,
): string[] {
  if (Array.isArray(r.stations) && r.stations.length > 0) return r.stations;
  return r.station ? [r.station] : [];
}

/** 많이 고른 장소 순: [역, 고른 사람 수] */
export function popularStations(
  responses: Pick<MoimResponse, "station" | "stations">[],
): [string, number][] {
  const count = new Map<string, number>();
  for (const r of responses)
    for (const s of new Set(stationsOf(r)))
      count.set(s, (count.get(s) ?? 0) + 1);
  return [...count.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"),
  );
}

/** 많이 고른 음식 순: [음식, 고른 사람 수] */
export function popularFoods(
  responses: { foods?: string[] }[],
): [string, number][] {
  const count = new Map<string, number>();
  for (const r of responses)
    for (const f of new Set(r.foods ?? []))
      count.set(f, (count.get(f) ?? 0) + 1);
  return [...count.entries()].sort(
    (a, b) =>
      b[1] - a[1] ||
      FOODS.indexOf(a[0] as (typeof FOODS)[number]) -
        FOODS.indexOf(b[0] as (typeof FOODS)[number]),
  );
}

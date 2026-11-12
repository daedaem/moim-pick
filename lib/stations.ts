import data from "./stations.json";

// 수도권 전철역 목록과 역 사이 연결. 출처: OpenStreetMap (ODbL 1.0)
// stations: [이름, 위도, 경도, 노선 번호들], edges: 이웃한 두 역의 번호 쌍

type RawStation = [string, number, number, number[]];

const stations = data.stations as RawStation[];
const lines = data.lines as { ko: string; colour: string }[];
const edges = data.edges as [number, number][];

const indexByName = new Map(stations.map((s, i) => [s[0], i]));

export type StationInfo = {
  name: string;
  lines: { ko: string; colour: string }[];
};

export function isStation(name: string): boolean {
  return indexByName.has(name);
}

/** '강남' -> '강남역', '서울' -> '서울역' */
export function stationLabel(name: string): string {
  return name.endsWith("역") ? name : `${name}역`;
}

export function stationInfo(name: string): StationInfo | null {
  const i = indexByName.get(name);
  if (i === undefined) return null;
  return { name, lines: stations[i][3].map((l) => lines[l]) };
}

/** 역 이름 검색. 앞 글자가 맞는 역을 먼저 보여 준다. */
export function searchStations(query: string, limit = 8): StationInfo[] {
  const q = query.replace(/\s+/g, "").replace(/역$/, "");
  if (!q) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const [name] of stations) {
    const compact = name.replace(/\s+/g, "");
    if (compact.startsWith(q)) starts.push(name);
    else if (compact.includes(q)) contains.push(name);
  }
  return [...starts, ...contains]
    .slice(0, limit)
    .map((name) => stationInfo(name)!);
}

let adjacency: number[][] | null = null;

function neighbours(): number[][] {
  if (adjacency) return adjacency;
  adjacency = stations.map(() => []);
  for (const [a, b] of edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}

/** 한 역에서 모든 역까지의 정거장 수 */
function stopsFrom(start: number): Int16Array {
  const adj = neighbours();
  const dist = new Int16Array(stations.length).fill(-1);
  dist[start] = 0;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const next of adj[current]) {
      if (dist[next] === -1) {
        dist[next] = dist[current] + 1;
        queue.push(next);
      }
    }
  }
  return dist;
}

export type MeetingPoint = {
  name: string;
  /** 가장 멀리서 오는 사람의 정거장 수 */
  maxStops: number;
  /** 평균 정거장 수 */
  avgStops: number;
};

/**
 * 여러 사람의 출발역에서 모이기 좋은 역을 고른다.
 * 기준: 가장 멀리서 오는 사람의 정거장 수가 가장 적은 역. 1정거장 차이까지는 환승역을 우선하고, 그다음 전체 합이 적은 역.
 * 정거장 수만 세므로 환승 시간·급행은 반영하지 않는다(대략적인 추천).
 */
export function recommendMeetingPoints(
  origins: string[],
  limit = 3,
): MeetingPoint[] {
  const starts = origins
    .map((name) => indexByName.get(name))
    .filter((i): i is number => i !== undefined);
  if (starts.length === 0) return [];

  const distCache = new Map<number, Int16Array>();
  for (const s of new Set(starts)) distCache.set(s, stopsFrom(s));

  const scored: { index: number; max: number; sum: number }[] = [];
  for (let i = 0; i < stations.length; i++) {
    let max = 0;
    let sum = 0;
    let reachable = true;
    for (const s of starts) {
      const d = distCache.get(s)![i];
      if (d < 0) {
        reachable = false;
        break;
      }
      if (d > max) max = d;
      sum += d;
    }
    if (reachable) scored.push({ index: i, max, sum });
  }

  // 정거장 수가 비슷하면(1정거장 차이까지) 환승역을 먼저 추천한다. 실제로 모이기 편한 곳은 대개 환승역이라서.
  const bestMax = Math.min(...scored.map((row) => row.max));
  const isHub = (index: number) => stations[index][3].length >= 2;
  const tier = (row: { index: number; max: number }) =>
    // 모두 같은 역에서 출발하면(bestMax 0) 그 역이 답이므로 환승역 우선을 적용하지 않는다
    bestMax > 0 && row.max <= bestMax + 1 && isHub(row.index) ? 0 : 1;
  scored.sort(
    (x, y) =>
      tier(x) - tier(y) ||
      x.max - y.max ||
      x.sum - y.sum ||
      stations[y.index][3].length - stations[x.index][3].length ||
      stations[x.index][0].localeCompare(stations[y.index][0], "ko"),
  );

  return scored.slice(0, limit).map((row) => ({
    name: stations[row.index][0],
    maxStops: row.max,
    avgStops: Math.round((row.sum / starts.length) * 10) / 10,
  }));
}

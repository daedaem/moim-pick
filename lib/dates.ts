// 날짜는 전부 'YYYY-MM-DD' 문자열로 다루고, 계산은 UTC 기준으로만 한다.
// (브라우저/서버 타임존이 달라도 하루씩 밀리지 않게 하기 위함)

export const WEEKDAY_LABELS = [
  "일",
  "월",
  "화",
  "수",
  "목",
  "금",
  "토",
] as const;

export function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

export function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const date = parseYmd(ymd);
  if (!date) return ymd;
  date.setUTCDate(date.getUTCDate() + days);
  return toYmd(date);
}

export function weekdayOf(ymd: string): number {
  const date = parseYmd(ymd);
  return date ? date.getUTCDay() : 0;
}

/** start~end(포함) 사이에서 선택한 요일만 골라 후보 날짜 목록을 만든다. */
export function buildCandidates(
  start: string,
  end: string,
  weekdays: number[],
): string[] {
  const s = parseYmd(start);
  const e = parseYmd(end);
  if (!s || !e || s > e) return [];
  const allowed = new Set(weekdays);
  const out: string[] = [];
  const cursor = new Date(s);
  while (cursor <= e && out.length < 400) {
    if (allowed.has(cursor.getUTCDay())) out.push(toYmd(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** 사용자의 현지 기준 오늘 날짜 (클라이언트에서만 호출) */
export function localToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** '11월 24일 (화)' */
export function formatKorean(ymd: string): string {
  const date = parseYmd(ymd);
  if (!date) return ymd;
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 (${WEEKDAY_LABELS[date.getUTCDay()]})`;
}

/** '11/24(화)' */
export function formatShort(ymd: string): string {
  const date = parseYmd(ymd);
  if (!date) return ymd;
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}(${WEEKDAY_LABELS[date.getUTCDay()]})`;
}

export type MonthGrid = {
  key: string; // 'YYYY-MM'
  year: number;
  month: number; // 1~12
  /** 앞쪽 빈 칸 포함, 7의 배수 길이. 빈 칸은 null */
  cells: (string | null)[];
};

/** 후보 날짜가 걸쳐 있는 달마다 달력 격자를 만든다. */
export function buildMonthGrids(candidates: string[]): MonthGrid[] {
  if (candidates.length === 0) return [];
  const first = parseYmd(candidates[0]);
  const last = parseYmd(candidates[candidates.length - 1]);
  if (!first || !last) return [];
  const grids: MonthGrid[] = [];
  let y = first.getUTCFullYear();
  let m = first.getUTCMonth();
  const endY = last.getUTCFullYear();
  const endM = last.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    const lead = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(toYmd(new Date(Date.UTC(y, m, d))));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    grids.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      year: y,
      month: m + 1,
      cells,
    });
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return grids;
}

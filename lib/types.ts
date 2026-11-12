/** 시간대: L = 점심, D = 저녁 */
export type Slot = "L" | "D";

export type MoimEvent = {
  id: string;
  title: string;
  memo: string;
  /** 후보 날짜 (YYYY-MM-DD, 오름차순) */
  dates: string[];
  /** 받는 시간대. 값이 없는 예전 모임은 저녁 하나로 본다 */
  slots?: Slot[];
  createdAt: number;
  /** 첫 화면에서 이름으로 검색되게 할지 (값이 없으면 허용) */
  searchable?: boolean;
  /** 주최자가 확정한 날짜와 장소 */
  confirmed?: { date: string; slot?: Slot; station: string } | null;
  /** 관리용 토큰의 SHA-256 해시. 서버에만 두고 응답으로 내보내지 않는다 */
  adminHash?: string;
  /** 모임장(여러 모임을 만든 한 사람)의 토큰 해시. 서버에만 둔다 */
  hostHash?: string;
};

export type MoimResponse = {
  name: string;
  /** 주최자와의 관계 (RELATIONS 중 하나. 예전 응답은 빈 문자열) */
  relation: string;
  /** 출발하기 편한 지하철역 이름 (없으면 빈 문자열) */
  station: string;
  /** 안 되는 칸 ("날짜:시간대", 예: "2026-11-23:D") */
  unavailable: string[];
  updatedAt: number;
};

/** 고를 수 없는 칸의 이유: busy = 모임장 일정, fixed = 모임장의 다른 모임이 그날로 확정됨 */
export type BlockReason = "busy" | "fixed";

export type EventPayload = {
  event: MoimEvent;
  responses: MoimResponse[];
  /** 고를 수 없는 칸 */
  blocked: Record<string, BlockReason>;
  /** 이 요청을 보낸 기기가 이 모임을 관리할 수 있는지 */
  canManage: boolean;
  /** 이 모임이 모임장 계정에 묶여 있는지 */
  hosted: boolean;
};

/** 모임장이 모임과 상관없이 안 되는 칸 등 */
export type HostRecord = { blocks: string[]; updatedAt: number };

export const LIMITS = {
  titleMax: 40,
  memoMax: 80,
  nameMax: 12,
  rangeDaysMax: 92,
  participantsMax: 60,
} as const;

export const RELATIONS = [
  "친구",
  "직장동료",
  "학교 선후배",
  "가족·친척",
  "기타",
] as const;

/** 검색 결과 한 줄 (참여자 정보는 담지 않는다) */
export type EventSummary = {
  id: string;
  title: string;
  memo: string;
  start: string;
  end: string;
};

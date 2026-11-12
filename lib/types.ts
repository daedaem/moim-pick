export type MoimEvent = {
  id: string;
  title: string;
  memo: string;
  /** 후보 날짜 (YYYY-MM-DD, 오름차순) */
  dates: string[];
  createdAt: number;
  /** 관리용 토큰의 SHA-256 해시. 서버에만 두고 응답으로 내보내지 않는다 */
  adminHash?: string;
};

export type MoimResponse = {
  name: string;
  /** 주최자와의 관계 (RELATIONS 중 하나. 예전 응답은 빈 문자열) */
  relation: string;
  /** 출발하기 편한 지하철역 이름 (없으면 빈 문자열) */
  station: string;
  /** 안 되는 날짜 */
  unavailable: string[];
  updatedAt: number;
};

export type EventPayload = {
  event: MoimEvent;
  responses: MoimResponse[];
};

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

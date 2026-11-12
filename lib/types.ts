export type MoimEvent = {
  id: string;
  title: string;
  memo: string;
  /** 후보 날짜 (YYYY-MM-DD, 오름차순) */
  dates: string[];
  createdAt: number;
};

export type MoimResponse = {
  name: string;
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

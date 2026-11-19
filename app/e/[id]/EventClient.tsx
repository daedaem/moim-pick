"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Calendar, {
  type DayCell,
  type HalfTone,
} from "@/app/components/Calendar";
import DayEditor from "@/app/components/DayEditor";
import NearbyFood from "@/app/components/NearbyFood";
import StationPicker from "@/app/components/StationPicker";
import { formatKorean, formatShort } from "@/lib/dates";
import {
  deviceToken,
  forgetEvent,
  readAdminToken,
  readEditToken,
  readFlag,
  readHostToken,
  readName,
  readSeenBlocked,
  readStation,
  rememberAdminToken,
  rememberEditToken,
  rememberEvent,
  rememberName,
  rememberSeenBlocked,
  rememberStation,
  setFlag,
  takeHashToken,
} from "@/lib/recent";
import {
  allSlotKeys,
  confirmedOf,
  eventSlots,
  formatSlot,
  parseSlotKey,
  SLOT_LABELS,
  SLOT_ORDER,
  slotKey,
} from "@/lib/slots";
import {
  recommendMeetingPoints,
  stationLabel,
  type MeetingPoint,
} from "@/lib/stations";
import {
  LIMITS,
  RELATIONS,
  type BlockReason,
  type EventPayload,
  type Slot,
} from "@/lib/types";

type View = "loading" | "name" | "relation" | "station" | "dates" | "result";

/** 진행 막대에 보이는 단계: ① 나(이름·관계·출발역) ② 안 되는 날 */
const STEPS: View[] = ["name", "dates"];
/** 입력 중인 화면 전체 (관계·출발역은 날짜 화면에서 바로 고치는 보조 화면) */
const INPUT_VIEWS: View[] = ["name", "relation", "station", "dates"];

const BLOCK_TEXT: Record<BlockReason, string> = {
  busy: "모임장 불가",
  fixed: "다른 모임",
};

/** 달력 칸 아래 글씨는 세 글자 안쪽으로 짧게 쓴다 (칸이 좁아서 길면 옆 칸과 붙는다) */
const BLOCK_SHORT = "불가";

type DraftInput = {
  name: string;
  hidden?: boolean;
  relation: string;
  station: string;
  unavailable: string[];
};
const draftKey = (eventId: string) => `mp:draft:${eventId}`;

/** 입력하던 내용 (이 탭에서만, 탭을 닫으면 사라진다) */
function readDraft(eventId: string): DraftInput | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(eventId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<DraftInput>;
    return {
      name: typeof value.name === "string" ? value.name : "",
      hidden: value.hidden === true,
      relation: typeof value.relation === "string" ? value.relation : "",
      station: typeof value.station === "string" ? value.station : "",
      unavailable: Array.isArray(value.unavailable)
        ? value.unavailable.filter((k): k is string => typeof k === "string")
        : [],
    };
  } catch {
    return null;
  }
}

function writeDraft(eventId: string, draft: DraftInput) {
  try {
    window.sessionStorage.setItem(draftKey(eventId), JSON.stringify(draft));
  } catch {
    /* 무시 */
  }
}

function clearDraft(eventId: string) {
  try {
    window.sessionStorage.removeItem(draftKey(eventId));
  } catch {
    /* 무시 */
  }
}

const subscribeNever = () => () => {};

/** 다른 참여자에게 보일 가린 이름 (서버와 같은 규칙): "김민수" → "김*수" */
function maskLabel(name: string): string {
  const chars = [...name];
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars[chars.length - 1]}`;
}

/** 이 화면에서 히스토리에 쌓은 칸 수 (다른 화면에서 막 들어왔으면 0) */
const histDepth = () =>
  (window.history.state as { mpDepth?: number } | null)?.mpDepth ?? 0;

const cleanName = (value: string) => value.replace(/\s+/g, " ").trim();

type Draft = { date: string; slot: Slot; station: string; searching: boolean };

export default function EventClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<EventPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>("loading");
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [hidden, setHidden] = useState(false); // 이름을 모임장에게만 공개
  const [station, setStation] = useState("");
  /** 안 된다고 표시한 칸 ("날짜:시간대") */
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null); // 바꾸는 중인 모임 이름
  const [justSaved, setJustSaved] = useState(false); // 방금 내 응답을 저장함 → 초대 카드
  const [invited, setInvited] = useState(false); // 초대 카드에서 보내기·복사를 눌렀음
  // 방금 만든 모임(?new=1)이면 초대 카드를 먼저 보여 준다
  const justCreated = useSyncExternalStore(
    subscribeNever,
    () => window.location.search.includes("new=1"),
    () => false,
  );
  const [editExpected, setEditExpected] = useState(""); // 바꾸는 중인 예상 인원
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [confirming, setConfirming] = useState(""); // "event" 또는 지우려는 사람 이름
  const [draft, setDraft] = useState<Draft | null>(null); // 확정하려고 고르는 중인 날짜·시간대·역
  const [seenBlocked, setSeenBlocked] = useState<string[] | null>(null);
  /** 같은 이름이 이미 있을 때 대신 쓸 이름 제안 (예: 김민수2) */
  const [nameIdea, setNameIdea] = useState("");
  /** 입력 달력에서 방금 누른 날 (점심·저녁을 따로 고칠 수 있게 아래에 띄운다) */
  const [editDate, setEditDate] = useState<string | null>(null);
  const restored = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  // ---------- 화면 전환과 뒤로 가기 ----------
  // 단계마다 브라우저 히스토리에 한 칸씩 쌓아서, 폰의 뒤로 가기(버튼·쓸어넘기기)가
  // 사이트 밖으로 나가지 않고 바로 앞 단계로 돌아가게 한다.
  const viewRef = useRef<View>("loading");
  const pending = useRef<View | null>(null); // 쌓은 칸을 걷어낸 뒤 보여 줄 화면

  const show = useCallback((next: View) => {
    viewRef.current = next;
    setView(next);
    setFormError("");
    setConfirming("");
    window.scrollTo({ top: 0 });
  }, []);

  /** 다음 화면으로 (뒤로 가면 지금 화면으로 돌아온다) */
  const go = useCallback(
    (next: View) => {
      window.history.pushState(
        { mpView: next, mpPrev: viewRef.current, mpDepth: histDepth() + 1 },
        "",
      );
      show(next);
    },
    [show],
  );

  /** 쌓은 칸을 모두 걷어내고 이 화면을 바닥으로 삼는다 (저장한 뒤의 결과 화면) */
  const settle = useCallback(
    (next: View) => {
      const stacked = histDepth();
      if (stacked > 0) {
        pending.current = next;
        window.history.go(-stacked);
        return;
      }
      window.history.replaceState({ mpView: next, mpDepth: 0 }, "");
      show(next);
    },
    [show],
  );

  /** 바로 앞 화면이 target이면 히스토리를 한 칸 되돌리고, 아니면 새로 연다 */
  const goBackTo = useCallback(
    (target: View) => {
      const state = window.history.state as { mpPrev?: View } | null;
      if (histDepth() > 0 && state?.mpPrev === target) window.history.back();
      else go(target);
    },
    [go],
  );

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = event.state as { mpView?: View } | null;
      if (pending.current) {
        const next = pending.current;
        pending.current = null;
        window.history.replaceState({ mpView: next, mpDepth: 0 }, "");
        show(next);
        return;
      }
      if (state?.mpView) show(state.mpView);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [show]);

  const apply = useCallback(
    (result: FetchResult) => {
      if (result.ok) {
        setLoadError("");
        setData(result.payload);
        return;
      }
      if (result.gone) {
        // 지워진 모임: 전에 열어 둔 화면이 남아 있어도 내용을 비우고, 최근 목록에서도 뺀다
        setData(null);
        forgetEvent(id);
      }
      // 이미 화면이 떠 있는데 잠깐 연결이 끊긴 경우에는 기존 내용을 그대로 둔다
      setLoadError((prev) =>
        result.network ? prev || result.error : result.error,
      );
    },
    [id],
  );

  const load = useCallback(async () => {
    apply(await fetchEvent(id));
  }, [id, apply]);

  // 처음 열 때: 모임을 불러오고, 전에 쓰던 이름과 응답이 있으면 되살린다
  useEffect(() => {
    let cancelled = false;
    // 관리 링크(#admin=토큰)로 들어왔으면 이 기기에 기억해 둔다 (불러오기 전에 해야 권한이 바로 반영됨)
    const fromHash = takeHashToken("admin");
    if (fromHash) rememberAdminToken(id, fromHash);

    fetchEvent(id).then(async (first) => {
      let result = first;
      // 이 기기에서 만든 모임을 지금 이 기기의 모임장에게 묶는다.
      // 모임장 링크로 다른 모임장이 된 뒤에도 다시 묶이도록, 모임장별로 한 번씩 한다.
      const hostToken = readHostToken();
      const claimFlag = `mp:claimed:${id}:${hostToken.slice(0, 8)}`;
      if (
        result.ok &&
        readAdminToken(id) &&
        hostToken &&
        !readFlag(claimFlag)
      ) {
        await fetch(`/api/events/${id}`, {
          method: "PATCH",
          headers: tokenHeaders(id),
          body: JSON.stringify({ claim: true }),
        }).catch(() => null);
        setFlag(claimFlag);
        result = await fetchEvent(id);
      }
      if (cancelled) return;
      apply(result);
      if (!result.ok || restored.current) return;
      restored.current = true;
      const { event, responses } = result.payload;
      rememberEvent({ id: event.id, title: event.title });
      setAdminToken(readAdminToken(event.id));
      setIsHost(Boolean(readHostToken()));

      const saved = readName(event.id);
      const mine =
        saved && readEditToken(event.id, saved)
          ? responses.find((r) => r.name === saved)
          : undefined;
      if (saved) setName(saved);
      if (mine) setSeenBlocked(readSeenBlocked(event.id) ?? []);

      // 입력하던 중에 새로고침했다면: 적던 내용과 단계를 그대로 되살린다
      const draft = readDraft(event.id);
      const resumed = (window.history.state as { mpView?: View } | null)
        ?.mpView;
      if (draft && resumed && INPUT_VIEWS.includes(resumed)) {
        setName(draft.name);
        setRelation(draft.relation);
        setHidden(draft.hidden === true);
        setStation(draft.station);
        setUnavailable(new Set(draft.unavailable));
        show(resumed);
        return;
      }

      if (mine) {
        setRelation(mine.relation);
        setHidden(mine.hidden === true);
        setStation(mine.station);
        setUnavailable(new Set(mine.unavailable));
        settle("result");
      } else {
        // 다른 모임에서 골랐던 출발역은 다시 묻지 않는다
        setStation(readStation());
        // 이미 확정된 모임, 그리고 모임장 본인은 결과부터 보여 준다
        // (모임장에게 "모임장과 어떤 사이인가요?"부터 묻지 않는다)
        settle(event.confirmed || result.payload.canManage ? "result" : "name");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, apply, settle, show]);

  // 입력하는 동안 적은 내용을 이 탭에 적어 둔다 (새로고침해도 사라지지 않게)
  useEffect(() => {
    if (!restored.current || !INPUT_VIEWS.includes(view)) return;
    writeDraft(id, {
      name,
      hidden,
      relation,
      station,
      unavailable: [...unavailable],
    });
  }, [id, view, name, hidden, relation, station, unavailable]);

  // 다른 사람이 응답하면 반영되도록, 화면을 보고 있는 동안 주기적으로 확인한다.
  // 서버 부담을 줄이려고 평소에는 "바뀌었는지"만 묻고(번호 비교), 바뀐 경우에만 전체를 다시 불러온다.
  // 15분 동안 아무 조작이 없으면 확인을 멈췄다가, 다시 만지면 바로 새로 불러온다.
  const version = data?.version;
  const versionRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    versionRef.current = version;
  }, [version]);
  useEffect(() => {
    const IDLE_MS = 15 * 60_000;
    let lastActive = Date.now();
    let idle = false;
    const visible = () => document.visibilityState === "visible";
    const check = async () => {
      if (!visible() || idle) return;
      if (Date.now() - lastActive > IDLE_MS) {
        idle = true;
        return;
      }
      try {
        const res = await fetch(`/api/events/${id}/version`, {
          cache: "no-store",
        });
        const body = (await res.json().catch(() => ({}))) as {
          version?: number;
        };
        if (!res.ok || body.version !== versionRef.current) void load();
      } catch {
        /* 연결이 잠깐 끊긴 경우: 다음 확인 때 다시 */
      }
    };
    const wake = () => {
      lastActive = Date.now();
      if (idle && visible()) {
        idle = false;
        void load();
      }
    };
    const onVisible = () => {
      if (!visible()) return;
      lastActive = Date.now();
      idle = false;
      void load();
    };
    const timer = setInterval(check, 20_000);
    document.addEventListener("visibilitychange", onVisible);
    for (const type of ["pointerdown", "keydown", "scroll"] as const)
      window.addEventListener(type, wake, { passive: true });
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      for (const type of ["pointerdown", "keydown", "scroll"] as const)
        window.removeEventListener(type, wake);
    };
  }, [id, load]);

  const event = data?.event ?? null;
  /** "조해성님" 또는 이름을 모르면 "모임장" */
  const hostLabel = data?.hostName ? `${data.hostName}님` : "모임장";
  const responses = useMemo(() => data?.responses ?? [], [data]);
  const dates = useMemo(() => event?.dates ?? [], [event]);
  const slots = useMemo(
    () => (event ? eventSlots(event) : (["D"] as Slot[])),
    [event],
  );
  const twoSlots = slots.length === 2;
  const blocked = useMemo(() => data?.blocked ?? {}, [data]);
  const manage = data?.canManage ?? false;
  const trimmedName = cleanName(name);
  const existing = responses.find((r) => r.name === trimmedName);

  /** 고를 수 있는 칸 (모임장 일정으로 빠진 칸 제외) */
  const openKeys = useMemo(
    () => (event ? allSlotKeys(event).filter((key) => !blocked[key]) : []),
    [event, blocked],
  );

  /** 칸마다 안 되는 사람. 안 되는 사람이 적은 순 */
  const ranking = useMemo(() => {
    return (
      openKeys
        .map((key) => ({
          key,
          missing: responses
            .filter((r) => r.unavailable.includes(key))
            .map((r) => r.name),
        }))
        // 안 되는 사람이 적은 순 → 빠른 날 → 같은 날이면 점심 먼저
        .sort(
          (a, b) =>
            a.missing.length - b.missing.length ||
            a.key.slice(0, 10).localeCompare(b.key.slice(0, 10)) ||
            SLOT_ORDER.indexOf(a.key.slice(11) as Slot) -
              SLOT_ORDER.indexOf(b.key.slice(11) as Slot),
        )
    );
  }, [openKeys, responses]);
  const missingByKey = useMemo(
    () => new Map(ranking.map((row) => [row.key, row.missing])),
    [ranking],
  );

  const total = responses.length;
  const confirmed = event ? confirmedOf(event) : null;

  /** 결과 달력의 날짜별 표시. 점심·저녁을 따로 받는 모임은 위 반쪽이 점심, 아래 반쪽이 저녁 */
  const cells = useMemo(() => {
    const map = new Map<string, DayCell>();
    for (const date of dates) {
      const keys = slots.map((slot) => ({ slot, key: slotKey(date, slot) }));
      const open = keys.filter((k) => !blocked[k.key]);
      const isPerfect = (key: string) =>
        total > 0 && (missingByKey.get(key)?.length ?? 0) === 0;
      const halves: HalfTone[] = keys.map((k) =>
        confirmed?.date === date && confirmed.slot === k.slot
          ? "confirmed"
          : blocked[k.key]
            ? "locked"
            : isPerfect(k.key)
              ? "perfect"
              : "plain",
      );
      const perfect = open.filter((k) => isPerfect(k.key));

      if (confirmed?.date === date) {
        map.set(date, {
          halves,
          sub: "확정",
          subTone: "ink",
          label: "확정된 날",
        });
      } else if (open.length === 0) {
        const fixed = keys.some((k) => blocked[k.key] === "fixed");
        const reason = BLOCK_TEXT[fixed ? "fixed" : "busy"];
        map.set(date, {
          halves,
          sub: BLOCK_SHORT,
          label: `${reason}, 고를 수 없음`,
        });
      } else if (total === 0) {
        map.set(date, { halves, sub: "", label: "" });
      } else if (perfect.length > 0) {
        const onlyOne = twoSlots && perfect.length < keys.length;
        const sub = onlyOne ? SLOT_LABELS[perfect[0].slot] : "모두";
        const label = onlyOne
          ? `${SLOT_LABELS[perfect[0].slot]} 모두 가능`
          : "모두 가능";
        map.set(date, { halves, sub, subTone: "blue", label });
      } else {
        const least = Math.min(
          ...open.map((k) => missingByKey.get(k.key)?.length ?? 0),
        );
        map.set(date, {
          halves,
          sub: `불가 ${least}`,
          label: `${least}명 불가`,
        });
      }
    }
    return map;
  }, [dates, slots, twoSlots, blocked, confirmed, total, missingByKey]);

  const perfectDays = [...cells.values()].filter((c) =>
    c.halves.includes("perfect"),
  ).length;
  const blockedDays = [...cells.values()].filter((c) =>
    c.halves.includes("locked"),
  ).length;
  const withStation = responses.filter((r) => r.station).length;

  // 결과 화면에서 보고 있는 날짜 (고르지 않았으면 확정일, 없으면 가장 많이 되는 날)
  const bestKey = ranking[0]?.key ?? null;
  const focusDate =
    picked && dates.includes(picked)
      ? picked
      : (confirmed?.date ?? (bestKey ? parseSlotKey(bestKey)!.date : null));

  /** 보고 있는 날짜의 시간대별 모이기 좋은 역 */
  const meetingBySlot = useMemo(() => {
    const map = new Map<Slot, MeetingPoint[]>();
    if (!focusDate) return map;
    for (const slot of slots) {
      const key = slotKey(focusDate, slot);
      if (blocked[key]) continue;
      const origins = responses
        .filter((r) => r.station && !r.unavailable.includes(key))
        .map((r) => r.station);
      map.set(slot, recommendMeetingPoints(origins));
    }
    return map;
  }, [focusDate, slots, blocked, responses]);
  /** 맛집 찾기에 쓸 역: 보고 있는 날의 첫 번째 추천 역 */
  const foodStation =
    [...meetingBySlot.values()].find((list) => list.length > 0)?.[0]?.name ??
    "";

  function toggle(key: string) {
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setFormError("");
  }

  /** 날짜를 누르면 그날 전체를 한 번에 바꾼다: 하나라도 되면 전부 안 됨으로, 전부 안 되면 전부 됨으로 */
  function toggleDay(date: string) {
    const keys = slots
      .map((slot) => slotKey(date, slot))
      .filter((key) => !blocked[key]);
    setUnavailable((prev) => {
      const next = new Set(prev);
      const allOff = keys.every((key) => next.has(key));
      for (const key of keys) {
        if (allOff) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    setEditDate(date);
    setFormError("");
  }

  /** 이 기기에서 그 응답을 고칠 수 있는지: 응답한 기기이거나 모임장 */
  const canEdit = (target: string) =>
    Boolean(manage || (event && readEditToken(event.id, target)));

  const authHeaders = (target: string): Record<string, string> => ({
    ...tokenHeaders(id),
    "x-edit-token": event ? readEditToken(event.id, target) : "",
  });

  function startEdit(target: string) {
    const found = responses.find((r) => r.name === target);
    setName(target);
    setRelation(found?.relation ?? "");
    setHidden(found?.hidden === true);
    setStation(found?.station ?? "");
    setUnavailable(new Set(found?.unavailable ?? []));
    // 관계를 아직 안 적은 예전 응답은 관계부터 묻는다
    go(found && !found.relation ? "relation" : "dates");
  }

  function submitName() {
    if (!trimmedName) {
      setFormError("이름을 입력해 주세요.");
      return;
    }
    // 이 기기로 이미 응답했다면 다른 이름으로 또 응답하지 못하게 한다 (모임장은 대신 입력 가능)
    const own = event
      ? responses.find((r) => readEditToken(event.id, r.name))
      : undefined;
    if (own && own.name !== trimmedName && !manage) {
      setFormError(
        `이 기기에서는 이미 '${own.name}' 이름으로 응답했어요. 그 이름으로 들어가서 고쳐 주세요.`,
      );
      return;
    }
    if (existing && !canEdit(existing.name)) {
      // 동명이인: 바로 쓸 수 있는 이름을 하나 제안한다 (김민수2, 김민수3 …)
      const taken = new Set(responses.map((r) => r.name));
      const base = trimmedName.slice(0, LIMITS.nameMax - 1);
      const idea = [2, 3, 4, 5, 6, 7, 8, 9]
        .map((n) => `${base}${n}`)
        .find((n) => !taken.has(n));
      setNameIdea(idea ?? "");
      setFormError(
        "이미 같은 이름으로 응답한 사람이 있어요. 다른 사람이라면 이름을 조금 다르게 적어 주세요.",
      );
      return;
    }
    setNameIdea("");
    setName(trimmedName);
    if (existing) {
      // 이미 응답한 이름이면 그 응답을 이어서 고친다
      setRelation(existing.relation || relation);
      setHidden(existing.hidden === true);
      setStation(existing.station || station);
      setUnavailable(new Set(existing.unavailable));
    } else if (!relation) {
      setFormError(`${hostLabel}과의 관계를 골라 주세요.`);
      return;
    }
    go("dates");
  }

  function markBlockedSeen() {
    if (!event) return;
    const keys = Object.keys(blocked);
    rememberSeenBlocked(event.id, keys);
    setSeenBlocked(keys);
  }

  async function save() {
    if (saving || !event) return;
    if (!trimmedName) return go("name");
    if (!relation) return go("relation");
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch(`/api/events/${event.id}/responses`, {
        method: "PUT",
        headers: authHeaders(trimmedName),
        body: JSON.stringify({
          name: trimmedName,
          hidden,
          relation,
          station,
          // 모임장 일정으로 빠진 칸은 보내지 않는다
          unavailable: openKeys.filter((key) => unavailable.has(key)),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(body.error ?? "저장하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      // 모임장이 다른 사람 응답을 고친 경우에는 "내 이름"을 그 사람으로 바꾸지 않는다
      const own = responses.find((r) => readEditToken(event.id, r.name));
      const forOther = manage && Boolean(own) && own!.name !== trimmedName;
      if (!forOther) {
        rememberName(event.id, trimmedName);
        if (body.editToken)
          rememberEditToken(event.id, trimmedName, body.editToken);
        if (station) rememberStation(station);
      }
      markBlockedSeen(); // 방금 달력에서 빠진 칸을 보고 답했으므로 따로 알리지 않는다
      await load();
      setPicked(null);
      clearDraft(event.id);
      settle("result");
      showToast(forOther ? `${trimmedName}님 응답을 고쳤어요` : "저장했어요");
      if (!forOther) setJustSaved(true);
    } catch {
      setFormError(
        "연결이 끊겼어요. 인터넷 상태를 확인하고 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeResponse(target: string) {
    if (saving || !event) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}/responses`, {
        method: "DELETE",
        headers: authHeaders(target),
        body: JSON.stringify({ name: target }),
      });
      if (!res.ok) {
        showToast("지우지 못했어요. 다시 시도해 주세요.");
        return;
      }
      if (target === trimmedName) setUnavailable(new Set());
      await load();
      settle("result");
      showToast(`${target}님 응답을 지웠어요`);
    } catch {
      showToast("연결이 끊겼어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function setConfirmed(
    next: { date: string; slot: Slot; station: string } | null,
  ) {
    if (saving || !event) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: tokenHeaders(id),
        body: JSON.stringify({ confirmed: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error ?? "확정하지 못했어요.");
        return;
      }
      setDraft(null);
      await load();
      window.scrollTo({ top: 0 });
      showToast(next ? "확정했어요" : "확정을 취소했어요");
    } catch {
      showToast("연결이 끊겼어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  /** 모임 이름 바꾸기 (모임장·관리자) */
  async function renameEvent() {
    if (saving || !event || renaming === null) return;
    const title = renaming.replace(/\s+/g, " ").trim();
    if (!title) return showToast("모임 이름을 입력해 주세요.");
    const nextExpected = editExpected ? Number(editExpected) : null;
    if (title === event.title && nextExpected === (event.expected ?? null))
      return setRenaming(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: tokenHeaders(id),
        body: JSON.stringify({ title, expected: nextExpected }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error ?? "이름을 바꾸지 못했어요. 다시 시도해 주세요.");
        return;
      }
      rememberEvent({ id: event.id, title }); // "최근에 연 모임"에도 새 이름으로
      await load();
      setRenaming(null);
      showToast("모임 정보를 바꿨어요");
    } catch {
      showToast("연결이 끊겼어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function removeEvent() {
    if (saving || !event) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "DELETE",
        headers: tokenHeaders(id),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error ?? "모임을 지우지 못했어요.");
        setConfirming("");
        return;
      }
      forgetEvent(event.id);
      router.push("/");
    } catch {
      showToast("연결이 끊겼어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(done);
    } catch {
      // 클립보드를 못 쓰는 브라우저: 주소를 직접 보여 준다
      showToast(text);
    }
  }

  /** 단톡방에 그대로 붙여 넣을 초대 문구 */
  const inviteText = () => {
    const url = window.location.origin + window.location.pathname;
    const who = data?.hostName ? `${data.hostName}님의 ` : "";
    return {
      url,
      text: `${who}'${event?.title ?? "모임"}' 날짜를 정하고 있어요.\n안 되는 날만 눌러 주세요. 1분이면 끝나요!`,
    };
  };

  // 휴대폰에서는 공유 창(카카오톡 등)을 띄우고, 안 되면 문구와 링크를 복사한다
  const shareLink = async () => {
    const { url, text } = inviteText();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${event?.title ?? "모임"} 날짜 정하기`,
          text,
          url,
        });
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return; // 공유 창을 그냥 닫음
      }
    }
    await copy(`${text}\n${url}`, "초대 문구와 링크를 복사했어요");
  };
  const copyInvite = () => {
    const { url, text } = inviteText();
    void copy(`${text}\n${url}`, "초대 문구와 링크를 복사했어요");
  };
  const copyAdminLink = () =>
    copy(
      `${window.location.origin}${window.location.pathname}#admin=${adminToken}`,
      "관리 링크를 복사했어요",
    );

  if (!event || view === "loading") {
    return (
      <main className="page">
        <p className="brand">
          <Link href="/">모임픽</Link>
        </p>
        {loadError ? (
          <div className="card empty">
            <p className="empty-title">{loadError}</p>
            <Link className="btn soft" href="/">
              모임 찾기
            </Link>
          </div>
        ) : (
          <p className="status">모임을 불러오는 중…</p>
        )}
      </main>
    );
  }

  const toastNode = (
    <div
      className={`toast${toast ? " show" : ""}`}
      role="status"
      aria-live="polite"
    >
      {toast}
    </div>
  );

  const slotWord = twoSlots ? "점심·저녁" : SLOT_LABELS[slots[0]];

  // ---------- 입력 단계 ----------
  if (view !== "result") {
    const stepIndex = view === "name" ? 0 : 1;
    const back = () =>
      goBackTo(
        view === "name" ? "result" : view === "dates" ? "name" : "dates", // 관계·출발역 고치기 화면은 날짜 화면으로 돌아간다
      );
    const noCount = openKeys.filter((key) => unavailable.has(key)).length;
    const okCount = openKeys.length - noCount;
    const hasBlocked = Object.keys(blocked).length > 0;

    const blockedKeys = new Map(
      Object.entries(blocked).map(([key, reason]) => [key, BLOCK_TEXT[reason]]),
    );
    // 입력 달력의 날짜별 표시
    const checkCells = new Map<string, DayCell>();
    for (const date of dates) {
      const keys = slots.map((slot) => ({ slot, key: slotKey(date, slot) }));
      const open = keys.filter((k) => !blocked[k.key]);
      const ok = open.filter((k) => !unavailable.has(k.key));
      const halves: HalfTone[] = keys.map((k) =>
        blocked[k.key] ? "locked" : unavailable.has(k.key) ? "no" : "ok",
      );
      if (open.length === 0) {
        const fixed = keys.some((k) => blocked[k.key] === "fixed");
        const reason = BLOCK_TEXT[fixed ? "fixed" : "busy"];
        checkCells.set(date, {
          halves,
          sub: BLOCK_SHORT,
          label: `${reason}, 고를 수 없음`,
          disabled: true,
        });
      } else if (ok.length === 0) {
        checkCells.set(date, {
          halves,
          sub: "안 됨",
          subTone: "red",
          label: "안 되는 날",
        });
      } else if (ok.length === keys.length || !twoSlots) {
        checkCells.set(date, {
          halves,
          sub: "가능",
          label: "되는 날",
        });
      } else {
        const sub = `${SLOT_LABELS[ok[0].slot]}만`;
        checkCells.set(date, {
          halves,
          sub,
          subTone: "ink",
          label: `${sub} 가능`,
        });
      }
    }

    return (
      <main
        className={`page with-cta${view === "dates" && twoSlots ? " tall-cta" : ""}`}
      >
        <div className="step-top">
          <button type="button" className="back" onClick={back}>
            {stepIndex === 0 ? "결과 보기" : "이전"}
          </button>
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={stepIndex + 1}
            aria-label="입력 단계"
          >
            <span
              style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        <p className="step-event">{event.title}</p>

        {view === "name" && (
          <>
            <h1 className="question">이름을 알려 주세요</h1>
            <p className="lead">
              다른 사람들이 알아볼 수 있는 이름으로 적어 주세요.
            </p>
            <input
              id="name-input"
              className="input big"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFormError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitName();
              }}
              placeholder="예: 홍길동"
              maxLength={LIMITS.nameMax}
              autoComplete="name"
              enterKeyHint="next"
              aria-label="이름"
            />
            {existing && canEdit(existing.name) && (
              <p className="hint">
                이미 응답한 이름이에요. 계속하면 그 응답을 고쳐요.
              </p>
            )}
            {nameIdea && existing && !canEdit(existing.name) && (
              <button
                type="button"
                className="btn soft small idea"
                onClick={() => {
                  setName(nameIdea);
                  setNameIdea("");
                  setFormError("");
                }}
              >
                &lsquo;{nameIdea}&rsquo; 이름으로 할게요
              </button>
            )}

            <div
              className="segmented two name-scope"
              role="radiogroup"
              aria-label="이름 공개 범위"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!hidden}
                className={`segment${!hidden ? " on" : ""}`}
                onClick={() => setHidden(false)}
              >
                모두에게 이름 공개
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={hidden}
                className={`segment${hidden ? " on" : ""}`}
                onClick={() => setHidden(true)}
              >
                {hostLabel}에게만
              </button>
            </div>
            <p className="hint">
              {hidden
                ? `${hostLabel}에게만 이름이 보이고, 다른 참여자에게는 '${trimmedName ? maskLabel(trimmedName) : "김*수"}'처럼 가려져요.`
                : "이 모임 링크를 가진 사람 모두에게 이름이 보여요."}
            </p>

            <p className="field-label step-label">{hostLabel}과의 관계</p>
            <div className="chips step-chips" role="group" aria-label="관계">
              {RELATIONS.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`chip${relation === item ? " on" : ""}`}
                  aria-pressed={relation === item}
                  onClick={() => {
                    setRelation(item);
                    setFormError("");
                  }}
                >
                  {item}
                </button>
              ))}
            </div>

            <p className="field-label step-label">
              출발역 <span className="optional">선택</span>
            </p>
            <StationPicker value={station} onChange={setStation} />
            <p className="hint">적으면 모두 모이기 좋은 역을 추천해 드려요.</p>
            <p className="privacy-note">
              적은 이름·관계·출발역·안 되는 시간은 이 모임 링크를 가진 사람에게
              보이고, 마지막으로 바뀐 뒤 120일이 지나면 자동으로 지워져요.{" "}
              <Link href="/privacy">개인정보 안내</Link>
            </p>
          </>
        )}

        {view === "relation" && (
          <>
            <h1 className="question">
              {trimmedName}님은 {hostLabel}과
              <br />
              어떤 사이인가요?
            </h1>
            <ul className="options">
              {RELATIONS.map((item) => (
                <li key={item}>
                  <button
                    type="button"
                    className={`option${relation === item ? " on" : ""}`}
                    aria-pressed={relation === item}
                    onClick={() => {
                      setRelation(item);
                      // 고른 것이 눈에 보인 뒤에 날짜 화면으로 돌아간다
                      setTimeout(() => goBackTo("dates"), 280);
                    }}
                  >
                    {item}
                    <span className="option-check" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {view === "station" && (
          <>
            <h1 className="question">
              어느 역에서 출발하면
              <br />
              편한가요?
            </h1>
            <p className="lead">
              그날 오는 사람들 기준으로 모이기 좋은 역을 추천해 드려요.
            </p>
            <StationPicker value={station} onChange={setStation} />
          </>
        )}

        {view === "dates" && (
          <>
            <h1 className="question">안 되는 날을 눌러 주세요</h1>
            <p className="lead">
              {twoSlots
                ? "날짜를 누르면 하루 전체가 바뀌고, 아래에서 점심·저녁만 따로 고칠 수 있어요."
                : `${slotWord} 모임이에요. 다 괜찮으면 그대로 저장하면 돼요.`}
            </p>
            {/* 날짜 화면에서 바로 관계·출발역도 바꿀 수 있게 한다 */}
            <div className="mine-info">
              <button
                type="button"
                className="info-chip"
                onClick={() => go("relation")}
              >
                {relation || "관계 고르기"}
                <span className="info-change">바꾸기</span>
              </button>
              <button
                type="button"
                className="info-chip"
                onClick={() => go("station")}
              >
                {station ? stationLabel(station) : "출발역 없음"}
                <span className="info-change">
                  {station ? "바꾸기" : "고르기"}
                </span>
              </button>
            </div>
            {hasBlocked && (
              <p className="lock-note">
                회색 칸은 모임장 일정 때문에 고를 수 없어요.
              </p>
            )}
            <div className="quick">
              <button
                type="button"
                className="btn soft small"
                onClick={() => setUnavailable(new Set())}
              >
                전부 되는 걸로
              </button>
              <button
                type="button"
                className="btn soft small"
                onClick={() => setUnavailable(new Set(openKeys))}
              >
                전부 안 되는 걸로
              </button>
            </div>
            <div className="card">
              {twoSlots && <HalfLegend tone="no" />}
              <Calendar
                dates={dates}
                cells={checkCells}
                selected={twoSlots ? editDate : undefined}
                onSelect={(date) =>
                  twoSlots ? toggleDay(date) : toggle(slotKey(date, slots[0]))
                }
              />
            </div>
            {existing &&
              canEdit(existing.name) &&
              (confirming === existing.name ? (
                <div className="confirm">
                  <span>{existing.name}님 응답을 지울까요?</span>
                  <button
                    type="button"
                    className="btn danger small"
                    onClick={() => removeResponse(existing.name)}
                  >
                    지우기
                  </button>
                  <button
                    type="button"
                    className="btn soft small"
                    onClick={() => setConfirming("")}
                  >
                    취소
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="text-btn danger"
                  onClick={() => setConfirming(existing.name)}
                >
                  내 응답 지우기
                </button>
              ))}
          </>
        )}

        <div className="cta-bar">
          <div className="cta-inner">
            {formError && (
              <p className="cta-error" role="alert">
                {formError}
              </p>
            )}
            {view === "dates" && twoSlots && editDate && (
              <DayEditor
                date={editDate}
                slots={slots}
                off={unavailable}
                blocked={blockedKeys}
                onToggle={toggle}
              />
            )}
            {view === "dates" && !formError && !(twoSlots && editDate) && (
              <p className="cta-note" aria-live="polite">
                {twoSlots ? (
                  <>
                    되는 시간 <strong>{okCount}</strong>개, 안 되는 시간{" "}
                    <strong>{noCount}</strong>개
                  </>
                ) : (
                  <>
                    되는 날 <strong>{okCount}</strong>일, 안 되는 날{" "}
                    <strong>{noCount}</strong>일
                  </>
                )}
              </p>
            )}
            {view === "name" && (
              <button
                type="button"
                className="btn primary block"
                onClick={submitName}
                disabled={!trimmedName}
              >
                다음: 안 되는 날 고르기
              </button>
            )}
            {view === "relation" && (
              <button
                type="button"
                className="btn primary block"
                onClick={() => goBackTo("dates")}
                disabled={!relation}
              >
                확인
              </button>
            )}
            {view === "station" && (
              <button
                type="button"
                className="btn primary block"
                onClick={() => goBackTo("dates")}
              >
                {station ? "확인" : "출발역 없이 하기"}
              </button>
            )}
            {view === "dates" && (
              <button
                type="button"
                className="btn primary block"
                onClick={save}
                disabled={saving}
              >
                {saving ? "저장 중…" : "저장하기"}
              </button>
            )}
          </div>
        </div>
        {toastNode}
      </main>
    );
  }

  // ---------- 결과 ----------
  // 이 기기로 응답한 내 응답 (이름 칸에 다른 이름을 적어 둔 상태여도 찾는다)
  const mine =
    responses.find(
      (r) => r.name === trimmedName && readEditToken(event.id, r.name),
    ) ?? responses.find((r) => readEditToken(event.id, r.name));
  const best = ranking[0];
  const bestSlot = best ? parseSlotKey(best.key) : null;
  // 응답 현황: 예상 인원을 적었으면 "8명 중 5명 응답"
  const expected = event.expected ?? 0;
  const progressText =
    expected > 0
      ? total >= expected
        ? `예상한 ${expected}명이 모두 응답했어요`
        : `${expected}명 중 ${total}명 응답, ${expected - total}명 남았어요`
      : "";
  // 추천 시간 3개: 안 되는 사람이 적은 순, 같으면 빠른 날. 각 시간대마다 모이기 좋은 역 1곳
  // 같은 날이 여러 번 나오지 않게 날짜마다 가장 좋은 시간대 하나만 고른다
  const seenDates = new Set<string>();
  const topRows = ranking.filter((row) => {
    const date = row.key.slice(0, 10);
    if (seenDates.has(date)) return false;
    seenDates.add(date);
    return true;
  });
  const topPicks = topRows.slice(0, 3).map((row) => {
    const parsed = parseSlotKey(row.key)!;
    const origins = responses
      .filter((r) => r.station && !r.unavailable.includes(row.key))
      .map((r) => r.station);
    return {
      ...row,
      ...parsed,
      station: recommendMeetingPoints(origins, 1)[0]?.name ?? "",
    };
  });
  const confirmedText = confirmed
    ? `${formatSlot(confirmed.date, confirmed.slot)}${confirmed.station ? `, ${stationLabel(confirmed.station)}` : ""}`
    : "";
  const notice = confirmed
    ? `[${event.title}] ${confirmedText}${confirmed.station ? "에서" : "에"} 만나요!${event.memo ? ` (${event.memo})` : ""}`
    : "";

  // 내가 응답한 뒤에 모임장 일정으로 새로 빠진 칸
  const newlyBlocked =
    mine && seenBlocked
      ? Object.keys(blocked)
          .filter((key) => !seenBlocked.includes(key))
          .sort()
      : [];
  // 알림 문구: 날짜별로 묶는다. 그날 받는 시간대가 모두 빠졌으면 날짜만 적는다.
  const blockedByDate = new Map<string, Slot[]>();
  for (const key of newlyBlocked) {
    const parsed = parseSlotKey(key);
    if (!parsed) continue;
    blockedByDate.set(parsed.date, [
      ...(blockedByDate.get(parsed.date) ?? []),
      parsed.slot,
    ]);
  }
  const blockedLabels = [...blockedByDate.entries()].map(([date, list]) =>
    list.length >= slots.length
      ? formatShort(date)
      : `${formatShort(date)} ${SLOT_LABELS[list[0]]}`,
  );

  return (
    <main className={`page with-cta${picked ? " mid-cta" : ""}`}>
      <div className="step-top">
        <Link className="back" href="/">
          모임 찾기
        </Link>
      </div>

      <header className="event-head">
        <h1 className="headline">{event.title}</h1>
        {event.memo && <p className="event-memo">{event.memo}</p>}
        <p className="event-range">
          {formatShort(dates[0])}부터 {formatShort(dates[dates.length - 1])}
          까지, {slotWord}
        </p>
      </header>

      {newlyBlocked.length > 0 && (
        <div className="alert" role="status">
          <p className="alert-title">
            모임장 일정으로 후보에서 빠진 때가 있어요
          </p>
          <p className="alert-body">
            {blockedLabels.slice(0, 4).join(", ")}
            {blockedLabels.length > 4 && ` 외 ${blockedLabels.length - 4}일`}
          </p>
          <button
            type="button"
            className="btn white small"
            onClick={markBlockedSeen}
          >
            확인했어요
          </button>
        </div>
      )}

      {!confirmed &&
        !invited &&
        ((justCreated && manage && total === 0) || justSaved) && (
          <div className="card invite-card">
            <p className="invite-title">
              {justCreated && !justSaved
                ? "모임을 만들었어요. 이제 링크를 보내 주세요"
                : "다른 사람들에게도 보내 주세요"}
            </p>
            <p className="invite-sub">
              {justCreated && !justSaved
                ? "단톡방에 보내면 각자 안 되는 날만 누르면 돼요. 가입은 필요 없어요."
                : "응답이 모일수록 추천이 정확해져요. 누구나 이 링크를 보낼 수 있어요."}
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setInvited(true);
                  void shareLink();
                }}
              >
                링크 보내기
              </button>
              <button
                type="button"
                className="btn soft"
                onClick={() => {
                  setInvited(true);
                  copyInvite();
                }}
              >
                문구 복사
              </button>
            </div>
          </div>
        )}

      {confirmed ? (
        <div className="summary good confirmed">
          <p className="summary-sub">확정했어요</p>
          <p className="summary-main">{confirmedText}</p>
          <button
            type="button"
            className="btn white small"
            onClick={() => copy(notice, "공지 문구를 복사했어요")}
          >
            공지 문구 복사
          </button>
        </div>
      ) : total === 0 && justCreated && manage && !invited ? null : (
        <div
          className={`summary${total > 0 && perfectDays > 0 ? " good" : ""}`}
        >
          {total === 0 ? (
            <>
              <p className="summary-main">아직 응답한 사람이 없어요</p>
              <p className="summary-sub">
                링크를 보내고, 내 일정부터 표시해 보세요.
              </p>
            </>
          ) : perfectDays > 0 ? (
            <>
              <p className="summary-main">
                {total}명 모두 되는 날이 {perfectDays}개 있어요
              </p>
              <p className="summary-sub">달력에서 파란 날을 눌러 보세요.</p>
            </>
          ) : (
            <>
              <p className="summary-main">모두 되는 날은 아직 없어요</p>
              {best && bestSlot && (
                <p className="summary-sub">
                  가장 많이 되는 때는 {formatSlot(bestSlot.date, bestSlot.slot)}
                  , {total - best.missing.length}명이 돼요.
                </p>
              )}
            </>
          )}
          {progressText && <p className="summary-progress">{progressText}</p>}
        </div>
      )}

      {confirmed?.station && (
        <div className="card">
          <NearbyFood
            station={stationLabel(confirmed.station)}
            title="모일 곳 근처 맛집"
          />
        </div>
      )}

      {!confirmed && total > 0 && topPicks.length > 0 && (
        <section className="section tight">
          <h2 className="section-title">추천 시간</h2>
          <ol className="card list picks">
            {topPicks.map((p, i) => (
              <li key={p.key}>
                <button
                  type="button"
                  className="row-button pick"
                  onClick={() => {
                    setPicked(p.date);
                    document
                      .getElementById("detail")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <span className="pick-rank">{i + 1}</span>
                  <span className="pick-main">
                    <span className="row-main">
                      {twoSlots
                        ? formatSlot(p.date, p.slot)
                        : formatKorean(p.date)}
                    </span>
                    <span className="row-sub">
                      {p.missing.length === 0
                        ? `${total}명 모두 가능`
                        : `${total - p.missing.length}명 가능, ${p.missing.join(", ")} 불가`}
                      {p.station && ` · ${stationLabel(p.station)} 추천`}
                    </span>
                  </span>
                  <span className="row-chevron" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="card">
        {twoSlots && <HalfLegend tone="perfect" />}
        <Calendar
          dates={dates}
          cells={cells}
          selected={focusDate}
          onSelect={setPicked}
        />
        <p className="legend">
          <span className="legend-item">
            <span className="legend-dot" aria-hidden="true" />
            모두 되는 날
          </span>
          {blockedDays > 0 && (
            <span className="legend-item">
              <span className="legend-dot locked" aria-hidden="true" />
              모임장 일정으로 빠진 날
            </span>
          )}
          {total > 0 && (
            <span className="legend-item">불가 뒤 숫자는 안 되는 사람 수</span>
          )}
        </p>
      </div>

      {focusDate && (
        <section className="card detail" id="detail" aria-live="polite">
          <h2 className="detail-date">{formatKorean(focusDate)}</h2>
          {slots.map((slot) => {
            const key = slotKey(focusDate, slot);
            const reason = blocked[key];
            if (reason) {
              return (
                <div className="slot-block" key={slot}>
                  {twoSlots && (
                    <h3 className="slot-title">{SLOT_LABELS[slot]}</h3>
                  )}
                  <p className="facts-empty flat">
                    {reason === "fixed"
                      ? "모임장의 다른 모임이 이날로 확정돼서 고를 수 없어요."
                      : "모임장 일정이 있어서 고를 수 없어요."}
                  </p>
                </div>
              );
            }
            const missing = missingByKey.get(key) ?? [];
            const meeting = meetingBySlot.get(slot) ?? [];
            const isConfirmed =
              confirmed?.date === focusDate && confirmed.slot === slot;
            const drafting =
              draft?.date === focusDate && draft.slot === slot ? draft : null;
            return (
              <div className="slot-block" key={slot}>
                {twoSlots && (
                  <h3 className="slot-title">{SLOT_LABELS[slot]}</h3>
                )}
                {total > 0 ? (
                  <p className="detail-count">
                    {missing.length === 0
                      ? `${total}명 모두 돼요`
                      : `${total}명 중 ${total - missing.length}명이 돼요`}
                  </p>
                ) : (
                  <p className="facts-empty flat">아직 응답한 사람이 없어요.</p>
                )}
                {missing.length > 0 && (
                  <dl className="facts">
                    <dt>안 되는 사람</dt>
                    <dd>{missing.join(", ")}</dd>
                  </dl>
                )}
                {meeting.length > 0 && (
                  <dl className="facts">
                    <dt>모이기 좋은 역</dt>
                    <dd>
                      <a
                        className="station-link"
                        href={`https://map.naver.com/p/search/${encodeURIComponent(stationLabel(meeting[0].name))}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {stationLabel(meeting[0].name)}
                      </a>
                      {meeting[0].maxStops > 0 && (
                        <span className="facts-sub">
                          가장 먼 사람이 {meeting[0].maxStops}정거장
                        </span>
                      )}
                      {meeting.length > 1 && (
                        <span className="facts-sub">
                          다른 후보:{" "}
                          {meeting
                            .slice(1)
                            .map((p) => stationLabel(p.name))
                            .join(", ")}
                        </span>
                      )}
                    </dd>
                  </dl>
                )}
                {manage &&
                  (isConfirmed ? (
                    <button
                      type="button"
                      className="btn soft block confirm-btn"
                      onClick={() => setConfirmed(null)}
                      disabled={saving}
                    >
                      확정 취소
                    </button>
                  ) : !drafting ? (
                    <button
                      type="button"
                      className={`btn ${total > 0 ? "primary" : "soft"} block confirm-btn`}
                      onClick={() =>
                        setDraft({
                          date: focusDate,
                          slot,
                          station: meeting[0]?.name ?? "",
                          searching: false,
                        })
                      }
                    >
                      {twoSlots
                        ? `이 날 ${SLOT_LABELS[slot]}으로 확정하기`
                        : "이 날로 확정하기"}
                    </button>
                  ) : (
                    <div className="confirm-panel">
                      <p className="confirm-title">어디서 모일까요?</p>
                      <div className="chips">
                        {meeting.map((point) => (
                          <button
                            type="button"
                            key={point.name}
                            className={`chip${!drafting.searching && drafting.station === point.name ? " on" : ""}`}
                            aria-pressed={
                              !drafting.searching &&
                              drafting.station === point.name
                            }
                            onClick={() =>
                              setDraft({
                                ...drafting,
                                station: point.name,
                                searching: false,
                              })
                            }
                          >
                            {stationLabel(point.name)}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={`chip${drafting.searching ? " on" : ""}`}
                          aria-pressed={drafting.searching}
                          onClick={() =>
                            setDraft({
                              ...drafting,
                              station: "",
                              searching: true,
                            })
                          }
                        >
                          다른 역 검색
                        </button>
                        <button
                          type="button"
                          className={`chip${!drafting.searching && drafting.station === "" ? " on" : ""}`}
                          aria-pressed={
                            !drafting.searching && drafting.station === ""
                          }
                          onClick={() =>
                            setDraft({
                              ...drafting,
                              station: "",
                              searching: false,
                            })
                          }
                        >
                          장소는 나중에
                        </button>
                      </div>
                      {drafting.searching && (
                        <StationPicker
                          value={drafting.station}
                          onChange={(next) =>
                            setDraft({
                              ...drafting,
                              station: next,
                              searching: true,
                            })
                          }
                        />
                      )}
                      <button
                        type="button"
                        className="btn primary block confirm-btn"
                        onClick={() =>
                          setConfirmed({
                            date: drafting.date,
                            slot: drafting.slot,
                            station: drafting.station,
                          })
                        }
                        disabled={
                          saving || (drafting.searching && !drafting.station)
                        }
                      >
                        {formatSlot(drafting.date, drafting.slot)}
                        {drafting.station
                          ? `, ${stationLabel(drafting.station)}`
                          : ""}
                        {" 확정"}
                      </button>
                      <p className="fineprint">
                        확정하면 내가 만든 다른 모임에서는 이날을 고를 수 없게
                        돼요.
                      </p>
                    </div>
                  ))}
              </div>
            );
          })}
          {!confirmed && !draft && foodStation && (
            <NearbyFood station={stationLabel(foodStation)} />
          )}
          {withStation > 0 && (
            <p className="fineprint">
              모이기 좋은 역은 출발역을 적은 {withStation}명 중 그때 되는
              사람들의 정거장 수로 골랐어요. 환승 시간은 반영하지 않았어요.
            </p>
          )}
        </section>
      )}

      {total > 0 && (
        <section className="section">
          <h2 className="section-title">
            응답한 사람 <span className="count">{total}명</span>
          </h2>
          <ul className="card list">
            {responses.map((r) => {
              const count = openKeys.filter((key) =>
                r.unavailable.includes(key),
              ).length;
              return (
                <li key={r.name} className="row">
                  <button
                    type="button"
                    className="row-button"
                    onClick={() => startEdit(r.name)}
                    disabled={!canEdit(r.name)}
                  >
                    <span className="row-main">
                      {r.name}
                      {mine?.name === r.name && <span className="me">나</span>}
                      {r.hidden && !r.masked && (
                        <span className="me muted">이름 비공개</span>
                      )}
                    </span>
                    <span className="row-sub">
                      {[r.relation, r.station && stationLabel(r.station)]
                        .filter(Boolean)
                        .join(", ") || "관계 미입력"}
                    </span>
                  </button>
                  <span className="row-side">
                    {count === 0
                      ? "다 돼요"
                      : twoSlots
                        ? `${count}개 불가`
                        : `${count}일 불가`}
                  </span>
                  {canEdit(r.name) && (
                    <button
                      type="button"
                      className="text-btn edit"
                      onClick={() => startEdit(r.name)}
                    >
                      수정
                    </button>
                  )}
                  {manage &&
                    (confirming === r.name ? (
                      <button
                        type="button"
                        className="btn danger small"
                        onClick={() => removeResponse(r.name)}
                      >
                        지우기
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => setConfirming(r.name)}
                      >
                        삭제
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>
          <p className="fineprint">
            {manage
              ? "모임장은 이름을 눌러 누구의 응답이든 고칠 수 있어요."
              : "내 응답은 응답했던 기기에서만 고칠 수 있어요."}
          </p>
        </section>
      )}

      {manage && (
        <section className="section">
          <h2 className="section-title">모임 관리</h2>
          <div className="card manage">
            <p className="manage-note">
              {isHost
                ? "모임장으로 들어와 있어요. 내가 안 되는 시간은 모임장 일정에서 한 번만 적으면 모든 모임에 반영돼요."
                : "이 기기에서 만든 모임이라 관리할 수 있어요."}
            </p>
            {renaming === null ? (
              <button
                type="button"
                className="btn soft block"
                onClick={() => {
                  setRenaming(event.title);
                  setEditExpected(event.expected ? String(event.expected) : "");
                }}
              >
                모임 이름·인원 바꾸기
              </button>
            ) : (
              <form
                className="rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  void renameEvent();
                }}
              >
                <input
                  className="input"
                  value={renaming}
                  maxLength={LIMITS.titleMax}
                  aria-label="모임 이름"
                  onChange={(e) => setRenaming(e.target.value)}
                  autoFocus
                />
                <input
                  className="input"
                  inputMode="numeric"
                  value={editExpected}
                  aria-label="예상 인원"
                  placeholder="예상 인원 (선택, 예: 8)"
                  onChange={(e) =>
                    setEditExpected(
                      e.target.value.replace(/\D/g, "").slice(0, 2),
                    )
                  }
                />
                <div className="btn-row">
                  <button
                    type="submit"
                    className="btn primary"
                    disabled={saving}
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    className="btn soft"
                    onClick={() => setRenaming(null)}
                  >
                    취소
                  </button>
                </div>
              </form>
            )}
            <Link className="btn soft block" href="/host">
              모임장 일정 관리
            </Link>
            {adminToken && (
              <button
                type="button"
                className="btn soft block"
                onClick={copyAdminLink}
              >
                이 모임 관리 링크 복사
              </button>
            )}
            {confirming === "event" ? (
              <div className="confirm">
                <span>
                  모임과 응답 {total}건을 모두 지워요. 되돌릴 수 없어요.
                </span>
                <button
                  type="button"
                  className="btn danger small"
                  onClick={removeEvent}
                  disabled={saving}
                >
                  지우기
                </button>
                <button
                  type="button"
                  className="btn soft small"
                  onClick={() => setConfirming("")}
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="text-btn danger"
                onClick={() => setConfirming("event")}
              >
                모임 삭제
              </button>
            )}
          </div>
        </section>
      )}

      <p className="credit">
        역 정보 ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{" "}
        기여자 · <Link href="/privacy">개인정보 안내</Link>
      </p>

      <div className="cta-bar">
        <div className="cta-inner">
          {picked && focusDate === picked && (
            <button
              type="button"
              className="pick-bar"
              onClick={() =>
                document.getElementById("detail")?.scrollIntoView({
                  block: "start",
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                })
              }
            >
              <span className="pick-text">
                <span className="pick-date">{formatKorean(picked)}</span>
                <span className="pick-info">
                  {slots
                    .map((slot) => {
                      const key = slotKey(picked, slot);
                      const prefix = twoSlots ? `${SLOT_LABELS[slot]} ` : "";
                      if (blocked[key])
                        return `${prefix}${BLOCK_TEXT[blocked[key]]}`;
                      if (total === 0) return `${prefix}응답 없음`;
                      const missing = missingByKey.get(key)?.length ?? 0;
                      return missing === 0
                        ? `${prefix}${total}명 모두 가능`
                        : `${prefix}${total}명 중 ${total - missing}명 가능`;
                    })
                    .join(", ")}
                </span>
              </span>
              <span className="pick-more">
                자세히
                <span className="row-chevron" aria-hidden="true" />
              </span>
            </button>
          )}
          <div className="cta-two">
            <button type="button" className="btn soft" onClick={shareLink}>
              초대하기
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => (mine ? startEdit(mine.name) : go("name"))}
            >
              {mine ? "내 일정 고치기" : "내 일정 표시하기"}
            </button>
          </div>
        </div>
      </div>
      {toastNode}
    </main>
  );
}

/** 고리(점심·저녁이 다른 날) 읽는 법 */
function HalfLegend({ tone }: { tone: "no" | "perfect" }) {
  return (
    <p className="half-legend">
      <span className="mini-ring" aria-hidden="true">
        <i className={tone} />
        <i />
      </span>
      {tone === "no"
        ? "점심과 저녁이 다르면 고리로 보여요. 위쪽이 점심, 아래쪽이 저녁이고 빨간 쪽이 안 되는 시간이에요."
        : "점심과 저녁이 다르면 고리로 보여요. 위쪽이 점심, 아래쪽이 저녁이고 파란 쪽이 모두 되는 시간이에요."}
    </p>
  );
}

/** 이 기기가 가진 관리 토큰과 모임장 토큰을 요청에 싣는다 */
function tokenHeaders(eventId: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-admin-token": readAdminToken(eventId),
    "x-host-token": readHostToken(),
    "x-device-token": deviceToken(),
  };
}

type FetchResult =
  | { ok: true; payload: EventPayload }
  | { ok: false; error: string; network: boolean; gone: boolean };

async function fetchEvent(id: string): Promise<FetchResult> {
  try {
    const res = await fetch(`/api/events/${id}`, {
      cache: "no-store",
      headers: tokenHeaders(id),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 404는 지워졌거나 없는 모임이다
      const gone = res.status === 404;
      return {
        ok: false,
        error: gone
          ? "지워졌거나 없는 모임이에요."
          : (body.error ?? "모임을 불러오지 못했어요."),
        network: false,
        gone,
      };
    }
    return { ok: true, payload: body as EventPayload };
  } catch {
    return {
      ok: false,
      error: "연결이 끊겼어요. 인터넷 상태를 확인해 주세요.",
      network: true,
      gone: false,
    };
  }
}

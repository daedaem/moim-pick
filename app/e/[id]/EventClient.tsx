"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar, {
  type DayCell,
  type HalfTone,
} from "@/app/components/Calendar";
import DayEditor from "@/app/components/DayEditor";
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
  formatSlotShort,
  parseSlotKey,
  SLOT_LABELS,
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

const STEPS: View[] = ["name", "relation", "station", "dates"];

const BLOCK_TEXT: Record<BlockReason, string> = {
  busy: "모임장 불가",
  fixed: "다른 모임",
};

/** 달력 칸 아래 글씨는 세 글자 안쪽으로 짧게 쓴다 (칸이 좁아서 길면 옆 칸과 붙는다) */
const BLOCK_SHORT = "불가";

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
  const [station, setStation] = useState("");
  /** 안 된다고 표시한 칸 ("날짜:시간대") */
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
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

  const apply = useCallback((result: FetchResult) => {
    if (result.ok) {
      setLoadError("");
      setData(result.payload);
    } else {
      // 이미 화면이 떠 있는데 잠깐 연결이 끊긴 경우에는 기존 내용을 그대로 둔다
      setLoadError((prev) =>
        result.network ? prev || result.error : result.error,
      );
    }
  }, []);

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
      if (mine) {
        setRelation(mine.relation);
        setStation(mine.station);
        setUnavailable(new Set(mine.unavailable));
        setSeenBlocked(readSeenBlocked(event.id) ?? []);
        settle("result");
      } else {
        // 다른 모임에서 골랐던 출발역은 다시 묻지 않는다
        setStation(readStation());
        // 이미 확정된 모임은 결과(확정 내용)부터 보여 준다
        settle(event.confirmed ? "result" : "name");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, apply, settle]);

  // 다른 사람이 응답하면 반영되도록, 화면을 보고 있는 동안 주기적으로 새로 고친다
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 20_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const event = data?.event ?? null;
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
    return openKeys
      .map((key) => ({
        key,
        missing: responses
          .filter((r) => r.unavailable.includes(key))
          .map((r) => r.name),
      }))
      .sort(
        (a, b) =>
          a.missing.length - b.missing.length || a.key.localeCompare(b.key),
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
      setRelation(existing.relation);
      setStation(existing.station);
      setUnavailable(new Set(existing.unavailable));
    }
    go("relation");
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
      rememberName(event.id, trimmedName);
      if (body.editToken)
        rememberEditToken(event.id, trimmedName, body.editToken);
      if (station) rememberStation(station);
      markBlockedSeen(); // 방금 달력에서 빠진 칸을 보고 답했으므로 따로 알리지 않는다
      await load();
      setPicked(null);
      settle("result");
      showToast("저장했어요");
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

  // 휴대폰에서는 공유 창(카카오톡 등)을 띄우고, 안 되면 링크를 복사한다
  const shareLink = async () => {
    const url = window.location.origin + window.location.pathname;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `${event?.title ?? "모임"} 날짜 정하기`,
          url,
        });
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return; // 공유 창을 그냥 닫음
      }
    }
    await copy(url, "링크를 복사했어요");
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
    const stepIndex = STEPS.indexOf(view);
    const back = () =>
      goBackTo(stepIndex === 0 ? "result" : STEPS[stepIndex - 1]);
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
          </>
        )}

        {view === "relation" && (
          <>
            <h1 className="question">
              {trimmedName}님은 모임장과
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
                      // 고른 것이 눈에 보인 뒤에 다음으로 넘어간다
                      setTimeout(() => go("station"), 280);
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
                다음
              </button>
            )}
            {view === "relation" && (
              <button
                type="button"
                className="btn primary block"
                onClick={() => go("station")}
                disabled={!relation}
              >
                다음
              </button>
            )}
            {view === "station" && (
              <button
                type="button"
                className="btn primary block"
                onClick={() => go("dates")}
              >
                {station ? "다음" : "건너뛰기"}
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
            {newlyBlocked.slice(0, 4).map(formatSlotShort).join(", ")}
            {newlyBlocked.length > 4 && ` 외 ${newlyBlocked.length - 4}개`}
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
      ) : (
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
                {total}명 모두 되는 날이 {perfectDays}일 있어요
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
        </div>
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
                  total > 0 &&
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
                      className="btn primary block confirm-btn"
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
        기여자
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
  | { ok: false; error: string; network: boolean };

async function fetchEvent(id: string): Promise<FetchResult> {
  try {
    const res = await fetch(`/api/events/${id}`, {
      cache: "no-store",
      headers: tokenHeaders(id),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: body.error ?? "모임을 불러오지 못했어요.",
        network: false,
      };
    }
    return { ok: true, payload: body as EventPayload };
  } catch {
    return {
      ok: false,
      error: "연결이 끊겼어요. 인터넷 상태를 확인해 주세요.",
      network: true,
    };
  }
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar, {
  type DayCell,
  type HalfTone,
} from "@/app/components/Calendar";
import DayEditor from "@/app/components/DayEditor";
import { addDays, localToday } from "@/lib/dates";
import {
  ensureHostToken,
  readHostToken,
  rememberHostToken,
  takeHashToken,
} from "@/lib/recent";
import { formatSlot, SLOT_LABELS, SLOT_ORDER, slotKey } from "@/lib/slots";
import { stationLabel } from "@/lib/stations";
import type { Slot } from "@/lib/types";

type HostEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  slots: Slot[];
  confirmed: { date: string; slot: Slot; station: string } | null;
};

const DAYS_AHEAD = 100;

export default function HostPage() {
  const [token, setToken] = useState<string | null>(null); // null = 아직 확인 전
  const [today, setToday] = useState("");
  const [blocks, setBlocks] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<HostEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editDate, setEditDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const load = useCallback(async (hostToken: string) => {
    try {
      const res = await fetch("/api/host", {
        cache: "no-store",
        headers: { "x-host-token": hostToken },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setBlocks(new Set<string>(body.blocks));
      setEvents(body.events);
      setLoaded(true);
      setError("");
    } catch {
      setError("모임장 일정을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.");
    }
  }, []);

  useEffect(() => {
    // 모임장 링크(#host=토큰)로 들어왔으면 이 기기를 같은 모임장으로 만든다
    const fromHash = takeHashToken("host");
    if (fromHash) rememberHostToken(fromHash);
    const current = readHostToken();
    const timer = setTimeout(() => {
      setToday(localToday());
      setToken(current);
      if (current) void load(current);
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const dates = useMemo(
    () =>
      today
        ? Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i))
        : [],
    [today],
  );

  function start() {
    const created = ensureHostToken();
    setToken(created);
    void load(created);
  }

  function toggle(key: string) {
    setBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setDirty(true);
  }

  /** 날짜를 누르면 그날 전체를 한 번에 바꾼다 */
  function toggleDay(date: string) {
    const keys = SLOT_ORDER.map((slot) => slotKey(date, slot));
    setBlocks((prev) => {
      const next = new Set(prev);
      const allOff = keys.every((key) => next.has(key));
      for (const key of keys) {
        if (allOff) next.delete(key);
        else next.add(key);
      }
      return next;
    });
    setEditDate(date);
    setDirty(true);
  }

  async function save() {
    if (saving || !token) return;
    setSaving(true);
    try {
      // 지난 날짜는 버린다
      const keep = [...blocks].filter((key) => key.slice(0, 10) >= today);
      const res = await fetch("/api/host", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-host-token": token },
        body: JSON.stringify({ blocks: keep }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error ?? "저장하지 못했어요.");
        return;
      }
      setBlocks(new Set<string>(body.blocks));
      setDirty(false);
      showToast("저장했어요. 내 모든 모임에 반영돼요.");
    } catch {
      showToast("연결이 끊겼어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function copyHostLink() {
    const link = `${window.location.origin}/host#host=${token}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast("모임장 링크를 복사했어요");
    } catch {
      showToast(link);
    }
  }

  const fixed = events.filter((e) => e.confirmed);

  // 달력의 날짜별 표시: 위 반쪽이 점심, 아래 반쪽이 저녁
  const fixedByDate = new Map(fixed.map((e) => [e.confirmed!.date, e]));
  const cells = new Map<string, DayCell>();
  for (const date of dates) {
    const fixedEvent = fixedByDate.get(date);
    if (fixedEvent) {
      const halves: HalfTone[] = SLOT_ORDER.map((slot) =>
        fixedEvent.confirmed!.slot === slot ? "confirmed" : "locked",
      );
      cells.set(date, {
        halves,
        sub: "모임 확정",
        subTone: "ink",
        label: `${fixedEvent.title} 확정`,
        disabled: true,
      });
      continue;
    }
    const off = SLOT_ORDER.filter((slot) => blocks.has(slotKey(date, slot)));
    const halves: HalfTone[] = SLOT_ORDER.map((slot) =>
      blocks.has(slotKey(date, slot)) ? "no" : "ok",
    );
    if (off.length === 2)
      cells.set(date, {
        halves,
        sub: "안 돼요",
        subTone: "red",
        label: "하루 종일 안 됨",
      });
    else if (off.length === 1) {
      const sub = `${SLOT_LABELS[off[0]]} 안 됨`;
      cells.set(date, { halves, sub, subTone: "red", label: sub });
    } else cells.set(date, { halves, sub: "", label: "가능" });
  }
  const blockedCount = [...blocks].filter(
    (key) => key.slice(0, 10) >= today,
  ).length;

  return (
    <main className={`page with-cta${editDate ? " tall-cta" : ""}`}>
      <div className="step-top">
        <Link className="back" href="/">
          모임 찾기
        </Link>
      </div>

      <h1 className="question">모임장 일정</h1>
      <p className="lead">
        내가 안 되는 시간을 눌러 두세요. 내가 만든 모든 모임에서 그 시간은
        아무도 고를 수 없게 돼요.
      </p>

      {token === null ? (
        <p className="status">불러오는 중…</p>
      ) : token === "" ? (
        <div className="card stack-gap">
          <p>아직 이 기기는 모임장으로 등록되지 않았어요.</p>
          <p className="row-sub">
            시작하면 이 브라우저에 모임장 열쇠가 저장돼요. 다른 기기에서 쓰던
            모임장이 있다면 그 기기에서 모임장 링크를 복사해 와서 여세요.
          </p>
          <button type="button" className="btn primary block" onClick={start}>
            모임장으로 시작하기
          </button>
        </div>
      ) : error ? (
        <div className="card empty">
          <p className="empty-title">{error}</p>
        </div>
      ) : !loaded ? (
        <p className="status">불러오는 중…</p>
      ) : (
        <>
          {fixed.length > 0 && (
            <section className="section">
              <h2 className="section-title">확정된 모임</h2>
              <ul className="card list">
                {fixed.map((e) => (
                  <li key={e.id}>
                    <Link className="row" href={`/e/${e.id}`}>
                      <span className="row-text">
                        <span className="row-main">{e.title}</span>
                        <span className="row-sub">
                          {formatSlot(e.confirmed!.date, e.confirmed!.slot)}
                          {e.confirmed!.station &&
                            `, ${stationLabel(e.confirmed!.station)}`}
                        </span>
                      </span>
                      <span className="row-chevron" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="fineprint">
                확정된 날은 다른 모임에서 자동으로 고를 수 없게 돼요.
              </p>
            </section>
          )}

          <section className="section">
            <h2 className="section-title">안 되는 시간</h2>
            <div className="card">
              <p className="half-legend">
                <span className="mini-ring" aria-hidden="true">
                  <i className="no" />
                  <i />
                </span>
                날짜를 누르면 하루 전체가 바뀌어요. 점심과 저녁이 다르면 고리로
                보이고, 위쪽이 점심, 아래쪽이 저녁이에요.
              </p>
              <Calendar
                dates={dates}
                cells={cells}
                selected={editDate}
                onSelect={toggleDay}
              />
            </div>
          </section>

          {events.length > 0 && (
            <section className="section">
              <h2 className="section-title">
                내가 만든 모임 <span className="count">{events.length}개</span>
              </h2>
              <ul className="card list">
                {events.map((e) => (
                  <li key={e.id}>
                    <Link className="row" href={`/e/${e.id}`}>
                      <span className="row-main">{e.title}</span>
                      <span className="row-chevron" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="section">
            <h2 className="section-title">다른 기기에서도 모임장으로 쓰기</h2>
            <div className="card manage">
              <p className="manage-note">
                모임장 링크를 다른 기기에서 열면 그 기기도 같은 모임장이 돼요.
                이 링크를 가진 사람은 내 모든 모임을 관리할 수 있으니 나에게만
                보내세요.
              </p>
              <button
                type="button"
                className="btn soft block"
                onClick={copyHostLink}
              >
                모임장 링크 복사
              </button>
            </div>
          </section>

          <div className="cta-bar">
            <div className="cta-inner">
              {editDate && !fixedByDate.has(editDate) && (
                <DayEditor
                  date={editDate}
                  slots={SLOT_ORDER}
                  off={blocks}
                  onToggle={toggle}
                />
              )}
              <p className="cta-note" aria-live="polite">
                안 되는 시간 <strong>{blockedCount}</strong>개
                {dirty && ", 아직 저장 전이에요"}
              </p>
              <button
                type="button"
                className="btn primary block"
                onClick={save}
                disabled={saving || !dirty}
              >
                {saving ? "저장 중…" : "저장하기"}
              </button>
            </div>
          </div>
        </>
      )}

      <div
        className={`toast${toast ? " show" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </main>
  );
}

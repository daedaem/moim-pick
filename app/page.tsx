"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  addDays,
  buildCandidates,
  formatShort,
  localToday,
  WEEKDAY_LABELS,
} from "@/lib/dates";
import {
  parseRecent,
  readRecentRaw,
  rememberAdminToken,
  rememberEvent,
} from "@/lib/recent";
import { LIMITS } from "@/lib/types";

// 월~일 순서로 보여 준다 (값은 Date.getDay 기준: 일=0)
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const subscribeNever = () => () => {};

export default function HomePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  // 기간을 직접 고치기 전에는 "내일부터 4주"를 기본값으로 보여 준다
  const [startInput, setStart] = useState<string | null>(null);
  const [endInput, setEnd] = useState<string | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 오늘 날짜와 최근 모임은 보는 사람 기기에서만 알 수 있어서, 서버에서 그릴 때는 비워 둔다
  const today = useSyncExternalStore(subscribeNever, localToday, () => "");
  const recentRaw = useSyncExternalStore(
    subscribeNever,
    readRecentRaw,
    () => "",
  );
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);
  const start = startInput ?? (today ? addDays(today, 1) : "");
  const end = endInput ?? (today ? addDays(today, 28) : "");

  const candidates = useMemo(
    () => buildCandidates(start, end, weekdays),
    [start, end, weekdays],
  );

  function toggleWeekday(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!title.trim()) return setError("모임 이름을 입력해 주세요.");
    if (candidates.length === 0)
      return setError("후보 날짜가 없어요. 기간과 요일을 확인해 주세요.");
    setBusy(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, memo, start, end, weekdays }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "모임을 만들지 못했어요. 다시 시도해 주세요.");
        setBusy(false);
        return;
      }
      rememberEvent({ id: data.event.id, title: data.event.title });
      if (data.adminToken) rememberAdminToken(data.event.id, data.adminToken);
      router.push(`/e/${data.event.id}`);
    } catch {
      setError("연결이 끊겼어요. 인터넷 상태를 확인하고 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  return (
    <main className="page with-cta">
      <p className="brand">모임픽</p>

      <h1 className="headline">
        언제 모일지,
        <br />
        링크 하나로 정해요
      </h1>
      <p className="lead">
        각자 안 되는 날만 누르면 모두 되는 날을 달력에 표시해 드려요.
      </p>

      <form id="create-form" className="stack" onSubmit={submit} noValidate>
        <div className="card">
          <label className="field">
            <span className="field-label">모임 이름</span>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 팀 청첩장 모임"
              maxLength={LIMITS.titleMax}
              enterKeyHint="next"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">
              메모 <span className="optional">선택</span>
            </span>
            <input
              className="input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 저녁 7시쯤"
              maxLength={LIMITS.memoMax}
            />
          </label>
        </div>

        <div className="card">
          <div className="field-row">
            <label className="field">
              <span className="field-label">이날부터</span>
              <input
                className="input"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">이날까지</span>
              <input
                className="input"
                type="date"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                required
              />
            </label>
          </div>

          <fieldset className="field">
            <legend className="field-label">후보에 넣을 요일</legend>
            <div className="weekday-row">
              {WEEKDAY_ORDER.map((day) => {
                const on = weekdays.includes(day);
                return (
                  <button
                    type="button"
                    key={day}
                    className={`weekday${on ? " on" : ""}`}
                    aria-pressed={on}
                    aria-label={`${WEEKDAY_LABELS[day]}요일`}
                    onClick={() => toggleWeekday(day)}
                  >
                    {WEEKDAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <p className="form-summary" aria-live="polite">
            {candidates.length > 0
              ? `${formatShort(candidates[0])}부터 ${formatShort(candidates[candidates.length - 1])}까지 후보 ${candidates.length}일`
              : start && end
                ? "후보 날짜가 없어요. 기간과 요일을 확인해 주세요."
                : " "}
          </p>
        </div>
      </form>

      {recent.length > 0 && (
        <section className="section">
          <h2 className="section-title">이 기기에서 열어 본 모임</h2>
          <ul className="card list">
            {recent.map((item) => (
              <li key={item.id}>
                <Link className="row" href={`/e/${item.id}`}>
                  <span className="row-main">{item.title}</span>
                  <span className="row-chevron" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="cta-bar">
        <div className="cta-inner">
          {error && (
            <p className="cta-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn primary block"
            type="submit"
            form="create-form"
            disabled={busy}
          >
            {busy ? "만드는 중…" : "모임 링크 만들기"}
          </button>
        </div>
      </div>
    </main>
  );
}

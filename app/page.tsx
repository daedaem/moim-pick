"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  addDays,
  buildCandidates,
  formatShort,
  localToday,
  WEEKDAY_LABELS,
} from "@/lib/dates";
import {
  ensureHostToken,
  parseRecent,
  readHostToken,
  readRecentRaw,
  rememberAdminToken,
  rememberEvent,
} from "@/lib/recent";
import { LIMITS, type EventSummary, type Slot } from "@/lib/types";

// 월~일 순서로 보여 준다 (값은 Date.getDay 기준: 일=0)
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const subscribeNever = () => () => {};

export default function HomePage() {
  const router = useRouter();

  // 찾기
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{
    q: string;
    events: EventSummary[];
  } | null>(null);
  const q = query.replace(/\s+/g, " ").trim();

  // 만들기
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  // 기간을 직접 고치기 전에는 "내일부터 4주"를 기본값으로 보여 준다
  const [startInput, setStart] = useState<string | null>(null);
  const [endInput, setEnd] = useState<string | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [searchable, setSearchable] = useState(true);
  const [slotChoice, setSlotChoice] = useState<"L" | "D" | "LD">("LD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 오늘 날짜와 최근 모임은 보는 사람 기기에서만 알 수 있어서, 서버에서 그릴 때는 비워 둔다
  const today = useSyncExternalStore(subscribeNever, localToday, () => "");
  const recentRaw = useSyncExternalStore(
    subscribeNever,
    readRecentRaw,
    () => "",
  );
  const hasHost = useSyncExternalStore(
    subscribeNever,
    () => readHostToken() !== "",
    () => false,
  );
  const recent = useMemo(() => parseRecent(recentRaw), [recentRaw]);
  const start = startInput ?? (today ? addDays(today, 1) : "");
  const end = endInput ?? (today ? addDays(today, 28) : "");

  const candidates = useMemo(
    () => buildCandidates(start, end, weekdays),
    [start, end, weekdays],
  );

  // 입력이 잠깐 멈추면 이름으로 모임을 찾는다
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/events?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (!cancelled)
          setFound({
            q,
            events: Array.isArray(body.events) ? body.events : [],
          });
      } catch {
        if (!cancelled) setFound({ q, events: [] });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const results = q.length >= 2 && found?.q === q ? found.events : null;

  function toggleWeekday(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  function openCreate(prefill: string) {
    if (prefill && !title) setTitle(prefill.slice(0, LIMITS.titleMax));
    setCreating(true);
    window.scrollTo({ top: 0 });
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
        headers: {
          "Content-Type": "application/json",
          // 내가 만든 모임들을 한 사람(모임장)의 것으로 묶는다
          "x-host-token": ensureHostToken(),
        },
        body: JSON.stringify({
          title,
          memo,
          start,
          end,
          weekdays,
          searchable,
          slots: slotChoice.split("") as Slot[],
        }),
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

  // ---------- 새 모임 만들기 ----------
  if (creating) {
    return (
      <main className="page with-cta">
        <div className="step-top">
          <button
            type="button"
            className="back"
            onClick={() => setCreating(false)}
          >
            모임 찾기
          </button>
        </div>

        <h1 className="question">새 모임 만들기</h1>
        <p className="lead">만든 뒤 링크를 보내 사람들을 초대해요.</p>

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
              <legend className="field-label">시간대</legend>

              <div className="segmented">
                {(
                  [
                    ["L", "점심만"],

                    ["D", "저녁만"],

                    ["LD", "점심·저녁 둘 다"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    type="button"

                    key={value}

                    className={`segment${slotChoice === value ? " on" : ""}`}

                    aria-pressed={slotChoice === value}

                    onClick={() => setSlotChoice(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

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

          <div className="card">
            <button
              type="button"
              className="switch-row"
              role="switch"
              aria-checked={searchable}
              onClick={() => setSearchable((v) => !v)}
            >
              <span>
                <span className="switch-title">이름으로 검색 허용</span>
                <span className="switch-sub">
                  {searchable
                    ? "첫 화면에서 모임 이름을 검색하면 누구나 찾아 들어올 수 있어요."
                    : "링크를 받은 사람만 들어올 수 있어요."}
                </span>
              </span>
              <span
                className={`switch${searchable ? " on" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </form>

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

  // ---------- 모임 찾기 ----------
  return (
    <main className="page with-cta">
      <p className="brand">모임픽</p>

      <h1 className="headline">
        어떤 모임에
        <br />
        오셨나요?
      </h1>
      <p className="lead">
        모임 이름을 검색해서 들어가세요. 없으면 새로 만들 수 있어요.
      </p>

      <input
        className="input big"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="모임 이름 검색"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label="모임 이름 검색"
      />

      {q.length === 1 && (
        <p className="hint muted">두 글자 이상 입력해 주세요.</p>
      )}

      {results && results.length > 0 && (
        <ul className="card list results">
          {results.map((item) => (
            <li key={item.id}>
              <Link className="row" href={`/e/${item.id}`}>
                <span className="row-text">
                  <span className="row-main">{item.title}</span>
                  <span className="row-sub">
                    {formatShort(item.start)}부터 {formatShort(item.end)}까지
                    {item.memo && `, ${item.memo}`}
                  </span>
                </span>
                <span className="row-chevron" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {results && results.length === 0 && (
        <div className="card results empty-result">
          <p className="empty-title">&lsquo;{q}&rsquo; 모임을 찾지 못했어요</p>
          <p className="row-sub">
            이름을 다시 확인하거나, 이 이름으로 새 모임을 만들어 보세요.
          </p>
          <button
            type="button"
            className="btn soft block"
            onClick={() => openCreate(q)}
          >
            &lsquo;{q}&rsquo; 모임 만들기
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <section className="section">
          <h2 className="section-title">최근에 연 모임</h2>
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

      {hasHost && (
        <section className="section">
          <ul className="card list">
            <li>
              <Link className="row" href="/host">
                <span className="row-text">
                  <span className="row-main">모임장 일정 관리</span>
                  <span className="row-sub">
                    내가 안 되는 시간, 내가 만든 모임
                  </span>
                </span>
                <span className="row-chevron" aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </section>
      )}

      <div className="cta-bar">
        <div className="cta-inner">
          <button
            type="button"
            className="btn primary block"
            onClick={() => openCreate("")}
          >
            새 모임 만들기
          </button>
        </div>
      </div>
    </main>
  );
}

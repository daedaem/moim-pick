"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar from "@/app/components/Calendar";
import { formatKorean, formatShort } from "@/lib/dates";
import { readName, rememberEvent, rememberName } from "@/lib/recent";
import { LIMITS, type EventPayload } from "@/lib/types";

type Tab = "check" | "result";

const cleanName = (value: string) => value.replace(/\s+/g, " ").trim();

export default function EventClient() {
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<EventPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>("check");
  const [name, setName] = useState("");
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const restored = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const apply = useCallback((result: FetchResult) => {
    if (result.ok) {
      setLoadError("");
      setData(result.payload);
    } else {
      // 이미 화면이 떠 있는데 잠깐 연결이 끊긴 경우에는 기존 내용을 그대로 둔다
      setLoadError((prev) => (result.network ? prev || result.error : result.error));
    }
  }, []);

  const load = useCallback(async () => {
    apply(await fetchEvent(id));
  }, [id, apply]);

  // 처음 열 때: 모임을 불러오고, 전에 쓰던 이름과 응답이 있으면 되살린다
  useEffect(() => {
    let cancelled = false;
    fetchEvent(id).then((result) => {
      if (cancelled) return;
      apply(result);
      if (!result.ok || restored.current) return;
      restored.current = true;
      const { event, responses } = result.payload;
      rememberEvent({ id: event.id, title: event.title });
      const saved = readName(event.id);
      if (!saved) return;
      setName(saved);
      const mine = responses.find((r) => r.name === saved);
      if (mine) {
        setUnavailable(new Set(mine.unavailable));
        setTab("result");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id, apply]);

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
  const trimmedName = cleanName(name);
  const existing = responses.find((r) => r.name === trimmedName);

  const ranking = useMemo(() => {
    return dates
      .map((date) => ({
        date,
        missing: responses.filter((r) => r.unavailable.includes(date)).map((r) => r.name),
      }))
      .sort((a, b) => a.missing.length - b.missing.length || a.date.localeCompare(b.date));
  }, [dates, responses]);

  const missingMap = useMemo(
    () => new Map(ranking.map((row) => [row.date, row.missing.length])),
    [ranking],
  );
  const perfect = ranking.filter((row) => row.missing.length === 0);
  const nextBest = ranking.filter((row) => row.missing.length > 0).slice(0, 5);

  function toggle(date: string) {
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    setDirty(true);
    setFormError("");
  }

  function setAll(no: boolean) {
    setUnavailable(no ? new Set(dates) : new Set());
    setDirty(true);
  }

  function editAs(target: string) {
    const found = responses.find((r) => r.name === target);
    setName(target);
    setUnavailable(new Set(found?.unavailable ?? []));
    setDirty(false);
    setFormError("");
    setTab("check");
    window.scrollTo({ top: 0 });
  }

  async function save() {
    if (saving || !event) return;
    if (!trimmedName) {
      setFormError("이름을 먼저 입력해 주세요.");
      document.getElementById("name-input")?.focus();
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const res = await fetch(`/api/events/${event.id}/responses`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, unavailable: [...unavailable] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(body.error ?? "저장하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      rememberName(event.id, trimmedName);
      setName(trimmedName);
      setDirty(false);
      await load();
      setTab("result");
      window.scrollTo({ top: 0 });
      showToast("저장했어요");
    } catch {
      setFormError("연결이 끊겼어요. 인터넷 상태를 확인하고 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function removeMine() {
    if (saving || !event || !existing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}/responses`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: existing.name }),
      });
      if (!res.ok) {
        setFormError("지우지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setUnavailable(new Set());
      setDirty(false);
      await load();
      showToast("응답을 지웠어요");
    } catch {
      setFormError("연결이 끊겼어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    if (!event) return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      showToast("링크를 복사했어요");
    } catch {
      // 클립보드를 못 쓰는 브라우저: 주소를 직접 보여 준다
      showToast(url);
    }
  }

  if (!event) {
    return (
      <main className="page">
        <p className="brand">
          <Link href="/">모임픽</Link>
        </p>
        {loadError ? (
          <div className="card empty">
            <p className="empty-title">{loadError}</p>
            <Link className="btn ghost" href="/">
              새 모임 만들기
            </Link>
          </div>
        ) : (
          <p className="status">모임을 불러오는 중…</p>
        )}
      </main>
    );
  }

  const okCount = dates.length - unavailable.size;

  return (
    <main className={`page${tab === "check" ? " with-bar" : ""}`}>
      <p className="brand">
        <Link href="/">모임픽</Link>
      </p>

      <header className="event-head">
        <h1 className="event-title">{event.title}</h1>
        {event.memo && <p className="event-memo">{event.memo}</p>}
        <p className="event-range">
          {formatShort(dates[0])}부터 {formatShort(dates[dates.length - 1])}까지 후보 {dates.length}일
        </p>
        <button type="button" className="btn ghost small" onClick={share}>
          링크 복사
        </button>
      </header>

      <div className="tabs" role="tablist" aria-label="보기 전환">
        <button
          type="button"
          role="tab"
          id="tab-check"
          aria-selected={tab === "check"}
          aria-controls="panel-check"
          className={`tab${tab === "check" ? " on" : ""}`}
          onClick={() => setTab("check")}
        >
          내 일정 표시
        </button>
        <button
          type="button"
          role="tab"
          id="tab-result"
          aria-selected={tab === "result"}
          aria-controls="panel-result"
          className={`tab${tab === "result" ? " on" : ""}`}
          onClick={() => setTab("result")}
        >
          결과 {responses.length > 0 && <span className="tab-count">{responses.length}명</span>}
        </button>
      </div>

      {tab === "check" ? (
        <section id="panel-check" role="tabpanel" aria-labelledby="tab-check">
          <label className="field">
            <span className="field-label">이름</span>
            <input
              id="name-input"
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFormError("");
                // 이미 응답한 이름을 입력하면 (아직 손대지 않은 경우에만) 그 응답을 불러온다
                const match = responses.find((r) => r.name === cleanName(e.target.value));
                if (match && !dirty) setUnavailable(new Set(match.unavailable));
              }}
              placeholder="예: 홍길동"
              maxLength={LIMITS.nameMax}
              autoComplete="name"
              enterKeyHint="done"
            />
          </label>

          {existing && !dirty && (
            <p className="hint">
              이 이름으로 저장된 응답을 보고 있어요. 고친 뒤 다시 저장하면 바뀌어요.
            </p>
          )}
          {existing && dirty && !sameSet(existing.unavailable, unavailable) && (
            <p className="hint">저장하면 &lsquo;{existing.name}&rsquo; 응답이 지금 표시한 대로 바뀌어요.</p>
          )}

          <p className="guide">안 되는 날을 눌러 줄을 그어 주세요. 다시 누르면 지워져요.</p>
          <div className="quick">
            <button type="button" className="btn ghost small" onClick={() => setAll(false)}>
              전부 되는 날로
            </button>
            <button type="button" className="btn ghost small" onClick={() => setAll(true)}>
              전부 안 되는 날로
            </button>
          </div>

          <Calendar mode="check" dates={dates} unavailable={unavailable} onToggle={toggle} />

          {existing && (
            <button type="button" className="link-danger" onClick={removeMine} disabled={saving}>
              &lsquo;{existing.name}&rsquo; 응답 지우기
            </button>
          )}

          <div className="save-bar">
            <div className="save-inner">
              <p className="save-summary" aria-live="polite">
                {formError ? (
                  <span className="error-inline" role="alert">
                    {formError}
                  </span>
                ) : (
                  <>
                    되는 날 <strong>{okCount}</strong>일, 안 되는 날 <strong>{unavailable.size}</strong>일
                  </>
                )}
              </p>
              <button type="button" className="btn primary" onClick={save} disabled={saving}>
                {saving ? "저장 중…" : "저장"}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section id="panel-result" role="tabpanel" aria-labelledby="tab-result">
          {responses.length === 0 ? (
            <div className="card empty">
              <p className="empty-title">아직 응답한 사람이 없어요</p>
              <p className="empty-body">링크를 단톡방에 보내고, 내 일정부터 표시해 보세요.</p>
              <div className="empty-actions">
                <button type="button" className="btn primary" onClick={() => setTab("check")}>
                  내 일정 표시
                </button>
                <button type="button" className="btn ghost" onClick={share}>
                  링크 복사
                </button>
              </div>
            </div>
          ) : (
            <>
              <section className="block">
                <h2 className="section-title">
                  {responses.length}명 모두 되는 날
                  {perfect.length > 0 && <span className="count">{perfect.length}일</span>}
                </h2>
                {perfect.length > 0 ? (
                  <ul className="perfect-list">
                    {perfect.map((row) => (
                      <li key={row.date}>
                        <span className="hl">{formatKorean(row.date)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="none">모두 되는 날이 없어요. 아래에서 빠지는 사람이 가장 적은 날을 확인해 보세요.</p>
                )}
              </section>

              {nextBest.length > 0 && (
                <section className="block">
                  <h2 className="section-title">
                    {perfect.length > 0 ? "그다음으로 많이 되는 날" : "가장 많이 되는 날"}
                  </h2>
                  <ol className="rank-list">
                    {nextBest.map((row) => (
                      <li key={row.date}>
                        <span className="rank-date">{formatKorean(row.date)}</span>
                        <span className="rank-count">
                          {responses.length - row.missing.length}명 가능
                        </span>
                        <span className="rank-missing">안 되는 사람: {row.missing.join(", ")}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              <section className="block">
                <h2 className="section-title">달력으로 보기</h2>
                <Calendar mode="result" dates={dates} missing={missingMap} total={responses.length} />
              </section>

              <section className="block">
                <h2 className="section-title">
                  응답한 사람<span className="count">{responses.length}명</span>
                </h2>
                <p className="guide">이름을 누르면 그 응답을 고칠 수 있어요.</p>
                <ul className="people">
                  {responses.map((r) => (
                    <li key={r.name}>
                      <button type="button" className="person" onClick={() => editAs(r.name)}>
                        {r.name}
                        <span className="person-meta">
                          {r.unavailable.length === 0 ? "다 됨" : `${r.unavailable.length}일 불가`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </section>
      )}

      <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}

type FetchResult =
  | { ok: true; payload: EventPayload }
  | { ok: false; error: string; network: boolean };

async function fetchEvent(id: string): Promise<FetchResult> {
  try {
    const res = await fetch(`/api/events/${id}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: body.error ?? "모임을 불러오지 못했어요.", network: false };
    }
    return { ok: true, payload: body as EventPayload };
  } catch {
    return { ok: false, error: "연결이 끊겼어요. 인터넷 상태를 확인해 주세요.", network: true };
  }
}

function sameSet(list: string[], set: Set<string>) {
  return list.length === set.size && list.every((d) => set.has(d));
}

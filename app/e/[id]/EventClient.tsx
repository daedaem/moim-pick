"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Calendar from "@/app/components/Calendar";
import StationPicker from "@/app/components/StationPicker";
import { formatKorean, formatShort } from "@/lib/dates";
import {
  forgetEvent,
  readAdminToken,
  readName,
  readEditToken,
  readStation,
  rememberAdminToken,
  rememberEditToken,
  rememberEvent,
  rememberName,
  rememberStation,
} from "@/lib/recent";
import { recommendMeetingPoints, stationLabel } from "@/lib/stations";
import { LIMITS, RELATIONS, type EventPayload } from "@/lib/types";

type View = "loading" | "name" | "relation" | "station" | "dates" | "result";

const STEPS: View[] = ["name", "relation", "station", "dates"];

const cleanName = (value: string) => value.replace(/\s+/g, " ").trim();

export default function EventClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<EventPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>("loading");
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [station, setStation] = useState("");
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState("");
  const [confirming, setConfirming] = useState(""); // "event" 또는 지우려는 사람 이름
  const restored = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }, []);

  const go = useCallback((next: View) => {
    setView(next);
    setFormError("");
    setConfirming("");
    window.scrollTo({ top: 0 });
  }, []);

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
    fetchEvent(id).then((result) => {
      if (cancelled) return;
      apply(result);
      if (!result.ok || restored.current) return;
      restored.current = true;
      const { event, responses } = result.payload;
      rememberEvent({ id: event.id, title: event.title });

      // 관리 링크(#admin=토큰)로 들어왔으면 이 기기에 기억해 두고 주소에서는 지운다
      const fromHash = /^#admin=([0-9a-f]{20,})$/.exec(
        window.location.hash,
      )?.[1];
      if (fromHash) {
        rememberAdminToken(event.id, fromHash);
        window.history.replaceState(null, "", window.location.pathname);
      }
      setAdminToken(fromHash ?? readAdminToken(event.id));

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
        setView("result");
      } else {
        // 다른 모임에서 골랐던 출발역은 다시 묻지 않는다
        setStation(readStation());
        setView("name");
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
        missing: responses
          .filter((r) => r.unavailable.includes(date))
          .map((r) => r.name),
      }))
      .sort(
        (a, b) =>
          a.missing.length - b.missing.length || a.date.localeCompare(b.date),
      );
  }, [dates, responses]);

  const missingMap = useMemo(
    () => new Map(ranking.map((row) => [row.date, row.missing.length])),
    [ranking],
  );
  const perfectCount = ranking.filter((row) => row.missing.length === 0).length;
  const withStation = responses.filter((r) => r.station).length;

  // 결과 화면에서 보고 있는 날짜 (고르지 않았으면 가장 많이 되는 날)
  const focusDate =
    picked && dates.includes(picked) ? picked : (ranking[0]?.date ?? null);
  const focus = ranking.find((row) => row.date === focusDate) ?? null;
  const meeting = useMemo(() => {
    if (!focusDate) return [];
    const origins = responses
      .filter((r) => r.station && !r.unavailable.includes(focusDate))
      .map((r) => r.station);
    return recommendMeetingPoints(origins);
  }, [focusDate, responses]);

  function toggle(date: string) {
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    setFormError("");
  }

  function startEdit(target: string) {
    const found = responses.find((r) => r.name === target);
    setName(target);
    setRelation(found?.relation ?? "");
    setStation(found?.station ?? "");
    setUnavailable(new Set(found?.unavailable ?? []));
    // 관계를 아직 안 적은 예전 응답은 관계부터 묻는다
    go(found && !found.relation ? "relation" : "dates");
  }

  /** 이 기기에서 그 응답을 고칠 수 있는지: 응답한 기기이거나 주최자 */
  const canEdit = (target: string) =>
    Boolean(adminToken || (event && readEditToken(event.id, target)));

  const authHeaders = (target: string): Record<string, string> => ({
    "Content-Type": "application/json",
    "x-edit-token": event ? readEditToken(event.id, target) : "",
    "x-admin-token": adminToken,
  });

  function submitName() {
    if (!trimmedName) {
      setFormError("이름을 입력해 주세요.");
      return;
    }
    if (existing && !canEdit(existing.name)) {
      setFormError(
        "이미 같은 이름으로 응답한 사람이 있어요. 다른 사람이라면 이름을 조금 다르게 적어 주세요.",
      );
      return;
    }
    setName(trimmedName);
    if (existing) {
      // 이미 응답한 이름이면 그 응답을 이어서 고친다
      setRelation(existing.relation);
      setStation(existing.station);
      setUnavailable(new Set(existing.unavailable));
    }
    go("relation");
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
          unavailable: [...unavailable],
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
      await load();
      setPicked(null);
      go("result");
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
      go("result");
      showToast(`${target}님 응답을 지웠어요`);
    } catch {
      showToast("연결이 끊겼어요. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function setConfirmed(next: { date: string; station: string } | null) {
    if (saving || !event) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": adminToken,
        },
        body: JSON.stringify({ confirmed: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(body.error ?? "확정하지 못했어요.");
        return;
      }
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
        headers: { "x-admin-token": adminToken },
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

  const shareLink = () =>
    copy(
      window.location.origin + window.location.pathname,
      "링크를 복사했어요",
    );
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
              새 모임 만들기
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

  // ---------- 입력 단계 ----------
  if (view !== "result") {
    const stepIndex = STEPS.indexOf(view);
    const back = () =>
      stepIndex === 0 ? go("result") : go(STEPS[stepIndex - 1]);
    const okCount = dates.length - unavailable.size;

    return (
      <main className="page with-cta">
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
          </>
        )}

        {view === "relation" && (
          <>
            <h1 className="question">
              {trimmedName}님은 주최자와
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
                      go("station");
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
            <p className="lead">다 괜찮으면 그대로 저장하면 돼요.</p>
            <div className="quick">
              <button
                type="button"
                className="btn soft small"
                onClick={() => setUnavailable(new Set())}
              >
                전부 되는 날로
              </button>
              <button
                type="button"
                className="btn soft small"
                onClick={() => setUnavailable(new Set(dates))}
              >
                전부 안 되는 날로
              </button>
            </div>
            <div className="card">
              <Calendar
                mode="check"
                dates={dates}
                unavailable={unavailable}
                onToggle={toggle}
              />
            </div>
            {existing &&
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
            {view === "dates" && !formError && (
              <p className="cta-note" aria-live="polite">
                되는 날 <strong>{okCount}</strong>일, 안 되는 날{" "}
                <strong>{unavailable.size}</strong>일
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
  const total = responses.length;
  const mine = responses.find(
    (r) => r.name === trimmedName && readEditToken(event.id, r.name),
  );
  const confirmed =
    event.confirmed && dates.includes(event.confirmed.date)
      ? event.confirmed
      : null;
  const notice = confirmed
    ? `[${event.title}] ${formatKorean(confirmed.date)}${confirmed.station ? ` ${stationLabel(confirmed.station)}` : ""}에서 만나요!${event.memo ? ` (${event.memo})` : ""}`
    : "";
  const best = ranking[0];

  return (
    <main className="page with-cta">
      <p className="brand">
        <Link href="/">모임픽</Link>
      </p>

      <header className="event-head">
        <h1 className="headline">{event.title}</h1>
        {event.memo && <p className="event-memo">{event.memo}</p>}
        <p className="event-range">
          {formatShort(dates[0])}부터 {formatShort(dates[dates.length - 1])}까지
        </p>
      </header>

      {confirmed && (
        <div className="summary good confirmed">
          <p className="summary-sub">확정했어요</p>
          <p className="summary-main">
            {formatKorean(confirmed.date)}
            {confirmed.station && `, ${stationLabel(confirmed.station)}`}
          </p>
          <button
            type="button"
            className="btn white small"
            onClick={() => copy(notice, "공지 문구를 복사했어요")}
          >
            공지 문구 복사
          </button>
        </div>
      )}

      <div
        className={`summary${!confirmed && total > 0 && perfectCount > 0 ? " good" : ""}`}
        hidden={Boolean(confirmed)}
      >
        {total === 0 ? (
          <>
            <p className="summary-main">아직 응답한 사람이 없어요</p>
            <p className="summary-sub">
              링크를 보내고, 내 일정부터 표시해 보세요.
            </p>
          </>
        ) : perfectCount > 0 ? (
          <>
            <p className="summary-main">
              {total}명 모두 되는 날이 {perfectCount}일 있어요
            </p>
            <p className="summary-sub">달력에서 파란 날을 눌러 보세요.</p>
          </>
        ) : (
          <>
            <p className="summary-main">모두 되는 날은 아직 없어요</p>
            <p className="summary-sub">
              가장 많이 되는 날은 {formatKorean(best.date)},{" "}
              {total - best.missing.length}명이 돼요.
            </p>
          </>
        )}
      </div>

      <div className="card">
        <Calendar
          mode="result"
          dates={dates}
          missing={missingMap}
          total={total}
          selected={total > 0 ? focusDate : null}
          onSelect={setPicked}
        />
        {total > 0 && (
          <p className="legend">
            <span className="legend-dot" aria-hidden="true" />
            모두 되는 날
          </p>
        )}
      </div>

      {total > 0 && focus && (
        <section className="card detail" aria-live="polite">
          <h2 className="detail-date">{formatKorean(focus.date)}</h2>
          <p className="detail-count">
            {focus.missing.length === 0
              ? `${total}명 모두 돼요`
              : `${total}명 중 ${total - focus.missing.length}명이 돼요`}
          </p>
          {focus.missing.length > 0 && (
            <dl className="facts">
              <dt>안 되는 사람</dt>
              <dd>{focus.missing.join(", ")}</dd>
            </dl>
          )}
          {meeting.length > 0 ? (
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
          ) : (
            <p className="facts-empty">
              출발역을 적은 사람이 있으면 모이기 좋은 역을 추천해요.
            </p>
          )}
          {meeting.length > 0 && (
            <p className="fineprint">
              출발역을 적은 {withStation}명 중 이날 되는 사람들의 정거장 수로
              골랐어요. 환승 시간은 반영하지 않았어요.
            </p>
          )}
          {adminToken &&
            (confirmed?.date === focus.date ? (
              <button
                type="button"
                className="btn soft block confirm-btn"
                onClick={() => setConfirmed(null)}
                disabled={saving}
              >
                확정 취소
              </button>
            ) : (
              <button
                type="button"
                className="btn primary block confirm-btn"
                onClick={() =>
                  setConfirmed({
                    date: focus.date,
                    station: meeting[0]?.name ?? "",
                  })
                }
                disabled={saving}
              >
                {meeting[0]
                  ? `이 날, ${stationLabel(meeting[0].name)}으로 확정하기`
                  : "이 날로 확정하기"}
              </button>
            ))}
        </section>
      )}

      {total > 0 && (
        <section className="section">
          <h2 className="section-title">
            응답한 사람 <span className="count">{total}명</span>
          </h2>
          <ul className="card list">
            {responses.map((r) => (
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
                  {r.unavailable.length === 0
                    ? "다 돼요"
                    : `${r.unavailable.length}일 불가`}
                </span>
                {adminToken &&
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
            ))}
          </ul>
          <p className="fineprint">
            {adminToken
              ? "주최자는 이름을 눌러 누구의 응답이든 고칠 수 있어요."
              : "내 응답은 응답했던 기기에서만 고칠 수 있어요."}
          </p>
        </section>
      )}

      {adminToken && (
        <section className="section">
          <h2 className="section-title">모임 관리</h2>
          <div className="card manage">
            <p className="manage-note">
              이 기기에서 만든 모임이라 관리할 수 있어요. 다른 기기에서도
              관리하려면 관리 링크를 보관해 두세요.
            </p>
            <button
              type="button"
              className="btn soft block"
              onClick={copyAdminLink}
            >
              관리 링크 복사
            </button>
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
        <div className="cta-inner two">
          <button type="button" className="btn soft" onClick={shareLink}>
            링크 복사
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
      {toastNode}
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

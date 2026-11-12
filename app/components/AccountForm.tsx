"use client";

import { useState, type FormEvent } from "react";
import { readHostToken, rememberLogin } from "@/lib/recent";

type Props = {
  /** 처음 보여 줄 쪽 */
  initialMode: "login" | "signup";
  onDone: (accountId: string, mode: "login" | "signup") => void;
};

/** 모임장 계정 로그인 / 만들기 (실명 + 숫자 4자리) */
export default function AccountForm({ initialMode, onDone }: Props) {
  const [mode, setMode] = useState(initialMode);
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^[가-힣]{2,5}$/.test(id.replace(/\s+/g, "")))
      return setError("이름은 한글 실명으로 2~5자만 쓸 수 있어요.");
    if (!/^\d{4}$/.test(pin)) return setError("비밀번호는 숫자 4자리예요.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        mode === "login" ? "/api/account/login" : "/api/account",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // 이 기기에서 계정 없이 쓰던 모임장 정보가 있으면 계정으로 합쳐진다
            "x-host-token": readHostToken(),
          },
          body: JSON.stringify({ id, pin }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "잠시 뒤 다시 시도해 주세요.");
        return;
      }
      rememberLogin(body.token, body.id);
      setPin("");
      onDone(body.id, mode);
    } catch {
      setError("연결이 끊겼어요. 인터넷 상태를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card account" onSubmit={submit} noValidate>
      <div className="segmented two">
        <button
          type="button"
          className={`segment${mode === "login" ? " on" : ""}`}
          aria-pressed={mode === "login"}
          onClick={() => {
            setMode("login");
            setError("");
          }}
        >
          로그인
        </button>
        <button
          type="button"
          className={`segment${mode === "signup" ? " on" : ""}`}
          aria-pressed={mode === "signup"}
          onClick={() => {
            setMode("signup");
            setError("");
          }}
        >
          계정 만들기
        </button>
      </div>

      <label className="field">
        <span className="field-label">이름 (실명)</span>
        <input
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="예: 홍길동"
          maxLength={8}
          autoComplete="name"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span className="field-label">비밀번호</span>
        <input
          className="input pin"
          type="password"
          value={pin}
          onChange={(e) =>
            setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
          }
          placeholder="숫자 4자리"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn primary block" disabled={busy}>
        {busy ? "확인 중…" : mode === "login" ? "로그인" : "계정 만들기"}
      </button>

      <p className="fineprint">
        {mode === "login"
          ? "5번 틀리면 15분 동안 잠겨요."
          : "이 기기에 적어 둔 모임장 일정과 만든 모임은 그대로 이 계정으로 옮겨져요."}
      </p>
    </form>
  );
}

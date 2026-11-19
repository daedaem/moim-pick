"use client";

import { useState, type FormEvent } from "react";
import { readHostToken, rememberLogin } from "@/lib/recent";

type Props = {
  /** 처음 보여 줄 쪽 */
  initialMode: "login" | "signup";
  onDone: (accountId: string, mode: "login" | "signup") => void;
};

/** 로그인 / 회원가입 (아이디 + 이름(실명) + 숫자 4자리) */
export default function AccountForm({ initialMode, onDone }: Props) {
  const [mode, setMode] = useState(initialMode);
  const [id, setId] = useState("");
  const [name, setName] = useState(""); // 회원가입 때만: 모임원에게 보이는 실명
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!/^[가-힣a-zA-Z0-9_]{2,12}$/.test(id.replace(/\s+/g, "")))
      return setError("아이디는 한글·영문·숫자 2~12자예요.");
    if (mode === "signup" && !/^[가-힣]{2,5}$/.test(name.replace(/\s+/g, "")))
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
          body: JSON.stringify(
            mode === "login" ? { id, pin } : { id, name, pin },
          ),
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
          회원가입
        </button>
      </div>

      <label className="field">
        <span className="field-label">아이디</span>
        <input
          className="input"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={mode === "login" ? "아이디" : "예: haesung, 해성91"}
          maxLength={12}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />
      </label>

      {mode === "signup" && (
        <label className="field">
          <span className="field-label">이름 (실명)</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 홍길동"
            maxLength={8}
            autoComplete="name"
            spellCheck={false}
          />
        </label>
      )}

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
        {busy ? "확인 중…" : mode === "login" ? "로그인" : "회원가입"}
      </button>

      <p className="fineprint">
        {mode === "login"
          ? "예전에 이름으로 가입했다면 그 이름이 아이디예요. 5번 틀리면 15분 동안 잠겨요."
          : "아이디는 로그인할 때만 쓰고 다른 사람과 겹치면 안 돼요. 이름은 모임원에게 보이고, 같은 이름이 있어도 괜찮아요."}
      </p>
    </form>
  );
}

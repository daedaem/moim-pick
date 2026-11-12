"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import AccountForm from "@/app/components/AccountForm";
import { readAccountId } from "@/lib/recent";

const subscribeNever = () => () => {};
const readJoin = () => window.location.search.includes("join=1");

/** 로그인 / 회원가입 화면 */
export default function LoginPage() {
  const router = useRouter();
  const account = useSyncExternalStore(subscribeNever, readAccountId, () => "");
  const ready = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const join = useSyncExternalStore(subscribeNever, readJoin, () => false);

  return (
    <main className="page">
      <div className="step-top">
        <Link className="back" href="/">
          모임 찾기
        </Link>
      </div>

      <h1 className="question">{join ? "회원가입" : "로그인"}</h1>
      <p className="lead">
        모임을 만들고 날짜를 확정하는 분만 가입하면 돼요. 초대받아 날짜만 고르는
        분은 가입하지 않아도 돼요.
      </p>

      {!ready ? (
        <p className="status">불러오는 중…</p>
      ) : account ? (
        <div className="card notice-card">
          <p className="notice-title">{account} 님으로 로그인했어요</p>
          <Link className="btn primary block" href="/host">
            내 일정과 모임 보기
          </Link>
        </div>
      ) : (
        <div className="stack-gap">
          <AccountForm
            initialMode={join ? "signup" : "login"}
            onDone={() => router.replace("/host")}
          />
        </div>
      )}
    </main>
  );
}

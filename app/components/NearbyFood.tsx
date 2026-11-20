"use client";

import { useState } from "react";
import { FOODS } from "@/lib/places";

/** 메뉴 고르기. "전체"는 그냥 맛집으로 찾는다 */
const MENUS = ["전체", ...FOODS];

/**
 * 모일 역 근처 맛집을 메뉴별로 지도 앱에서 바로 연다.
 * 순위는 지도 앱(네이버 지도·카카오맵)의 검색 순위를 그대로 쓴다.
 * (모임픽이 직접 순위를 매기려면 지도 회사의 검색 API 키가 필요하다)
 */
export default function NearbyFood({
  station,
  title = "근처 맛집 찾기",
  initialMenu = "전체",
  menuNote = "",
}: {
  /** 역 이름, 예: "강남역" */
  station: string;
  title?: string;
  /** 처음 골라 둘 메뉴 (응답자들이 가장 많이 고른 음식) */
  initialMenu?: string;
  menuNote?: string;
}) {
  const [menu, setMenu] = useState(initialMenu);
  // 지도 검색이 잘 되는 말로 바꾼다 (예: "회·일식" → "일식")
  const word = menu === "회·일식" ? "일식" : menu;
  const query = `${station} ${menu === "전체" ? "맛집" : `${word} 맛집`}`;
  const q = encodeURIComponent(query);

  return (
    <div className="food">
      <p className="food-title">
        {title} <span className="food-station">{station}</span>
      </p>
      {menuNote && <p className="food-note">{menuNote}</p>}
      <div className="chips food-menus" role="group" aria-label="메뉴">
        {MENUS.map((item) => (
          <button
            key={item}
            type="button"
            className={`chip small${menu === item ? " on" : ""}`}
            aria-pressed={menu === item}
            onClick={() => setMenu(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="btn-row">
        <a
          className="btn soft"
          href={`https://map.naver.com/p/search/${q}`}
          target="_blank"
          rel="noreferrer"
        >
          네이버 지도
        </a>
        <a
          className="btn soft"
          href={`https://map.kakao.com/link/search/${q}`}
          target="_blank"
          rel="noreferrer"
        >
          카카오맵
        </a>
      </div>
      <p className="food-note">
        &lsquo;{query}&rsquo; 검색 결과를 지도 앱의 인기순으로 보여 줘요.
      </p>
    </div>
  );
}

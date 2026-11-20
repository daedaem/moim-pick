// 서버 기능 테스트: 계정, 모임, 응답, 권한, 확정, 자동 새로고침 번호
// 실행: npm test  (서버를 띄우지 않고 라우트 함수를 직접 부른다. 저장소는 메모리)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPin, newSalt } from "@/lib/account";
import { getStore } from "@/lib/store";
import {
  DELETE as deleteAccount,
  POST as signup,
} from "@/app/api/account/route";
import { POST as login } from "@/app/api/account/login/route";
import { POST as logout } from "@/app/api/account/logout/route";
import { GET as adminEvents } from "@/app/api/admin/events/route";
import {
  GET as searchEvents,
  POST as createEvent,
} from "@/app/api/events/route";
import {
  DELETE as removeEvent,
  GET as getEvent,
  PATCH as patchEvent,
} from "@/app/api/events/[id]/route";
import {
  DELETE as removeResponse,
  PUT as putResponse,
} from "@/app/api/events/[id]/responses/route";
import { GET as getVersion } from "@/app/api/events/[id]/version/route";
import { GET as getHost, PUT as putHost } from "@/app/api/host/route";
import { call, daysFromNow, device, signupAs } from "./helpers";

const host = (token: string) => ({ "x-host-token": token });

/** 다음 주 월~금을 후보로 하는 모임 */
function eventBody(title: string, extra: Record<string, unknown> = {}) {
  return {
    title,
    memo: "",
    start: daysFromNow(7),
    end: daysFromNow(13),
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    slots: ["L", "D"],
    ...extra,
  };
}

async function newEvent(token: string, title: string, extra = {}) {
  const res = await call(createEvent, {
    method: "POST",
    body: eventBody(title, extra),
    headers: host(token),
  });
  assert.equal(res.status, 201, res.body.error);
  return res.body as {
    event: { id: string; dates: string[] };
    adminToken: string;
  };
}

describe("계정", () => {
  it("아이디 + 이름(실명) + 숫자 4자리로 가입하고, 아이디로 로그인한다", async () => {
    const res = await call(signup, {
      method: "POST",
      body: { id: "Tester_One", name: "김하나", pin: "1357" },
      headers: host(device()),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.id, "김하나");
    assert.equal(res.body.loginId, "tester_one");

    const again = await call(login, {
      method: "POST",
      body: { id: "TESTER_ONE", pin: "1357" },
      headers: host(device()),
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.id, "김하나");
  });

  it("같은 아이디는 막고, 같은 이름은 허용한다", async () => {
    await signupAs(signup, "dup_id", "이둘", "1111");
    const sameId = await call(signup, {
      method: "POST",
      body: { id: "DUP_ID", name: "박셋", pin: "2222" },
      headers: host(device()),
    });
    assert.equal(sameId.status, 409);
    await signupAs(signup, "dup_id2", "이둘", "1111"); // 같은 이름·같은 숫자도 아이디가 다르면 된다
  });

  it("잘못된 아이디·이름·숫자는 거절한다", async () => {
    const bad = [
      { id: "a", name: "홍길동", pin: "1234" },
      { id: "admin_1", name: "홍길동", pin: "1234" },
      { id: "관리자해성", name: "홍길동", pin: "1234" },
      { id: "ok_id", name: "hong", pin: "1234" },
      { id: "ok_id", name: "홍길동", pin: "12a4" },
      { id: "ok_id", name: "홍길동", pin: "12345" },
    ];
    for (const body of bad) {
      const res = await call(signup, {
        method: "POST",
        body,
        headers: host(device()),
      });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  it("예전 방식 계정(이름이 곧 아이디)과 동명이인 계정도 로그인된다", async () => {
    const store = getStore();
    const make = async (id: string, pin: string, hostHash: string) => {
      const salt = newSalt();
      await store.createAccount({
        id,
        salt,
        pinHash: await hashPin(pin, salt),
        hostHash,
        createdAt: 1,
      });
      await store.setHostAccount(hostHash, id);
    };
    await make("최예전", "0001", "1".repeat(64));
    await make("최예전#ab12", "0002", "2".repeat(64));
    await store.setNameAccount("최예전", "최예전#ab12", true);

    const first = await call(login, {
      method: "POST",
      body: { id: "최예전", pin: "0001" },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.loginId, "최예전");
    const second = await call(login, {
      method: "POST",
      body: { id: "최예전", pin: "0002" },
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.id, "최예전"); // 꼬리표 없이 이름만 보인다
    assert.equal(second.body.loginId, "최예전#ab12");
  });

  it("관리자는 계정 아이디로만 인정한다 (같은 이름으로 가입해도 관리자가 아니다)", async () => {
    const admin = await signupAs(signup, "조해성", "조해성", "9753");
    const fake = await signupAs(signup, "haesung_fake", "조해성", "9753");
    assert.equal(
      (await call(getHost, { headers: host(admin) })).body.siteAdmin,
      true,
    );
    assert.equal(
      (await call(getHost, { headers: host(fake) })).body.siteAdmin,
      false,
    );
    assert.equal(
      (await call(adminEvents, { headers: host(fake) })).status,
      403,
    );
    assert.equal(
      (await call(adminEvents, { headers: host(admin) })).status,
      200,
    );
    // 관리자 계정은 지울 수 없다 (지우면 같은 아이디로 누구나 관리자가 될 수 있다)
    const del = await call(deleteAccount, {
      method: "DELETE",
      body: { pin: "9753" },
      headers: host(admin),
    });
    assert.equal(del.status, 403);
  });

  it("숫자를 5번 틀리면 맞는 숫자도 잠시 받지 않는다", async () => {
    await signupAs(signup, "lock_me", "잠금", "4444");
    for (let i = 0; i < 5; i++) {
      await call(login, {
        method: "POST",
        body: { id: "lock_me", pin: "0000" },
      });
    }
    const res = await call(login, {
      method: "POST",
      body: { id: "lock_me", pin: "4444" },
    });
    assert.equal(res.status, 429);
  });

  it("로그아웃하면 그 세션으로는 모임을 만들 수 없다", async () => {
    const token = await signupAs(signup, "bye_user", "안녕", "5555");
    await call(logout, { method: "POST", headers: host(token) });
    const res = await call(createEvent, {
      method: "POST",
      body: eventBody("로그아웃 뒤"),
      headers: host(token),
    });
    assert.equal(res.status, 401);
  });

  it("계정을 지우면 내 모임도 지워지고 아이디를 다시 쓸 수 있다", async () => {
    const token = await signupAs(signup, "leave_me", "떠남", "6666");
    const { event } = await newEvent(token, "떠날 모임");
    const wrong = await call(deleteAccount, {
      method: "DELETE",
      body: { pin: "0000" },
      headers: host(token),
    });
    assert.equal(wrong.status, 401);
    const ok = await call(deleteAccount, {
      method: "DELETE",
      body: { pin: "6666" },
      headers: host(token),
    });
    assert.equal(ok.status, 200);
    assert.equal((await call(getEvent, { id: event.id })).status, 404);
    await signupAs(signup, "leave_me", "새사람", "7777");
  });
});

describe("모임", () => {
  it("로그인해야 만들 수 있고, 지난 기간·잘못된 값은 거절한다", async () => {
    assert.equal(
      (await call(createEvent, { method: "POST", body: eventBody("익명") }))
        .status,
      401,
    );
    const token = await signupAs(signup, "maker_1", "만듦", "1212");
    const cases = [
      eventBody("지난 모임", { start: "2020-01-06", end: "2020-01-10" }),
      eventBody("너무 긴 모임", { end: daysFromNow(200) }),
      eventBody("   "),
      eventBody("인원 1명", { expected: 1 }),
    ];
    for (const body of cases) {
      const res = await call(createEvent, {
        method: "POST",
        body,
        headers: host(token),
      });
      assert.equal(res.status, 400, String(body.title));
    }
  });

  it("검색은 허용한 모임만 나오고, 기본값은 비공개다", async () => {
    const token = await signupAs(signup, "maker_2", "검색", "1313");
    await newEvent(token, "공개검색시험", { searchable: true });
    await newEvent(token, "비공개검색시험", { searchable: false });
    const open = await call(searchEvents, {
      query: `?q=${encodeURIComponent("공개검색시험")}`,
    });
    assert.deepEqual(
      open.body.events.map((e: { title: string }) => e.title),
      ["공개검색시험"],
    );
  });

  it("모임장·관리자만 관리할 수 있다", async () => {
    const owner = await signupAs(signup, "owner_a", "주인", "2323");
    const other = await signupAs(signup, "other_b", "남남", "2424");
    const { event } = await newEvent(owner, "권한 시험");
    const get = (token?: string) =>
      call(getEvent, { id: event.id, headers: token ? host(token) : {} });
    assert.equal((await get()).body.canManage, false);
    assert.equal((await get(other)).body.canManage, false);
    assert.equal((await get(owner)).body.canManage, true);
    assert.equal((await get(owner)).body.hostName, "주인");

    const renameByOther = await call(patchEvent, {
      method: "PATCH",
      id: event.id,
      body: { title: "남이 바꿈" },
      headers: host(other),
    });
    assert.equal(renameByOther.status, 403);
    const deleteByOther = await call(removeEvent, {
      method: "DELETE",
      id: event.id,
      headers: host(other),
    });
    assert.equal(deleteByOther.status, 403);
  });

  it("모임 이름과 예상 인원을 바꿀 수 있다", async () => {
    const token = await signupAs(signup, "renamer", "바꿈", "2525");
    const { event } = await newEvent(token, "옛 이름", { expected: 8 });
    const res = await call(patchEvent, {
      method: "PATCH",
      id: event.id,
      body: { title: "새 이름", expected: null },
      headers: host(token),
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.event.title, "새 이름");
    assert.equal(res.body.event.expected, undefined);
    const bad = await call(patchEvent, {
      method: "PATCH",
      id: event.id,
      body: { expected: 99 },
      headers: host(token),
    });
    assert.equal(bad.status, 400);
  });
});

describe("응답", () => {
  it("한 기기에서 한 번만 응답하고, 같은 이름은 본인 기기에서만 고친다", async () => {
    const token = await signupAs(signup, "resp_host", "응답장", "3434");
    const { event } = await newEvent(token, "응답 시험");
    const [d1, d2] = [device(), device()];
    const key = `${event.dates[0]}:L`;
    const answer = (dev: string, body: Record<string, unknown>, extra = {}) =>
      call(putResponse, {
        method: "PUT",
        id: event.id,
        body: { relation: "친구", station: "", unavailable: [], ...body },
        headers: { "x-device-token": dev, ...extra },
      });

    const first = await answer(d1, {
      name: "민수",
      unavailable: [key, "2099-01-01:L", "x"],
    });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.response.unavailable, [key]); // 모임에 없는 칸은 버린다
    const edit = first.body.editToken as string;

    assert.equal((await answer(d1, { name: "민수2" })).status, 409); // 같은 기기 두 번째 이름
    assert.equal((await answer(d2, { name: "민수" })).status, 409); // 다른 기기에서 같은 이름
    assert.equal(
      (await answer(d1, { name: "민수" }, { "x-edit-token": edit })).status,
      200,
    );
    assert.equal(
      (await answer(d2, { name: "영희", relation: "연인" })).status,
      400,
    );
    assert.equal(
      (await answer(d2, { name: "영희", station: "없는역" })).status,
      400,
    );

    const removeByOther = await call(removeResponse, {
      method: "DELETE",
      id: event.id,
      body: { name: "민수" },
      headers: { "x-device-token": d2 },
    });
    assert.equal(removeByOther.status, 403);
  });

  it("장소는 최대 3곳, 음식은 정해진 목록에서만 받는다", async () => {
    const token = await signupAs(signup, "place_host", "장소장", "8989");
    const { event } = await newEvent(token, "장소 시험");
    const answer = (body: Record<string, unknown>) =>
      call(putResponse, {
        method: "PUT",
        id: event.id,
        body: { relation: "친구", unavailable: [], ...body },
        headers: { "x-device-token": device() },
      });
    const ok = await answer({
      name: "장소많음",
      stations: ["강남", "사당", "강남"],
      foods: ["고기", "피자", "카페"],
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.response.stations, ["강남", "사당"]); // 겹친 역은 하나로
    assert.equal(ok.body.response.station, "강남"); // 예전 화면용 첫 번째 역
    assert.deepEqual(ok.body.response.foods, ["고기", "카페"]); // 목록에 없는 음식은 버린다
    assert.equal(
      (
        await answer({
          name: "너무많음",
          stations: ["강남", "사당", "교대", "잠실"],
        })
      ).status,
      400,
    );
    assert.equal(
      (await answer({ name: "없는역", stations: ["없는역"] })).status,
      400,
    );
    // 예전 화면처럼 station 하나만 보내도 된다
    const legacy = await answer({ name: "예전화면", station: "교대" });
    assert.deepEqual(legacy.body.response.stations, ["교대"]);
  });

  it("'모임장에게만'으로 한 이름은 다른 참여자에게 가려진다", async () => {
    const token = await signupAs(signup, "mask_host", "가림장", "4545");
    const { event } = await newEvent(token, "가림 시험");
    const [secret, viewer] = [device(), device()];
    await call(putResponse, {
      method: "PUT",
      id: event.id,
      body: {
        name: "김민수",
        relation: "친구",
        station: "",
        unavailable: [],
        hidden: true,
      },
      headers: { "x-device-token": secret },
    });
    const names = async (headers: Record<string, string>) =>
      (await call(getEvent, { id: event.id, headers })).body.responses.map(
        (r: { name: string }) => r.name,
      );
    assert.deepEqual(await names({ "x-device-token": viewer }), ["김*수"]);
    assert.deepEqual(await names({ "x-device-token": secret }), ["김민수"]); // 본인
    assert.deepEqual(await names(host(token)), ["김민수"]); // 모임장

    const raw = (await call(getEvent, { id: event.id })).body.responses[0];
    assert.equal("deviceHash" in raw, false);
    assert.equal("editHash" in raw, false);
  });
});

describe("모임장 일정과 확정", () => {
  it("안 되는 시간과 다른 모임 확정일은 고를 수 없고, 화면 번호가 바뀐다", async () => {
    const token = await signupAs(signup, "block_host", "일정장", "5656");
    const a = await newEvent(token, "모임 A");
    const b = await newEvent(token, "모임 B");
    const [day1, day2] = a.event.dates;
    const version = async (id: string) =>
      (await call(getVersion, { id })).body.version as number;

    const v0 = await version(a.event.id);
    await call(putHost, {
      method: "PUT",
      body: { blocks: [`${day1}:L`] },
      headers: host(token),
    });
    assert.ok(
      (await version(a.event.id)) > v0,
      "모임장 일정이 바뀌면 번호가 오른다",
    );
    assert.equal(
      (await call(getEvent, { id: a.event.id })).body.blocked[`${day1}:L`],
      "busy",
    );

    const busy = await call(patchEvent, {
      method: "PATCH",
      id: a.event.id,
      body: { confirmed: { date: day1, slot: "L", station: "" } },
      headers: host(token),
    });
    assert.equal(busy.status, 409);

    const vb = await version(b.event.id);
    const ok = await call(patchEvent, {
      method: "PATCH",
      id: b.event.id,
      body: { confirmed: { date: day2, slot: "D", station: "강남" } },
      headers: host(token),
    });
    assert.equal(ok.status, 200);
    const blockedA = (await call(getEvent, { id: a.event.id })).body.blocked;
    assert.equal(blockedA[`${day2}:L`], "fixed"); // 확정한 날은 하루 전체가 막힌다
    assert.equal(blockedA[`${day2}:D`], "fixed");
    assert.ok((await version(b.event.id)) > vb);

    // 확정 취소하면 풀린다
    await call(patchEvent, {
      method: "PATCH",
      id: b.event.id,
      body: { confirmed: null },
      headers: host(token),
    });
    const after = (await call(getEvent, { id: a.event.id })).body.blocked;
    assert.equal(after[`${day2}:L`], undefined);
  });

  it("응답이 들어오면 화면 번호가 오르고, 지운 모임은 0이 된다", async () => {
    const token = await signupAs(signup, "ver_host", "번호장", "6767");
    const { event } = await newEvent(token, "번호 시험");
    const before = (await call(getVersion, { id: event.id })).body
      .version as number;
    await call(putResponse, {
      method: "PUT",
      id: event.id,
      body: { name: "철수", relation: "친구", station: "", unavailable: [] },
      headers: { "x-device-token": device() },
    });
    const after = (await call(getVersion, { id: event.id })).body
      .version as number;
    assert.ok(after > before);
    await call(removeEvent, {
      method: "DELETE",
      id: event.id,
      headers: host(token),
    });
    assert.equal((await call(getVersion, { id: event.id })).body.version, 0);
  });
});

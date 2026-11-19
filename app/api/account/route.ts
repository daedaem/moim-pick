import {
  fail,
  handleError,
  hostHashOf,
  json,
  newAdminToken,
  readBody,
  sha256,
  tooMany,
} from "@/lib/api";
import {
  accountKeyFor,
  accountsByName,
  displayName,
  FAILS_PER_15_MIN,
  FAILS_PER_DAY,
  hashPin,
  newSalt,
  normalizeAccountId,
  openSession,
  PIN_PATTERN,
} from "@/lib/account";
import { isSiteAdmin } from "@/lib/admin";
import { getStore } from "@/lib/store";
import type { HostAccount } from "@/lib/types";

// 모임장 계정 만들기 (이름 + 숫자 4자리). 같은 이름이 있어도 숫자가 다르면 만들 수 있다.
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");
  const name = normalizeAccountId(body.id);
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!name) return fail("이름은 한글 실명으로 2~5자만 쓸 수 있어요.");
  if (!PIN_PATTERN.test(pin))
    return fail("비밀번호는 숫자 4자리로 정해 주세요.");

  try {
    const store = getStore();
    if (await tooMany(request, "signup", 10, store.hit)) {
      return fail(
        "계정을 너무 많이 만들었어요. 한 시간 뒤에 다시 시도해 주세요.",
        429,
      );
    }
    // 이 기기에서 계정 없이 쓰던 모임장이 있으면 그 일정과 모임을 그대로 계정으로 삼는다
    const deviceHost = await hostHashOf(request, store);
    if (deviceHost && (await store.getHostAccount(deviceHost))) {
      return fail(
        "이 기기는 이미 다른 계정으로 로그인돼 있어요. 로그아웃한 뒤 만들어 주세요.",
        409,
      );
    }

    // 같은 이름 + 같은 숫자는 로그인 때 구별할 수 없으므로 받지 않는다.
    // (이걸로 남의 숫자를 알아내려는 시도를 막으려고 틀린 로그인과 같이 횟수를 센다)
    const [recent, today] = await Promise.all([
      store.peek(`pin15:${name}`),
      store.peek(`pinday:${name}`),
    ]);
    if (recent >= FAILS_PER_15_MIN || today >= FAILS_PER_DAY)
      return fail("잠시 뒤에 다시 시도해 주세요.", 429);
    const sameName = await accountsByName(store, name);
    for (const other of sameName) {
      if ((await hashPin(pin, other.salt)) === other.pinHash) {
        await Promise.all([
          store.hit(`pin15:${name}`, 15 * 60),
          store.hit(`pinday:${name}`, 24 * 60 * 60),
        ]);
        return fail(
          "이 숫자는 쓸 수 없어요. 본인 계정이 있다면 로그인하고, 아니라면 다른 숫자로 정해 주세요.",
          409,
        );
      }
    }

    const hostHash = deviceHost || (await sha256(newAdminToken()));
    const salt = newSalt();
    const pinHash = await hashPin(pin, salt);
    let created: HostAccount | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const key = accountKeyFor(
        name,
        attempt > 0 || sameName.some((a) => a.id === name),
      );
      const account: HostAccount = {
        id: key,
        salt,
        pinHash,
        hostHash,
        createdAt: Date.now(),
      };
      if (await store.createAccount(account)) created = account;
    }
    if (!created) return fail("잠시 뒤에 다시 시도해 주세요.", 503);
    await store.setNameAccount(name, created.id, true);
    await store.setHostAccount(hostHash, created.id);
    return json(
      {
        id: name,
        sameName: sameName.length > 0,
        token: await openSession(store, hostHash),
      },
      201,
    );
  } catch (error) {
    return handleError(error);
  }
}

/**
 * 계정 지우기: 숫자 4자리를 한 번 더 확인한 뒤
 * 계정, 내 일정, 내가 만든 모임(응답 포함)을 모두 지운다. 되돌릴 수 없다.
 */
export async function DELETE(request: Request) {
  const body = await readBody(request);
  const pin = typeof body?.pin === "string" ? body.pin : "";
  if (!PIN_PATTERN.test(pin)) return fail("숫자 4자리를 입력해 주세요.");
  try {
    const store = getStore();
    const hostHash = await hostHashOf(request, store);
    const id = hostHash ? await store.getHostAccount(hostHash) : null;
    const account = id ? await store.getAccount(id) : null;
    if (!hostHash || !id || !account)
      return fail("로그인한 뒤에 지울 수 있어요.", 401);
    // 관리자 계정을 지우면 같은 이름으로 누구나 다시 가입해 관리자가 될 수 있으므로 막는다
    if (isSiteAdmin(id))
      return fail("관리자 계정은 여기서 지울 수 없어요.", 403);

    const [recent, today] = await Promise.all([
      store.peek(`pin15:${id}`),
      store.peek(`pinday:${id}`),
    ]);
    if (recent >= FAILS_PER_15_MIN || today >= FAILS_PER_DAY)
      return fail(
        "여러 번 틀려서 잠시 잠겼어요. 나중에 다시 시도해 주세요.",
        429,
      );
    if ((await hashPin(pin, account.salt)) !== account.pinHash) {
      await Promise.all([
        store.hit(`pin15:${id}`, 15 * 60),
        store.hit(`pinday:${id}`, 24 * 60 * 60),
      ]);
      return fail("숫자가 맞지 않아요.", 401);
    }

    const events = await store.listHostEvents(hostHash);
    for (const event of events) {
      await store.deleteEvent(event.id);
    }
    await store.deleteHost(hostHash);
    await store.deleteAccount(id, hostHash);
    await store.setNameAccount(displayName(id), id, false);
    const token = request.headers.get("x-host-token") ?? "";
    if (token) await store.deleteSession(await sha256(token));
    return json({ ok: true, deletedEvents: events.length });
  } catch (error) {
    return handleError(error);
  }
}

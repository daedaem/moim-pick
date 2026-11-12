import { fail, handleError, hostHashOf, json, readBody } from "@/lib/api";
import {
  FAILS_PER_15_MIN,
  FAILS_PER_DAY,
  hashPin,
  mergeHost,
  normalizeAccountId,
  openSession,
  PIN_PATTERN,
} from "@/lib/account";
import { ADMIN_FAILS_PER_DAY, isSiteAdmin } from "@/lib/admin";
import { getStore } from "@/lib/store";

// 모임장 로그인 (아이디 + 숫자 4자리)
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");
  const id = normalizeAccountId(body.id);
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!id || !PIN_PATTERN.test(pin)) return fail("이름(한글 실명)과 숫자 4자리를 확인해 주세요.");

  try {
    const store = getStore();
    // 숫자 4자리는 경우의 수가 적어서, 틀린 횟수가 쌓이면 맞는 숫자여도 받지 않는다
    const [recent, today] = await Promise.all([store.peek(`pin15:${id}`), store.peek(`pinday:${id}`)]);
    if (today >= (isSiteAdmin(id) ? ADMIN_FAILS_PER_DAY : FAILS_PER_DAY)) {
      return fail("오늘 너무 많이 틀려서 잠겼어요. 내일 다시 시도해 주세요.", 429);
    }
    if (recent >= FAILS_PER_15_MIN) {
      return fail("여러 번 틀려서 잠시 잠겼어요. 15분 뒤에 다시 시도해 주세요.", 429);
    }

    const account = await store.getAccount(id);
    const ok = account !== null && (await hashPin(pin, account.salt)) === account.pinHash;
    if (!account || !ok) {
      const [fails] = await Promise.all([
        store.hit(`pin15:${id}`, 15 * 60),
        store.hit(`pinday:${id}`, 24 * 60 * 60),
      ]);
      const left = Math.max(0, FAILS_PER_15_MIN - fails);
      return fail(
        left > 0
          ? `이름이나 숫자가 맞지 않아요. ${left}번 더 틀리면 15분 동안 잠겨요.`
          : "여러 번 틀려서 잠시 잠겼어요. 15분 뒤에 다시 시도해 주세요.",
        401,
      );
    }

    // 이 기기에서 계정 없이 쓰던 모임장이 있으면, 그 일정과 모임을 계정으로 합친다
    const deviceHost = await hostHashOf(request, store);
    if (deviceHost && deviceHost !== account.hostHash && !(await store.getHostAccount(deviceHost))) {
      await mergeHost(store, deviceHost, account.hostHash);
    }
    return json({ id: account.id, token: await openSession(store, account.hostHash) });
  } catch (error) {
    return handleError(error);
  }
}

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
  hashPin,
  newSalt,
  normalizeAccountId,
  openSession,
  PIN_PATTERN,
} from "@/lib/account";
import { getStore } from "@/lib/store";
import type { HostAccount } from "@/lib/types";

// 모임장 계정 만들기 (아이디 + 숫자 4자리)
export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return fail("요청 형식이 올바르지 않아요.");
  const id = normalizeAccountId(body.id);
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!id) return fail("이름은 한글 실명으로 2~5자만 쓸 수 있어요.");
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
    const hostHash = deviceHost || (await sha256(newAdminToken()));
    const salt = newSalt();
    const account: HostAccount = {
      id,
      salt,
      pinHash: await hashPin(pin, salt),
      hostHash,
      createdAt: Date.now(),
    };
    if (!(await store.createAccount(account))) {
      return fail(
        "이미 같은 이름으로 만든 계정이 있어요. 본인 계정이라면 로그인해 주세요.",
        409,
      );
    }
    await store.setHostAccount(hostHash, id);
    return json({ id, token: await openSession(store, hostHash) }, 201);
  } catch (error) {
    return handleError(error);
  }
}

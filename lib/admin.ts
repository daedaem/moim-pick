// 사이트 관리자: 모든 모임을 보고 지울 수 있는 계정의 아이디.
// 여기에는 아이디만 적는다. 비밀번호는 코드나 저장소 어디에도 적지 않는다.
// (비밀번호는 그 아이디로 계정을 만들 때 본인이 직접 정하고, 서버에는 해시로만 남는다.)
export const SITE_ADMIN_IDS: readonly string[] = ["조해성"];

export function isSiteAdmin(accountId: string | null | undefined): boolean {
  return Boolean(accountId && SITE_ADMIN_IDS.includes(accountId));
}

/** 관리자 아이디는 누구나 추측할 수 있으므로, 하루에 틀릴 수 있는 횟수를 더 적게 둔다 */
export const ADMIN_FAILS_PER_DAY = 8;

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "개인정보 안내 | 모임픽" };

/** 무엇을 모으고, 누구에게 보이고, 언제 지워지는지 */
export default function PrivacyPage() {
  return (
    <main className="page">
      <div className="step-top">
        <Link className="back" href="/">
          처음으로
        </Link>
      </div>

      <h1 className="question">개인정보 안내</h1>
      <p className="lead">
        모임픽은 모일 날짜와 장소를 정하는 데 필요한 것만 받아요.
      </p>

      <div className="doc">
        <section>
          <h2>받는 정보</h2>
          <ul>
            <li>
              모임에 응답할 때: 이름, 모임장과의 관계, 출발역(선택), 안 되는
              시간
            </li>
            <li>
              회원가입할 때: 아이디, 이름, 숫자 4자리(원래 숫자를 알 수 없게
              바꿔서 저장), 내가 안 되는 시간
            </li>
            <li>
              자동으로: 같은 기기에서 여러 번 응답하는 것을 막기 위한 기기
              표시값, 도배를 막기 위한 접속 횟수(잠시 뒤 지워짐)
            </li>
          </ul>
        </section>

        <section>
          <h2>쓰는 곳</h2>
          <p>
            모두 되는 날과 모이기 좋은 역을 계산하고, 모임장이 날짜를 확정하는
            데만 써요. 광고나 다른 목적으로 쓰지 않고 다른 곳에 팔거나 넘기지
            않아요.
          </p>
        </section>

        <section>
          <h2>누구에게 보이나요</h2>
          <p>
            응답한 내용(이름, 관계, 출발역, 안 되는 시간)은 그 모임 링크를 가진
            사람에게 보여요. 응답할 때 &lsquo;모임장에게만&rsquo;을 고르면
            이름은 모임장에게만 보이고, 다른 참여자에게는
            &lsquo;김*수&rsquo;처럼 가려져요. 모임장이 &lsquo;이름으로 검색
            허용&rsquo;을 켠 모임은 첫 화면 검색으로도 찾을 수 있어요. 숫자
            4자리는 누구에게도 보이지 않아요.
          </p>
        </section>

        <section>
          <h2>언제 지워지나요</h2>
          <ul>
            <li>모임과 응답: 마지막으로 바뀐 뒤 120일이 지나면 자동으로</li>
            <li>내가 안 되는 시간(모임장 일정): 400일이 지나면 자동으로</li>
            <li>계정: 내가 지울 때까지</li>
          </ul>
          <p>
            내 응답은 응답 화면에서, 모임은 모임장이 언제든 지울 수 있어요.
            계정은 <Link href="/host">내 일정과 모임</Link> 화면 맨 아래에서
            지우면 내가 만든 모임과 응답까지 함께 지워져요.
          </p>
        </section>

        <section>
          <h2>문의와 삭제 요청</h2>
          <p>
            개인정보 처리 책임자: 조해성
            <br />
            이메일: <a href="mailto:201826888@snu.ac.kr">201826888@snu.ac.kr</a>
          </p>
          <p>
            내 정보를 직접 지울 수 없거나 궁금한 점이 있으면 이메일로 알려
            주세요.
          </p>
        </section>

        <section>
          <h2>저장하는 곳</h2>
          <p>
            사이트는 Vercel에서, 데이터는 Upstash(일본 도쿄 서버)에 저장해요.
            응답을 고치는 데 필요한 표시값은 내 브라우저에도 저장돼요.
          </p>
        </section>
      </div>
    </main>
  );
}

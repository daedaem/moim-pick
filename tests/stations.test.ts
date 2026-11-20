// 모이기 좋은 역 추천: 한 사람이 여러 역을 고르면 가장 가까운 역 기준으로 계산한다
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { recommendMeetingPoints } from "@/lib/stations";

describe("역 추천", () => {
  it("모두 같은 역이면 그 역을 추천한다", () => {
    assert.equal(recommendMeetingPoints(["강남", "강남"])[0]?.name, "강남");
  });

  it("여러 역을 고른 사람은 가장 가까운 역에서 오는 것으로 본다", () => {
    // 두 번째 사람이 강남을 함께 골랐으면, 강남에서 바로 모일 수 있다
    const single = recommendMeetingPoints(["강남", "인천"])[0];
    const multi = recommendMeetingPoints(["강남", ["인천", "강남"]])[0];
    assert.ok(single.maxStops > 0);
    assert.equal(multi.name, "강남");
    assert.equal(multi.maxStops, 0);
  });

  it("목록에 없는 역은 무시한다", () => {
    assert.deepEqual(recommendMeetingPoints(["없는역"]), []);
  });
});

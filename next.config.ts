import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 카카오톡 링크 미리보기가 모임 이름을 읽을 수 있게, 메타데이터를 항상 첫 HTML에 담는다
  htmlLimitedBots: /.*/,
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;

/** 달력에 사인펜으로 친 동그라미 */
export function MarkerCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <path
        d="M23 4.6c9.6-.6 17.6 6.2 17.9 16.4.3 10.2-7.4 18.5-17.8 18.6C12.8 39.7 4.7 32.4 4.4 22.5 4.1 12.7 10.9 5.5 20.4 4.5c3.300-.3 6.200.3 8.800 1.700"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 안 되는 날에 긋는 사선 */
export function Slash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
      <path
        d="M9.500 35.500C17 27.500 26.500 17 34.800 8.200"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.300"
        strokeLinecap="round"
      />
    </svg>
  );
}

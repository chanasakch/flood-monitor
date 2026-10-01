// Icons not in the Lucide set, drawn in the same 24px stroke style.

/** A car above water: road flooding. */
export function RoadFloodIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l1.6-4.2A2 2 0 0 1 8.5 7.5h7a2 2 0 0 1 1.9 1.3L19 13" />
      <path d="M3.5 15.5V14a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v1.5" />
      <path d="M2 19c1.7-1.3 3.3-1.3 5 0s3.300 1.3 5 0 3.300-1.3 5 0 3.300 1.300 5 0" />
    </svg>
  );
}

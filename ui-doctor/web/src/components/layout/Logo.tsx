export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <rect x="8" y="8" width="16" height="16" rx="1.5" fill="none" stroke="var(--inspect)" strokeWidth="2" strokeDasharray="3 2" />
      <circle cx="16" cy="16" r="3" fill="var(--paper)" />
    </svg>
  );
}

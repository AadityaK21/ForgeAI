type ForgeMarkProps = { className?: string; thinking?: boolean };

export function ForgeMark({ className = "", thinking = false }: ForgeMarkProps) {
  return (
    <svg viewBox="0 0 48 40" width="32" height="27" aria-hidden="true" focusable="false"
      className={`forge-mark ${className}`} data-thinking={thinking || undefined}>
      <g className="forge-mark__planes">
        <path className="forge-mark__far" fill="currentColor" d="M19 28 46 2v35H19Z" />
        <path className="forge-mark__near" fill="currentColor" d="M2 2 29 28v9H2Z" />
      </g>
      <path className="forge-mark__trace" fill="none" stroke="currentColor" strokeWidth="1" pathLength="1"
        strokeLinejoin="round" d="M2 37V2l22 21L46 2v35H2Z" />
    </svg>
  );
}

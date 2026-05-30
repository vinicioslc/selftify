type ScanIndicatorProps = {
  className?: string;
  size?: "sm" | "md";
};

const delays = ["0s", "0.15s", "0.3s"];

export function ScanIndicator({ className = "", size = "sm" }: ScanIndicatorProps) {
  const dim = size === "sm" ? 14 : 22;
  const barW = Math.max(2, Math.round(dim * 0.2));

  return (
    <span className={`inline-flex items-end gap-[2px] ${className}`} style={{ height: dim }}>
      {delays.map((delay, i) => (
        <span
          key={i}
          className="animate-scan-bar rounded-sm"
          style={{
            width: barW,
            height: dim,
            backgroundColor: "hsl(var(--primary))",
            transformOrigin: "bottom",
            animationDelay: delay,
          }}
        />
      ))}
    </span>
  );
}

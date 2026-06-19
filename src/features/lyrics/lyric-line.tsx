import { memo, useMemo } from "react";

interface LyricLineProps {
  alignment: "center" | "left" | "right";
  fontSize: number;
  text: string;
  active?: boolean;
  className?: string;
  id?: string;
  onClick?: () => void;
}

export const LyricLine = memo(
  ({ alignment, fontSize, text, active, className, id, onClick }: LyricLineProps) => {
    const lines = useMemo(() => text.split("_BREAK_"), [text]);

    return (
      <div
        id={id}
        className={className ?? ""}
        onClick={onClick}
        role="listitem"
        aria-current={active ? "step" : undefined}
        style={{
          fontSize: `${fontSize}px`,
          textAlign: alignment,
          cursor: onClick ? "pointer" : undefined,
        }}
      >
        {lines.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </div>
    );
  },
);

LyricLine.displayName = "LyricLine";

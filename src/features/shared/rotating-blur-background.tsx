interface RotatingBlurBackgroundProps {
  imageUrl: string | null;
  isActive: boolean;
  animationsEnabled: boolean;
  status: string;
}

export function RotatingBlurBackground({ imageUrl, isActive, animationsEnabled, status }: RotatingBlurBackgroundProps) {
  if (!imageUrl) return null;

  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      <div className="h-full w-full" style={{ transform: "scale(1.5)" }}>
        <img
          src={imageUrl}
          alt=""
          className={`h-full w-full object-cover ${animationsEnabled ? "animate-spin" : ""}`}
          style={{
            filter: "blur(60px)",
            ...(animationsEnabled && {
              animationDuration: "40s",
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationPlayState: isActive && status === "playing" ? "running" : "paused",
            }),
          }}
        />
      </div>
      <div className="absolute inset-0 bg-background/60" />
    </div>
  );
}

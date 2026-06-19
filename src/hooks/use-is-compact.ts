import { useState, useEffect } from "react";

export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() =>
    typeof window !== "undefined" && window.innerWidth < window.innerHeight,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia("(max-aspect-ratio: 1/1)");

    const update = () => setCompact(mql.matches);
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return compact;
}

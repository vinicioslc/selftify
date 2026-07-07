import { useState, useEffect } from "react";

export function useIsCompact(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 640 || window.innerWidth < window.innerHeight;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkCompact = () => {
      const narrow = window.innerWidth < 640;
      const portrait = window.matchMedia("(max-aspect-ratio: 1/1)").matches;
      setCompact(narrow || portrait);
    };

    checkCompact();

    const mql = window.matchMedia("(max-aspect-ratio: 1/1)");
    mql.addEventListener("change", checkCompact);
    window.addEventListener("resize", checkCompact);
    return () => {
      mql.removeEventListener("change", checkCompact);
      window.removeEventListener("resize", checkCompact);
    };
  }, []);

  return compact;
}

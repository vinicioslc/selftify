import { useCallback, useEffect, useRef } from "react";
import { LyricLine } from "./lyric-line";
import type { SynchronizedLyricsArray, FullLyricsMetadata } from "../../types/lyrics-types";
import { useSettingsStore } from "../../stores/settings.store";
import { usePlayerStore } from "../../stores/player.store";
import { PlayerStatus } from "../../types/domain-types";

interface SynchronizedLyricsProps {
  lyrics: FullLyricsMetadata;
  translatedLyrics?: string | null;
}

export function SynchronizedLyrics({
  lyrics,
  translatedLyrics,
}: SynchronizedLyricsProps) {
  const settings = useSettingsStore((s) => s.lyrics);
  const status = usePlayerStore((s) => s.status);
  const positionMs = usePlayerStore((s) => s.positionMs);

  const syncedLyrics = lyrics.lyrics as SynchronizedLyricsArray;
  const lyricRef = useRef<SynchronizedLyricsArray>(syncedLyrics);
  const timerEpoch = useRef(0);
  const lyricTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayMsRef = useRef(lyrics.offsetMs ?? 0);
  const followRef = useRef(settings.follow);
  const userScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollRef = useRef(false);

  useEffect(() => {
    lyricRef.current = syncedLyrics;
  }, [syncedLyrics]);

  useEffect(() => {
    followRef.current = settings.follow;
  }, [settings.follow]);

  useEffect(() => {
    delayMsRef.current = lyrics.offsetMs ?? 0;
  }, [lyrics.offsetMs]);

  const getCurrentLyric = (timeInMs: number): number => {
    if (!lyricRef.current || lyricRef.current.length === 0) return -1;
    for (let idx = 0; idx < lyricRef.current.length; idx++) {
      if (timeInMs <= lyricRef.current[idx][0]) {
        return idx === 0 ? 0 : idx - 1;
      }
    }
    return lyricRef.current.length - 1;
  };

  const setCurrentLyric = useCallback(
    (timeInMs: number, epoch?: number, targetIndex?: number) => {
      const start = performance.now();

      let nextEpoch: number;
      if (epoch === undefined) {
        timerEpoch.current = (timerEpoch.current + 1) % 10000;
        nextEpoch = timerEpoch.current;
      } else if (epoch !== timerEpoch.current) {
        return;
      } else {
        nextEpoch = epoch;
      }

      const index = targetIndex ?? getCurrentLyric(timeInMs);
      document
        .querySelectorAll(".synced-lyric .active")
        .forEach((node) => node.classList.remove("active"));

      if (index === -1 || !lyricRef.current) return;

      const container = document.getElementById(
        "synced-lyrics-scroll-container",
      ) as HTMLElement | null;
      const currentElement = document.querySelector(`#lyric-s-${index}`) as HTMLElement | null;

      if (!currentElement || !container) return;

      currentElement.classList.add("active");

      if (followRef.current && !userScrollingRef.current) {
        programmaticScrollRef.current = true;
        const offsetTop = currentElement.offsetTop - container.clientHeight / 2;
        container.scroll({ behavior: "smooth", top: offsetTop });
        setTimeout(() => {
          programmaticScrollRef.current = false;
        }, 600);
      }

      if (index < lyricRef.current.length - 1) {
        const nextTime = lyricRef.current[index + 1][0];
        const elapsed = performance.now() - start;
        lyricTimer.current = setTimeout(
          () => {
            setCurrentLyricRef.current(nextTime, nextEpoch, index + 1);
          },
          Math.max(0, nextTime - timeInMs - elapsed),
        );
      }
    },
    [],
  );

  const setCurrentLyricRef = useRef(setCurrentLyric);
  useEffect(() => {
    setCurrentLyricRef.current = setCurrentLyric;
  }, [setCurrentLyric]);

  useEffect(() => {
    if (status === PlayerStatus.PLAYING) {
      setCurrentLyric(positionMs + delayMsRef.current);
      return () => {
        if (lyricTimer.current) clearTimeout(lyricTimer.current);
      };
    }
    return () => {};
  }, [syncedLyrics, setCurrentLyric, status, positionMs]);

  useEffect(() => {
    if (status !== PlayerStatus.PLAYING) {
      if (lyricTimer.current) clearTimeout(lyricTimer.current);
      return;
    }
    if (lyricTimer.current) clearTimeout(lyricTimer.current);
    setCurrentLyric(positionMs + delayMsRef.current);
  }, [positionMs, setCurrentLyric, status]);

  useEffect(() => {
    return () => {
      if (lyricTimer.current) clearTimeout(lyricTimer.current);
      timerEpoch.current += 1;
    };
  }, []);

  useEffect(() => {
    const container = document.getElementById("synced-lyrics-scroll-container");
    if (!container) return;

    const handleScroll = () => {
      if (programmaticScrollRef.current) return;
      userScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        userScrollingRef.current = false;
      }, 3000);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  const handleSeek = (time: number) => {
    usePlayerStore.getState().setSeek(time / 1000);
  };

  const translatedLines = translatedLyrics ? translatedLyrics.split("\n") : [];
  const lyricsCount = syncedLyrics.length;

  if (lyricsCount === 0) return null;

  return (
    <div
      id="synced-lyrics-scroll-container"
      className="synced-lyric flex flex-col px-4 overflow-y-auto h-full scroll-smooth [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
      style={{ gap: `${settings.gap}px` }}
      onMouseEnter={() => {
        document.getElementById("synced-lyrics-scroll-container")?.classList.remove("hide-scrollbar");
      }}
      onMouseLeave={() => {
        document.getElementById("synced-lyrics-scroll-container")?.classList.add("hide-scrollbar");
      }}
    >
      {settings.showProvider && lyrics.source && (
        <LyricLine
          alignment={settings.alignment}
          className="text-xs text-muted-foreground/60 pb-2"
          fontSize={settings.fontSize - 6}
          text={`Provided by ${lyrics.source}`}
        />
      )}
      {settings.showMatch && lyrics.remote && (
        <LyricLine
          alignment={settings.alignment}
          className="text-xs text-muted-foreground/60 pb-4"
          fontSize={settings.fontSize - 6}
          text={`"${lyrics.name} by ${lyrics.artist}"`}
        />
      )}
      {syncedLyrics.map(([time, text], idx) => (
        <LyricLine
          alignment={settings.alignment}
          className="lyric-line text-muted-foreground/50 transition-colors duration-200 [&.active]:text-foreground [&.active]:font-semibold [&.active]:drop-shadow-sm"
          fontSize={settings.fontSize}
          id={`lyric-s-${idx}`}
          key={idx}
          active={false}
          onClick={() => {
            if (time > 0 && Number.isFinite(time)) handleSeek(time);
          }}
          text={
            text + (translatedLines[idx] ? `_BREAK_${translatedLines[idx]}` : "")
          }
        />
      ))}
    </div>
  );
}

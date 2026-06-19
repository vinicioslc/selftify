import { useMemo } from "react";
import { LyricLine } from "./lyric-line";
import type { FullLyricsMetadata } from "../../types/lyrics-types";
import { useSettingsStore } from "../../stores/settings.store";

interface UnsynchronizedLyricsProps {
  lyrics: FullLyricsMetadata;
  translatedLyrics?: string | null;
}

export function UnsynchronizedLyrics({
  lyrics,
  translatedLyrics,
}: UnsynchronizedLyricsProps) {
  const settings = useSettingsStore((s) => s.lyrics);

  const lines = useMemo(() => {
    const text = typeof lyrics.lyrics === "string" ? lyrics.lyrics : lyrics.lyrics.map(([, t]) => t).join("\n");
    return text.split("\n");
  }, [lyrics.lyrics]);

  const translatedLines = useMemo(() => {
    return translatedLyrics ? translatedLyrics.split("\n") : [];
  }, [translatedLyrics]);

  return (
    <div
      className="flex flex-col px-4"
      style={{ gap: `${settings.gapUnsync}px` }}
    >
      {settings.showProvider && lyrics.source && (
        <LyricLine
          alignment={settings.alignment}
          className="text-xs text-muted-foreground/60 pb-2"
          fontSize={settings.fontSizeUnsync - 6}
          text={`Provided by ${lyrics.source}`}
        />
      )}
      {settings.showMatch && lyrics.remote && (
        <LyricLine
          alignment={settings.alignment}
          className="text-xs text-muted-foreground/60 pb-4"
          fontSize={settings.fontSizeUnsync - 6}
          text={`"${lyrics.name} by ${lyrics.artist}"`}
        />
      )}
      {lines.map((text, idx) => (
        <LyricLine
          alignment={settings.alignment}
          className="text-muted-foreground"
          fontSize={settings.fontSizeUnsync}
          id={`lyric-${idx}`}
          key={idx}
          text={text + (translatedLines[idx] ? `_BREAK_${translatedLines[idx]}` : "")}
        />
      ))}
    </div>
  );
}

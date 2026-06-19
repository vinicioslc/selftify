import type { SynchronizedLyricsArray } from "../../types/lyrics-types";

const timeExp = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?]([^\n]+)(\n|$)/g;
const alternateTimeExp = /\[(\d*),(\d*)]([^\n]+)(\n|$)/g;

export function parseLrc(lyrics: string): SynchronizedLyricsArray | string {
  const synced = tryParseStandard(lyrics);
  if (synced.length > 0) return synced;

  const alternate = tryParseAlternate(lyrics);
  if (alternate.length > 0) return alternate;

  return lyrics;
}

function tryParseStandard(lyrics: string): SynchronizedLyricsArray {
  const result: SynchronizedLyricsArray = [];
  const matches = lyrics.matchAll(timeExp);
  for (const line of matches) {
    const [, minute, sec, ms, text] = line;
    const minutes = parseInt(minute, 10);
    const seconds = parseInt(sec, 10);
    const milis = ms?.length === 3 ? parseInt(ms, 10) : (parseInt(ms, 10) || 0) * 10;
    result.push([(minutes * 60 + seconds) * 1000 + milis, text]);
  }
  return result;
}

function tryParseAlternate(lyrics: string): SynchronizedLyricsArray {
  const result: SynchronizedLyricsArray = [];
  const matches = lyrics.matchAll(alternateTimeExp);
  for (const line of matches) {
    const [, timeInMilis, , text] = line;
    const cleanText = text
      .replaceAll(/\(\d+,\d+\)/g, "")
      .replaceAll(/\s,/g, ",")
      .replaceAll(/\s\./g, ".");
    result.push([Number(timeInMilis), cleanText]);
  }
  return result;
}

export function formatLrc(
  array: SynchronizedLyricsArray,
  meta?: { artist?: string; title?: string; offset?: number },
): string {
  const lines: string[] = [];
  if (meta?.artist) lines.push(`[ar:${meta.artist}]`);
  if (meta?.title) lines.push(`[ti:${meta.title}]`);
  if (meta?.offset !== undefined) lines.push(`[offset:${meta.offset}]`);

  for (const [timeMs, text] of array) {
    const totalSec = timeMs / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = Math.floor(totalSec % 60);
    const ms = Math.floor((totalSec - Math.floor(totalSec)) * 1000);
    lines.push(
      `[${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}]${text}`,
    );
  }
  return lines.join("\n");
}

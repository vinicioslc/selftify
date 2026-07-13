import { useState, useEffect, useCallback } from "react";
import type { Song, Album, AlbumArtist } from "../../types/domain-types";
import { getMbzYtMapping, setMbzYtMapping, type MbzYtMapping, type CandidateData } from "../../api/backend-state";
import type { StreamSourceCandidate } from "../../types/domain-types";
import { researchSong, fetchCustomVideoInfo, searchAndRankAll } from "../../services/youtube-download-service";
import { findLocalCandidates } from "../../services/stream-resolver";
import type { YoutubeSearchScoredVideo } from "../../services/youtube-ranking";
import { useLazyArtistImage } from "../../hooks/use-artist-image";
import { CoverImage } from "../../components/ui/art-image";
import { ArtImage } from "../../components/ui/art-image";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../components/ui/tabs";
import { AlbumEmptySvg, ArtistEmptySvg } from "../../components/ui/empty-image-svg";
import { cn, formatDuration } from "../../lib/utils";
import { Loader2, ExternalLink, Copy, Check, Search, FolderOpen } from "lucide-react";
import { artworkResolver } from "../../services/artwork/artwork-resolver";
import { ARTWORK_PROVIDER_META } from "../../services/artwork/providers/meta";
import type { ArtworkCandidate } from "../../services/artwork/providers/types";
import { fetchImageAsBlobUrl } from "../../services/image-fetch";
import { storeImage, md5Hash } from "../../services/image-store";

type Props = {
  song: Song;
  onNavigateAlbum?: (album: Album) => void;
  onNavigateArtist?: (artist: AlbumArtist) => void;
};

function CopyableId({ label, id }: { label: string; id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <code className="flex-1 truncate bg-muted/40 px-1 py-0.5 rounded text-[10px] font-mono">
        {id}
      </code>
      <button
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => { navigator.clipboard.writeText(id); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        title="Copy"
      >
        {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      </button>
      <a
        href={`https://musicbrainz.org/recording/${id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Open in MusicBrainz"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  );
}

export function SongInfoContent({ song, onNavigateAlbum, onNavigateArtist }: Props) {
  const { imageUrl: artistImageUrl } = useLazyArtistImage(song.mbzArtistId, song.artistName);
  const [mapping, setMapping] = useState<MbzYtMapping | null>(null);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<CandidateData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reRanking, setReRanking] = useState(false);
  const [localCandidates, setLocalCandidates] = useState<StreamSourceCandidate[]>([]);
  const [selectedLocalSongId, setSelectedLocalSongId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingCustomSearch, setSearchingCustomSearch] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [fetchingCustom, setFetchingCustom] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const [coverResults, setCoverResults] = useState<Record<string, ArtworkCandidate[]>>({});
  const [coverLoading, setCoverLoading] = useState<Record<string, boolean>>({});
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string | null>(null);
  const [activeCoverProvider, setActiveCoverProvider] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);

  useEffect(() => {
    if (!song.mbzRecordingId) return;
    loadData();
  }, [song.mbzRecordingId]);

  async function loadData() {
    if (!song.mbzRecordingId) return;
    setLoading(true);

    setSearchQuery([song.artistName, song.name, song.albumName].filter(Boolean).join(" "));

    const localCands = await findLocalCandidates(song.mbzRecordingId, song.originId, song.name, song.artistName);
    setLocalCandidates(localCands);

    const m = await getMbzYtMapping(song.mbzRecordingId);
    setMapping(m);
    if (m) {
      const raw = (m.candidates || []) as Partial<CandidateData>[];
      const parsed: CandidateData[] = raw.map((c) => ({
        score: 0, keywordScore: 0, diff: 0, titleMatch: false, artistMatch: false,
        albumMatch: false, artistOnChannel: false, channelExactMatch: false, isCover: false,
        exactDuration: false, closestDuration: false,
        ...c,
        videoId: c.videoId || "",
        title: c.title || "",
        source: (c.source === "custom" || c.source === "ranking" ? c.source : "ranking"),
      }));
      setCandidates(parsed);
      setSelectedId(m.selectedVideoId ?? null);
      setSelectedLocalSongId(m.localSongId ?? null);
    } else {
      setCandidates([]);
      setSelectedId(null);
      setSelectedLocalSongId(localCands.length > 0 ? localCands[0].song.id : null);
    }
    setLoading(false);
  }

  async function handleSelect(videoId: string) {
    setSelectedId(videoId);
    setSelectedLocalSongId(null);
    if (!song.mbzRecordingId || !mapping) return;
    const updated = { ...mapping, selectedVideoId: videoId, selectedType: "manual" as const, selectedSource: "youtube" as const, localSongId: undefined, updatedAt: Date.now() };
    await setMbzYtMapping(updated);
    setMapping(updated);
  }

  async function handleSelectLocal(localSongId: string) {
    setSelectedLocalSongId(localSongId);
    setSelectedId(null);
    if (!song.mbzRecordingId) return;
    const now = Date.now();
    const updated: MbzYtMapping = mapping ? {
      ...mapping,
      selectedSource: "local",
      localSongId,
      selectedVideoId: mapping.selectedVideoId,
      selectedType: "manual",
      updatedAt: now,
    } : {
      mbzRecordingId: song.mbzRecordingId,
      songName: song.name,
      artistName: song.artistName,
      albumName: song.albumName,
      albumImageUrl: song.imageUrl,
      selectedVideoId: undefined,
      selectedType: "manual",
      selectedSource: "local",
      localSongId,
      candidates: [],
      createdAt: now,
      updatedAt: now,
    };
    await setMbzYtMapping(updated);
    setMapping(updated);
  }

  async function handleReRank() {
    if (!song.mbzRecordingId) return;
    setReRanking(true);
    await researchSong(song);
    await loadData();
    setReRanking(false);
  }

  async function handleCustomSearch() {
    if (!searchQuery.trim() || !song.mbzRecordingId) return;
    setSearchingCustomSearch(true);
    try {
      const result = await searchAndRankAll(song, searchQuery.trim());
      if (result && result.scored.length > 0) {
        const newCands: CandidateData[] = result.scored.map((r: YoutubeSearchScoredVideo) => ({
          videoId: r.video.id,
          title: r.video.title,
          uploader: r.video.uploader || "",
          duration: typeof r.video.duration === "object" && r.video.duration ? r.video.duration.seconds : typeof r.video.duration === "number" ? r.video.duration : undefined,
          score: r.breakdown.score,
          titleMatch: r.breakdown.titleMatch,
          artistMatch: r.breakdown.artistMatch,
          albumMatch: r.breakdown.albumMatch,
          artistOnChannel: r.breakdown.artistOnChannel,
          channelExactMatch: r.breakdown.channelExactMatch,
          isCover: r.breakdown.isCover,
          exactDuration: r.breakdown.exactDuration,
          closestDuration: r.breakdown.closestDuration,
          keywordScore: r.breakdown.keywordScore,
          diff: r.diff,
          source: "ranking",
        }));
        const selectedId = newCands[0].videoId;
        setCandidates(newCands);
        setSelectedId(selectedId);
        setSelectedLocalSongId(null);
        const now = Date.now();
        const updated: MbzYtMapping = {
          mbzRecordingId: song.mbzRecordingId,
          songName: song.name,
          artistName: song.artistName,
          albumName: song.albumName,
          albumImageUrl: song.imageUrl,
          selectedVideoId: selectedId,
          selectedType: "auto",
          candidates: newCands,
          createdAt: mapping?.createdAt || now,
          updatedAt: now,
        };
        await setMbzYtMapping(updated);
        setMapping(updated);
      }
    } catch {
      // ignore
    } finally {
      setSearchingCustomSearch(false);
    }
  }

  async function handleFetchCustom() {
    if (!customUrl.trim()) return;
    setFetchingCustom(true);
    setCustomError(null);
    const result = await fetchCustomVideoInfo(customUrl.trim());
    setFetchingCustom(false);
    if (result) {
      const newCand: CandidateData = { ...result, source: "custom" };
      const updatedCands = [...candidates, newCand];
      setCandidates(updatedCands);
      setSelectedId(newCand.videoId);
      if (song.mbzRecordingId) {
        const now = Date.now();
        const updated: MbzYtMapping = {
          mbzRecordingId: song.mbzRecordingId,
          songName: song.name,
          artistName: song.artistName,
          albumName: song.albumName,
          albumImageUrl: song.imageUrl,
          selectedVideoId: newCand.videoId,
          selectedType: "custom",
          candidates: updatedCands,
          customVideoId: newCand.videoId,
          customVideoUrl: customUrl.trim(),
          createdAt: mapping?.createdAt || now,
          updatedAt: now,
        };
        await setMbzYtMapping(updated);
        setMapping(updated);
      }
      setCustomUrl("");
    } else {
      setCustomError("Could not fetch video. Check the URL.");
    }
  }

  async function handleFetchProvider(providerName: string) {
    setCoverLoading((prev) => ({ ...prev, [providerName]: true }));
    setCoverError(null);
    console.log(`[SongInfoContent] fetching from provider: "${providerName}" song="${song.name}" artist="${song.artistName}"`);
    try {
      const items = await artworkResolver.resolveFromProvider(providerName, {
        artist: song.artistName,
        album: song.albumName || undefined,
        title: song.name,
        durationMs: song.duration ? song.duration * 1000 : undefined,
      });
      console.log(`[SongInfoContent] "${providerName}" resolved ${items.length} candidate(s)`);
      if (items.length === 0) {
        setCoverError(`No results from ${ARTWORK_PROVIDER_META[providerName]?.label || providerName}`);
        setCoverResults((prev) => ({ ...prev, [providerName]: [] }));
        return;
      }
      const candidatesWithBlobs = await Promise.all(
        items.map(async (cand) => ({
          ...cand,
          blobUrl: await fetchImageAsBlobUrl(cand.thumbnailUrl || cand.url),
        }))
      );
      setCoverResults((prev) => ({ ...prev, [providerName]: candidatesWithBlobs }));
    } catch (err) {
      console.error(`[SongInfoContent] "${providerName}" fetch error:`, err);
      setCoverError(`Failed to search ${ARTWORK_PROVIDER_META[providerName]?.label || providerName}`);
      setCoverResults((prev) => ({ ...prev, [providerName]: [] }));
    } finally {
      setCoverLoading((prev) => ({ ...prev, [providerName]: false }));
    }
  }

  async function handleSelectCover(candidate: ArtworkCandidate) {
    try {
      const blobUrl = await fetchImageAsBlobUrl(candidate.url);
      if (!blobUrl) return;

      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      const hash = await md5Hash(buffer);

      await storeImage({
        md5: hash,
        blob: buffer,
        format: blob.type,
        size: buffer.byteLength,
        createdAt: Date.now(),
        artistName: song.artistName.toLowerCase().trim(),
        albumName: song.albumName?.toLowerCase().trim(),
        mbzArtistId: song.mbzArtistId,
        sourceUrl: candidate.url,
      });

      setSelectedCoverUrl(blobUrl);
      setActiveCoverProvider(candidate.provider);
    } catch (err) {
      console.warn("[SongInfoContent] failed to select cover:", err);
    }
  }

  const selectedCand = candidates.find((c) => c.videoId === selectedId);
  const hasRanking = candidates.length > 0;
  const hasMbz = !!song.mbzRecordingId;

  const handleArtistClick = useCallback(() => {
    if (!onNavigateArtist) return;
    onNavigateArtist({
      id: `artist-${song.artistName.toLowerCase().replace(/\s+/g, "-")}`,
      originId: song.originId,
      originType: song.originType,
      name: song.artistName,
      imageUrl: song.imageUrl || null,
      mbz: song.mbzArtistId,
    });
  }, [onNavigateArtist, song.artistName, song.originId, song.originType, song.imageUrl, song.mbzArtistId]);

  const handleAlbumClick = useCallback(() => {
    if (!onNavigateAlbum || !song.albumName) return;
    onNavigateAlbum({
      id: song.albumId || `album-${song.artistName.toLowerCase().replace(/\s+/g, "-")}-${song.albumName.toLowerCase().replace(/\s+/g, "-")}`,
      originId: song.originId,
      originType: song.originType,
      name: song.albumName,
      albumArtistName: song.albumArtistName || song.artistName,
      imageUrl: song.imageUrl || null,
    });
  }, [onNavigateAlbum, song.albumName, song.albumId, song.albumArtistName, song.artistName, song.originId, song.originType, song.imageUrl]);

  return (
    <div className="space-y-4">
      {/* ── Images ── */}
      <div className="flex gap-4 items-start">
        <div className="flex flex-col items-center gap-1">
          <ArtImage
            src={selectedCoverUrl || song.imageUrl || mapping?.albumImageUrl || undefined}
            alt={song.albumName || song.name}
            fallback={song.name.charAt(0)}
            emptySvg={<AlbumEmptySvg />}
            className="h-24 w-24 rounded-lg shrink-0"
          />
          <span className="text-[10px] text-muted-foreground truncate max-w-24 text-center">
            {song.albumName || "Album"}
          </span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <CoverImage
            src={artistImageUrl}
            alt={song.artistName}
            fallback={song.artistName.charAt(0)}
            emptySvg={<ArtistEmptySvg />}
            className="h-20 w-20 rounded-full shrink-0"
            lazy={!artistImageUrl}
          />
          <span className="text-[10px] text-muted-foreground truncate max-w-20 text-center">
            {song.artistName}
          </span>
        </div>
      </div>

      {/* ── Song Metadata ── */}
      <div className="rounded-lg border bg-muted/20 p-3 space-y-1">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div><span className="text-muted-foreground">Title:</span> <span className="text-foreground font-medium">{song.name}</span></div>
          <div><span className="text-muted-foreground">Artist:</span>{" "}
            {onNavigateArtist ? (
              <button onClick={handleArtistClick} className="text-foreground hover:underline text-left">{song.artistName}</button>
            ) : (
              <span className="text-foreground">{song.artistName}</span>
            )}
          </div>
          {song.albumName && <div><span className="text-muted-foreground">Album:</span>{" "}
            {onNavigateAlbum ? (
              <button onClick={handleAlbumClick} className="text-foreground hover:underline text-left">{song.albumName}</button>
            ) : (
              <span className="text-foreground">{song.albumName}</span>
            )}
          </div>}
          {song.duration && <div><span className="text-muted-foreground">Duration:</span> <span className="text-foreground tabular-nums">{formatDuration(song.duration)}</span></div>}
          {song.releaseYear && <div><span className="text-muted-foreground">Year:</span> <span className="text-foreground">{song.releaseYear}</span></div>}
          {song.trackNumber && <div><span className="text-muted-foreground">Track:</span> <span className="text-foreground">{song.trackNumber}{song.discNumber ? ` (Disc ${song.discNumber})` : ""}</span></div>}
          {song.genres && song.genres.length > 0 && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Genres:</span>{" "}
              <span className="text-foreground">{song.genres.join(", ")}</span>
            </div>
          )}
        </div>
        {song.path && (
          <div className="border-t border-border pt-1.5 mt-1.5 flex items-center gap-1.5 text-xs">
            <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground truncate" title={song.path}>
              {song.path.split("/").slice(0, -1).join("/") || song.path}
            </span>
          </div>
        )}
        <div className="border-t border-border pt-1.5 mt-1.5 space-y-1">
          {song.mbzRecordingId && <CopyableId label="MB Recording" id={song.mbzRecordingId} />}
          {song.mbzArtistId && (
            <p className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground shrink-0">MB Artist:</span>
              <code className="flex-1 truncate bg-muted/40 px-1 py-0.5 rounded text-[10px] font-mono">{song.mbzArtistId}</code>
              <a
                href={`https://musicbrainz.org/artist/${song.mbzArtistId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Open in MusicBrainz"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          )}
          {song.mbzTrackId && <CopyableId label="MB Track" id={song.mbzTrackId} />}
        </div>

        {song.youtubeVideoTitle && (
          <div className="border-t border-border pt-1.5 mt-1.5 space-y-1">
            <p className="text-xs text-muted-foreground font-medium">YouTube Source</p>
            <p className="flex items-center gap-1.5 text-xs">
              <span className="text-foreground truncate">{song.youtubeVideoTitle}</span>
              {song.youtubeVideoId && (
                <a
                  href={`https://music.youtube.com/watch?v=${song.youtubeVideoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
                  title="Open in YouTube Music"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
            {song.youtubeChannelName && (
              <p className="text-xs text-muted-foreground">by {song.youtubeChannelName}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      {hasMbz && (
        <Tabs defaultValue="sources">
          <TabsList className="w-full">
            <TabsTrigger value="sources" className="flex-1 text-xs">Sources</TabsTrigger>
            <TabsTrigger value="covers" className="flex-1 text-xs">Covers</TabsTrigger>
          </TabsList>

          {/* ── Sources Tab ── */}
          <TabsContent value="sources" className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Current source indicator */}
                {selectedLocalSongId ? (
                  <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-green-600 dark:text-green-400">
                        Playing from local file
                      </p>
                      <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-600 dark:text-green-400">
                        Local
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {localCandidates.find((lc) => lc.song.id === selectedLocalSongId)?.filePath || "Local file"}
                    </p>
                  </div>
                ) : selectedCand ? (
                  <div className="rounded-lg border border-accent bg-accent/20 p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-foreground">Playing from YouTube</p>
                      <Badge variant="outline" className="text-[10px]">
                        {mapping?.selectedType === "custom" ? "Custom" : mapping?.selectedType === "manual" ? "Manual" : "Auto"}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium truncate">{selectedCand.title}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{selectedCand.uploader}</span>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums">Score: {selectedCand.score?.toFixed(2) ?? "—"}</span>
                        <a
                          href={`https://youtube.com/watch?v=${selectedCand.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* YouTube candidates */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      YouTube candidates ({candidates.length})
                    </p>
                    {candidates.length > 0 && (
                      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleReRank} disabled={reRanking}>
                        {reRanking ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        Re-rank
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCustomSearch()}
                      placeholder="YouTube search term..."
                      className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 gap-1.5 px-3 shrink-0"
                      onClick={handleCustomSearch}
                      disabled={searchingCustomSearch || !searchQuery.trim()}
                      title="Search YouTube with this term"
                    >
                      {searchingCustomSearch ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                      <span>Search</span>
                    </Button>
                  </div>
                  {candidates.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                      <p className="text-xs text-muted-foreground">No YouTube ranking data yet.</p>
                      <Button variant="outline" size="sm" onClick={handleReRank} disabled={reRanking}>
                        {reRanking ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        Search YouTube
                      </Button>
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-y-auto space-y-0.5">
                      {candidates.map((c, i) => (
                        <label
                          key={c.videoId}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent/50",
                            selectedId === c.videoId && !selectedLocalSongId && "bg-accent/30",
                          )}
                        >
                          <input
                            type="radio"
                            name={`song-cand-${song.id}`}
                            checked={selectedId === c.videoId && !selectedLocalSongId}
                            onChange={() => handleSelect(c.videoId)}
                            className="h-3.5 w-3.5 accent-primary shrink-0"
                          />
                          <span className="w-4 shrink-0 text-muted-foreground text-center">
                            {c.source === "custom" ? "⊕" : i < 3 ? ["🥇", "🥈", "🥉"][i] : `#${i + 1}`}
                          </span>
                          <span className="flex-1 truncate" title={c.title}>{c.title}</span>
                          <span className="hidden sm:inline truncate text-muted-foreground max-w-[100px]" title={c.uploader}>
                            {c.uploader}
                          </span>
                          {c.duration ? (
                            <span className="tabular-nums text-muted-foreground shrink-0">{formatDuration(c.duration)}</span>
                          ) : null}
                          <span className="tabular-nums text-muted-foreground shrink-0">{c.score?.toFixed(1) ?? "—"}</span>
                          <span className="flex shrink-0 gap-0.5 text-[10px] text-muted-foreground">
                            {c.titleMatch && <span className="font-bold text-green-500" title="Title match">T</span>}
                            {c.artistMatch && <span className="font-bold text-blue-500" title="Artist match">A</span>}
                            {c.artistOnChannel && <span className="font-bold text-orange-500" title="Artist on channel">Ch</span>}
                            {c.channelExactMatch && <span className="font-bold text-indigo-500" title="Artist on channel exactly">ChE</span>}
                            {c.isCover && <span className="font-bold text-rose-500" title="Cover song">Cv</span>}
                            {c.albumMatch && <span className="font-bold text-amber-500" title="Album match">Al</span>}
                            {c.exactDuration && <span className="font-bold text-purple-500" title="Exact duration">D</span>}
                            {c.closestDuration && <span className="font-bold text-purple-400" title="Closest duration">~D</span>}
                            {c.source === "custom" && <span className="font-bold text-cyan-500" title="Custom URL">C</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Local candidates */}
                {localCandidates.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Local candidates ({localCandidates.length})
                      </p>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {localCandidates.map((lc) => (
                        <label
                          key={lc.song.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-pointer transition-colors hover:bg-accent/50",
                            selectedLocalSongId === lc.song.id && "bg-accent/30",
                          )}
                        >
                          <input
                            type="radio"
                            name={`song-cand-${song.id}`}
                            checked={selectedLocalSongId === lc.song.id}
                            onChange={() => handleSelectLocal(lc.song.id)}
                            className="h-3.5 w-3.5 accent-primary shrink-0"
                          />
                          <span className="flex-1 truncate">
                            {lc.filePath.split("/").pop() || lc.filePath}
                          </span>
                          <span className="text-muted-foreground shrink-0 tabular-nums">
                            {lc.bitrate ? `${lc.bitrate}kbps` : ""}
                          </span>
                          {lc.fileSize && (
                            <span className="text-muted-foreground shrink-0 tabular-nums">
                              {(lc.fileSize / (1024 * 1024)).toFixed(1)}MB
                            </span>
                          )}
                          {lc.bitrate || lc.fileSize ? null : (
                            <span className="text-muted-foreground shrink-0">local</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom URL */}
                <div className="space-y-2">
                  <p className="text-xs font-medium text-foreground">Custom YouTube URL</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                      className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      onKeyDown={(e) => e.key === "Enter" && handleFetchCustom()}
                    />
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleFetchCustom} disabled={fetchingCustom || !customUrl.trim()}>
                      {fetchingCustom ? <Loader2 className="h-3 w-3 animate-spin" /> : "Fetch"}
                    </Button>
                  </div>
                  {customError && <p className="text-xs text-destructive">{customError}</p>}
                </div>
              </>
            )}
          </TabsContent>

          {/* ── Covers Tab ── */}
          <TabsContent value="covers" className="space-y-3">
            {coverError && (
              <p className="text-[10px] text-destructive">{coverError}</p>
            )}
            <div className="space-y-1.5">
              {artworkResolver.getProviderNames().map((name) => {
                const candidates = coverResults[name] || [];
                const loading = coverLoading[name];
                const label = ARTWORK_PROVIDER_META[name]?.label || name;
                const hasResults = candidates.length > 0;
                const isActive = activeCoverProvider === name;

                return (
                  <div
                    key={name}
                    className={cn(
                      "rounded-md border p-2",
                      isActive ? "border-green-500/50 bg-green-500/10" : "border-border/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium">{label}</span>
                        {hasResults && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {candidates[0].url}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[10px] shrink-0"
                        onClick={() => handleFetchProvider(name)}
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Search className="h-3 w-3" />
                        )}
                      </Button>
                    </div>

                    {hasResults && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {candidates.map((cand) => (
                          <div key={`${cand.provider}-${cand.url}`} className="relative group">
                            <ArtImage
                              src={cand.blobUrl || cand.url}
                              alt={cand.provider}
                              fallback={cand.provider.charAt(0).toUpperCase()}
                              className={cn(
                                "h-12 w-12 rounded-md cursor-pointer ring-1 ring-transparent transition-all hover:ring-primary/50",
                                isActive && activeCoverProvider === cand.provider && "ring-green-500/50",
                              )}
                              onClick={() => handleSelectCover(cand)}
                            />
                            <button
                              className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[8px] text-primary-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                              onClick={() => handleSelectCover(cand)}
                              title="Select this cover"
                            >
                              ✓
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

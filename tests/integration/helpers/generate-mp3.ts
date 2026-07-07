export interface TrackMeta {
  title: string;
  artist: string;
  album: string;
  year: number;
  trackNumber: number;
  genre?: string;
}

/** Encode a 28-bit value into a 4-byte syncsafe integer (ID3v2 size). */
function syncSafeInt32(value: number): number[] {
  const bytes: number[] = [];
  for (let i = 3; i >= 0; i--) {
    bytes.push((value >>> (i * 7)) & 0x7f);
  }
  return bytes;
}

/**
 * Build an ID3v2.3 text frame.
 * Encoding 0x00 = ISO-8859-1 (ASCII-compatible for our test strings), null-terminated.
 */
function id3Frame(frameId: string, text: string): number[] {
  const encoder = new TextEncoder();
  const textBytes = Array.from(encoder.encode(text));
  const frameData = [0x00, ...textBytes, 0x00];
  const size = frameData.length;
  const header = [
    frameId.charCodeAt(0),
    frameId.charCodeAt(1),
    frameId.charCodeAt(2),
    frameId.charCodeAt(3),
    (size >>> 24) & 0xff,
    (size >>> 16) & 0xff,
    (size >>> 8) & 0xff,
    size & 0xff,
    0x00, 0x00,
  ];
  return [...header, ...frameData];
}

/**
 * Build a valid MPEG1 Layer3 frame header.
 * 128 kbps, 44100 Hz, stereo, no padding, no CRC.
 */
function mpegFrameHeader(): number[] {
  const bitrateIndex = 9;   // 128 kbps
  const sampleRateIndex = 0; // 44100 Hz
  const padding = 0;
  const channelMode = 0;    // stereo
  return [
    0xff,
    0xfb,
    (bitrateIndex << 4) | (sampleRateIndex << 2) | (padding << 1) | 0,
    (channelMode << 6),
  ];
}

/** Generate minimal valid MP3 bytes parseable by music-metadata. */
export function generateMp3Bytes(meta: TrackMeta): Uint8Array {
  const frames: number[] = [
    ...id3Frame("TIT2", meta.title),
    ...id3Frame("TPE1", meta.artist),
    ...id3Frame("TALB", meta.album),
    ...id3Frame("TYER", String(meta.year)),
    ...id3Frame("TRCK", String(meta.trackNumber)),
  ];

  if (meta.genre) {
    frames.push(...id3Frame("TCON", meta.genre));
  }

  const id3Padding = 128;
  const id3BodySize = frames.length + id3Padding;
  const id3Header: number[] = [
    0x49, 0x44, 0x33,
    0x03, 0x00,
    0x00,
    ...syncSafeInt32(id3BodySize),
  ];

  const padding = new Array(id3Padding).fill(0);
  const frameHeader = mpegFrameHeader();
  const mpegFrameSize = 418;
  const sideInfoSize = 32;
  const mainDataSize = mpegFrameSize - 4 - sideInfoSize;
  const mpegAudio = [
    ...frameHeader,
    ...new Array(sideInfoSize + mainDataSize).fill(0),
  ];

  return new Uint8Array([...id3Header, ...frames, ...padding, ...mpegAudio]);
}

export interface TestTrack {
  fileName: string;
  filePath: string;
  meta: TrackMeta;
  bytes: Uint8Array;
}

export interface TestLibrary {
  root: string;
  tracks: TestTrack[];
}

export function createTestLibrary(root: string = "/test-music"): TestLibrary {
  const tracks: TestTrack[] = [
    {
      fileName: "01 - First Track.mp3",
      filePath: root + "/TestArtist/TestAlbum (2024)/01 - First Track.mp3",
      meta: {
        title: "First Track",
        artist: "TestArtist",
        album: "TestAlbum",
        year: 2024,
        trackNumber: 1,
        genre: "Rock",
      },
      bytes: null as unknown as Uint8Array,
    },
    {
      fileName: "02 - Second Track.mp3",
      filePath: root + "/TestArtist/TestAlbum (2024)/02 - Second Track.mp3",
      meta: {
        title: "Second Track",
        artist: "TestArtist",
        album: "TestAlbum",
        year: 2024,
        trackNumber: 2,
        genre: "Rock",
      },
      bytes: null as unknown as Uint8Array,
    },
  ];

  for (const t of tracks) {
    t.bytes = generateMp3Bytes(t.meta);
  }

  return { root, tracks };
}

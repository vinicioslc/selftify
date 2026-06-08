// Empty-state SVGs for images (gray on transparent bg, theme-compatible)

export function AlbumEmptySvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#888"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="1" fill="#888" />
    </svg>
  );
}

export function ArtistEmptySvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#888"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2" />
      <line x1="16" y1="3.5" x2="22" y2="3.5" />
      <line x1="19" y1="1.5" x2="19" y2="5.5" />
      <line x1="17" y1="11.5" x2="22" y2="11.5" />
      <line x1="13" y1="15.5" x2="22" y2="15.5" />
    </svg>
  );
}

export function SongEmptySvg({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#888"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="18" r="3" />
      <circle cx="17" cy="16" r="2" />
      <path d="M11 18V4l10-1v12" />
      <line x1="11" y1="8" x2="21" y2="7" />
    </svg>
  );
}

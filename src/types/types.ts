import { OriginType } from "./domain-types";

export type ListDisplayType = "grid" | "list" | "table";

export type ServerConfig = {
  id: string;
  name: string;
  type: OriginType;
  url?: string;
  credential?: string;
  settings?: Record<string, unknown>;
};

export type HomePageCard = {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: OriginType | "local";
  route: string;
  enabled: boolean;
};

export type AppView =
  | "home"
  | "search"
  | "library-albums"
  | "library-artists"
  | "library-songs"
  | "playlists"
  | "settings"
  | "now-playing"
  | "album-detail"
  | "artist-detail";

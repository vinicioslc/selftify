import { ServerType } from "./domain-types";

export type ListDisplayType = "grid" | "list" | "table";

export type ServerConfig = {
  id: string;
  name: string;
  type: ServerType;
  url?: string;
  credential?: string;
  settings?: Record<string, unknown>;
};

export type HomePageCard = {
  id: string;
  title: string;
  description: string;
  icon: string;
  type: ServerType | "local";
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
  | "now-playing";

export type StatusLevel = "info" | "success" | "warn" | "danger";

export type StatusMessage = {
  id: string;
  text: string;
  level: StatusLevel;
  timestamp: number;
  source?: string;
};

export type LogLevel = "info" | "warn" | "error";

export function logEvent(level: LogLevel, event: string, details: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

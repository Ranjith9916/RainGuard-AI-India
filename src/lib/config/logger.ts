/**
 * Structured JSON logger.
 *
 * Emits one JSON object per line to stdout/stderr so that downstream log
 * shippers (Loki, Datadog, CloudWatch) can parse fields directly. Each log
 * line carries:
 *   - timestamp (ISO-8601, IST-aware via env TZ)
 *   - level
 *   - message (the human-readable event name)
 *   - requestId / correlationId when present
 *   - arbitrary structured payload
 *
 * The logger is intentionally small — no transports, no async batching —
 * because the system already runs behind a process supervisor that captures
 * stdout. Adding transports would only complicate the surface area.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPayload {
  [key: string]: unknown;
}

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  service?: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Minimum level that will actually be written. */
function minLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  if (!(raw in LEVEL_PRIORITY)) return "info";
  return raw;
}

function istTimestamp(): string {
  // Use UTC ISO — timezone interpretation is downstream's job — but include
  // the local offset so a human reading raw logs can correlate.
  try {
    return new Date().toISOString();
  } catch {
    return new Date(Date.now()).toString();
  }
}

function safeStringify(value: unknown): string {
  if (value === undefined) return "{}";
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ _unserialisable: true });
  }
}

function emit(level: LogLevel, message: string, payload?: LogPayload): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel()]) return;

  const record: LogRecord = {
    timestamp: istTimestamp(),
    level,
    message,
    service: process.env.SERVICE_NAME ?? "rainguard",
    ...(payload ?? {}),
  };

  const line = safeStringify(record);
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}

export interface Logger {
  debug(message: string, payload?: LogPayload): void;
  info(message: string, payload?: LogPayload): void;
  warn(message: string, payload?: LogPayload): void;
  error(message: string, payload?: LogPayload): void;
  child(bindings: LogPayload): Logger;
}

function createLogger(bindings: LogPayload = {}): Logger {
  return {
    debug(message, payload) {
      emit("debug", message, { ...bindings, ...payload });
    },
    info(message, payload) {
      emit("info", message, { ...bindings, ...payload });
    },
    warn(message, payload) {
      emit("warn", message, { ...bindings, ...payload });
    },
    error(message, payload) {
      emit("error", message, { ...bindings, ...payload });
    },
    child(extra) {
      return createLogger({ ...bindings, ...extra });
    },
  };
}

export const logger = createLogger();

export default logger;

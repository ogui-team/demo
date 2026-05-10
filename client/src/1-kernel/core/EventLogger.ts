export interface LoggedEvent {
  timestamp: number;
  type: string;
  message: string;
  details?: Record<string, unknown>;
}

const MAX_EVENTS = 100;

class EventLogger {
  private events: LoggedEvent[] = [];

  log(type: string, message: string, details?: Record<string, unknown>): void {
    this.events.push({ timestamp: Engine.time.now(), type, message, details });
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  }

  getEvents(): LoggedEvent[] {
    return [...this.events];
  }

  getRecent(limit = 10): LoggedEvent[] {
    return this.events.slice(-Math.max(1, limit));
  }

  clear(): void {
    this.events = [];
  }
}

const logger = new EventLogger();

export function logEvent(type: string, message: string, details?: Record<string, unknown>): void {
  logger.log(type, message, details);
}

export function getLoggedEvents(): LoggedEvent[] {
  return logger.getEvents();
}

export function getRecentEvents(limit = 10): LoggedEvent[] {
  return logger.getRecent(limit);
}

export function clearLoggedEvents(): void {
  logger.clear();
}

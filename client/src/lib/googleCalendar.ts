export interface GoogleCalendarTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const GOOGLE_TOKENS_KEY_PREFIX = "google_calendar_tokens_";

export function getGoogleCalendarStorageKey(userId?: string) {
  if (!userId) return null;
  return `${GOOGLE_TOKENS_KEY_PREFIX}${userId}`;
}

export function loadGoogleCalendarTokens(userId?: string): GoogleCalendarTokens | null {
  const key = getGoogleCalendarStorageKey(userId);
  if (!key || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as GoogleCalendarTokens;
    if (!parsed?.accessToken || !parsed?.expiresAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function saveGoogleCalendarTokens(userId: string | undefined, tokens: GoogleCalendarTokens | null) {
  const key = getGoogleCalendarStorageKey(userId);
  if (!key || typeof window === "undefined") return;

  if (!tokens) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(tokens));
}

export function clearGoogleCalendarTokens(userId?: string) {
  saveGoogleCalendarTokens(userId, null);
}

export async function getGoogleAuthUrl() {
  const response = await fetch("/api/google/auth/url");

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to prepare Google authentication.");
  }

  const data = (await response.json()) as { url: string };
  return data.url;
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const response = await fetch("/api/google/auth/refresh", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to refresh Google access token.");
  }

  const data = (await response.json()) as GoogleCalendarTokens;
  return data;
}

export async function ensureGoogleCalendarTokens(userId?: string) {
  const tokens = loadGoogleCalendarTokens(userId);
  if (!tokens) return null;

  if (Date.now() < tokens.expiresAt - 60_000) {
    return tokens;
  }

  if (!tokens.refreshToken) {
    throw new Error("Google Calendar needs to reconnect because the saved refresh token is missing.");
  }

  const refreshed = await refreshGoogleAccessToken(tokens.refreshToken);
  saveGoogleCalendarTokens(userId, refreshed);
  return refreshed;
}

interface GoogleCalendarSyncResponse {
  success: boolean;
  synced: Array<{ id: string; googleEventId: string }>;
}

interface CalendarEventShape {
  id: string;
  title: string;
  project: string;
  date: string;
  startTime: string;
  endTime: string;
  colorIdx: number;
  source?: "plan" | "manual" | "google";
  pmsId?: string;
  googleEventId?: string;
}

export async function syncCalendarEventsToGoogle(userId: string | undefined, events: CalendarEventShape[]) {
  const tokens = await ensureGoogleCalendarTokens(userId);
  if (!tokens) {
    throw new Error("Google Calendar is not connected.");
  }

  const response = await fetch("/api/google/calendar/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "sync",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      events,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Unable to sync with Google Calendar.");
  }

  const data = (await response.json()) as GoogleCalendarSyncResponse;
  return data.synced;
}

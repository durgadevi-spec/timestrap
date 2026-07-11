// client/src/lib/googleCalendar.ts
//
// Google Calendar connection is now owned entirely by PMS. This module
// no longer stores tokens in localStorage or pushes events to Google
// directly — it just reads read-only status from Timestrap's own
// /api/google/status endpoint (which reads PMS's DB directly) and links
// out to PMS's server to start/manage the actual OAuth connection, since
// only PMS's server holds the Google OAuth client secret.

export interface GoogleStatus {
  connected: boolean;
  googleEmail?: string;
  lastSyncedAt?: string | null;
}

export async function fetchGoogleStatus(employeeCode?: string): Promise<GoogleStatus> {
  if (!employeeCode) return { connected: false };

  const response = await fetch(`/api/google/status?employeeCode=${encodeURIComponent(employeeCode)}`);
  if (!response.ok) {
    throw new Error("Unable to fetch Google Calendar status.");
  }
  return (await response.json()) as GoogleStatus;
}

export async function disconnectGoogle(employeeCode?: string): Promise<void> {
  if (!employeeCode) return;

  const response = await fetch("/api/google/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeCode }),
  });

  if (!response.ok) {
    throw new Error("Unable to disconnect Google Calendar.");
  }
}

// PMS's server is the only thing that can start the OAuth flow (it holds
// the Google client secret). This just builds the URL to send the user to.
// Set VITE_PMS_APP_URL to PMS's public base URL (e.g. https://pms.example.com).
export function getPmsGoogleConnectUrl(employeeCode?: string): string {
  const pmsBaseUrl = (import.meta as any).env?.VITE_PMS_APP_URL || "";
  if (!pmsBaseUrl) {
    throw new Error(
      "VITE_PMS_APP_URL is not configured — set it to PMS's public URL to enable connecting Google Calendar."
    );
  }
  return `${pmsBaseUrl.replace(/\/$/, "")}/api/google/connect`;
}
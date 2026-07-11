// server/pmsCalendarEvents.ts
//
// Reads/writes PMS's `calendar_events` and `google_calendar_accounts` tables
// directly over Postgres (reusing the existing pmsPool connection — same
// approach already used elsewhere in this codebase for projects/tasks).
//
// IDENTITY: PMS's calendar_events.user_id is a foreign key into PMS's OWN
// `users` table (a UUID from PMS's login system) — it is NOT the same as
// Timestrap's own user id. The two apps share identity only through employee
// code:
//   Timestrap `employeeCode`  ==  PMS `employees.emp_code`
//   PMS `users.employee_id`   ->  PMS `employees.id`
// Every function here takes an `employeeCode` and resolves the real PMS
// `users.id` first. If no PMS user account exists for that employee code,
// these functions no-op / return empty rather than writing a user_id that
// doesn't exist in PMS (which would violate PMS's own FK constraint).
//
// SCOPE: two kinds of rows share this table, distinguished by calendar_type:
//   - 'meeting' = "manual" events created directly on the Calendar page
//   - 'task'    = plan-for-the-day tasks (written on plan submission, and
//                 kept in sync on edit/drag/delete from the Calendar page)
// Both are one shared source of truth — PMS's own calendar UI and
// Timestrap's Calendar page both read/write the same rows.
//
// KNOWN GAP: because we write to PMS's DB directly instead of going through
// PMS's own Express routes, PMS's automatic "push new/changed event to
// Google" logic (which lives inside those route handlers) does NOT fire for
// events created here. Google sync for these events will only happen once
// PMS's own sync mechanism (manual "Sync now" on the PMS side, or a future
// poller) picks them up.

import { pmsPool } from "./pmsSupabase";

async function resolvePmsUserId(employeeCode: string): Promise<string | null> {
  if (!employeeCode) return null;
  const result = await pmsPool.query(
    `SELECT u.id FROM users u JOIN employees e ON u.employee_id = e.id WHERE e.emp_code = $1 LIMIT 1`,
    [employeeCode]
  );
  return result.rows[0]?.id || null;
}

export interface PmsCalendarEvent {
  id: string;
  userId: string;
  title: string;
  project: string; // maps to project_title
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  colorIdx: number;
  googleEventId?: string | null;
  source: "manual" | "plan";
  pmsId?: string; // task_id, present for 'task' rows
}

// PMS's color_key column is a free-text string (e.g. "peacock"). Timestrap's
// UI only needs a numeric palette index, so we round-trip it as a plain
// string in that column rather than adding a new column to PMS's table.
const colorIdxToColorKey = (idx: number) => String(idx ?? 0);
const colorKeyToColorIdx = (key: string | null) => {
  const n = Number(key);
  return Number.isFinite(n) ? n : 0;
};

function mapRow(row: any): PmsCalendarEvent {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    project: row.project_title || "",
    date: row.date,
    endDate: row.end_date,
    startTime: row.start_time,
    endTime: row.end_time,
    colorIdx: colorKeyToColorIdx(row.color_key),
    googleEventId: row.google_event_id,
    source: row.calendar_type === "task" ? "plan" : "manual",
    pmsId: row.task_id || undefined,
  };
}

const SELECT_COLUMNS = `id, user_id, title, project_title, date, end_date, start_time, end_time, color_key, google_event_id, calendar_type, task_id`;

// Returns BOTH manual ('meeting') and plan ('task') rows for the day — this
// is the single shared read path both calendar UIs should use.
export async function getCalendarEvents(employeeCode: string, date?: string): Promise<PmsCalendarEvent[]> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return [];

  const params: any[] = [pmsUserId];
  let query = `
    SELECT ${SELECT_COLUMNS}
    FROM calendar_events
    WHERE user_id = $1 AND source = 'app' AND calendar_type IN ('meeting', 'task')
  `;
  if (date) {
    params.push(date);
    query += ` AND date = $2`;
  }
  query += ` ORDER BY start_time ASC`;

  const result = await pmsPool.query(query, params);
  return result.rows.map(mapRow);
}

export async function createCalendarEvent(employeeCode: string, evt: {
  title: string;
  project?: string;
  date: string;
  endDate?: string;
  startTime: string;
  endTime: string;
  colorIdx?: number;
}): Promise<PmsCalendarEvent | null> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return null;

  const query = `
    INSERT INTO calendar_events
      (user_id, title, project_title, date, end_date, start_time, end_time, color_key, calendar_type, source)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'meeting', 'app')
    RETURNING ${SELECT_COLUMNS}
  `;
  const values = [
    pmsUserId,
    evt.title || "Untitled event",
    evt.project || null,
    evt.date,
    evt.endDate || evt.date,
    evt.startTime,
    evt.endTime,
    colorIdxToColorKey(evt.colorIdx ?? 0),
  ];
  const result = await pmsPool.query(query, values);
  return mapRow(result.rows[0]);
}

export async function updateCalendarEvent(id: string, employeeCode: string, evt: {
  title?: string;
  project?: string;
  date?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  colorIdx?: number;
}): Promise<PmsCalendarEvent | null> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return null;

  const query = `
    UPDATE calendar_events
    SET
      title = COALESCE($3, title),
      project_title = COALESCE($4, project_title),
      date = COALESCE($5, date),
      end_date = COALESCE($6, end_date),
      start_time = COALESCE($7, start_time),
      end_time = COALESCE($8, end_time),
      color_key = COALESCE($9, color_key)
    WHERE id = $1 AND user_id = $2 AND source = 'app' AND calendar_type = 'meeting'
    RETURNING ${SELECT_COLUMNS}
  `;
  const values = [
    id,
    pmsUserId,
    evt.title ?? null,
    evt.project ?? null,
    evt.date ?? null,
    evt.endDate ?? null,
    evt.startTime ?? null,
    evt.endTime ?? null,
    evt.colorIdx !== undefined ? colorIdxToColorKey(evt.colorIdx) : null,
  ];
  const result = await pmsPool.query(query, values);
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

export async function deleteCalendarEvent(id: string, employeeCode: string): Promise<boolean> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return false;

  const result = await pmsPool.query(
    `DELETE FROM calendar_events WHERE id = $1 AND user_id = $2 AND source = 'app' AND calendar_type = 'meeting' RETURNING id`,
    [id, pmsUserId]
  );
  return result.rows.length > 0;
}

// ─── Plan-for-the-day events ────────────────────────────────────────────────
// Written on plan submission (POST /api/daily-plans), and kept in sync when
// a plan task is edited/dragged/deleted on the Calendar page. Matched on
// task_id so re-saving updates the same row instead of duplicating it.

export async function upsertPlanCalendarEvent(employeeCode: string, evt: {
  taskId: string;
  title: string;
  project?: string;
  date: string;
  startTime: string;
  endTime: string;
}): Promise<PmsCalendarEvent | null> {
  if (!evt.taskId) return null;
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return null;

  const existing = await pmsPool.query(
    `SELECT id FROM calendar_events WHERE user_id = $1 AND task_id = $2 AND calendar_type = 'task'`,
    [pmsUserId, evt.taskId]
  );

  if (existing.rows.length > 0) {
    const result = await pmsPool.query(
      `UPDATE calendar_events
       SET title = $3, project_title = $4, task_title = $3, date = $5, end_date = $5, start_time = $6, end_time = $7
       WHERE id = $1 AND user_id = $2
       RETURNING ${SELECT_COLUMNS}`,
      [existing.rows[0].id, pmsUserId, evt.title || "Untitled task", evt.project || null, evt.date, evt.startTime, evt.endTime]
    );
    return mapRow(result.rows[0]);
  }

  const result = await pmsPool.query(
    `INSERT INTO calendar_events
       (user_id, title, project_title, date, end_date, start_time, end_time, calendar_type, source, task_id, task_title)
     VALUES ($1, $2, $3, $4, $4, $5, $6, 'task', 'app', $7, $2)
     RETURNING ${SELECT_COLUMNS}`,
    [pmsUserId, evt.title || "Untitled task", evt.project || null, evt.date, evt.startTime, evt.endTime, evt.taskId]
  );
  return mapRow(result.rows[0]);
}

export async function deletePlanCalendarEvent(employeeCode: string, taskId: string): Promise<void> {
  if (!taskId) return;
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return;

  await pmsPool.query(
    `DELETE FROM calendar_events WHERE user_id = $1 AND task_id = $2 AND calendar_type = 'task'`,
    [pmsUserId, taskId]
  );
}

export interface PmsGoogleStatus {
  connected: boolean;
  googleEmail?: string;
  lastSyncedAt?: string | null;
}

export async function getGoogleStatus(employeeCode: string): Promise<PmsGoogleStatus> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return { connected: false };

  const result = await pmsPool.query(
    `SELECT google_email, last_synced_at FROM google_calendar_accounts WHERE user_id = $1`,
    [pmsUserId]
  );
  if (result.rows.length === 0) return { connected: false };
  const row = result.rows[0];
  return { connected: true, googleEmail: row.google_email, lastSyncedAt: row.last_synced_at };
}

export async function disconnectGoogle(employeeCode: string): Promise<void> {
  const pmsUserId = await resolvePmsUserId(employeeCode);
  if (!pmsUserId) return;
  await pmsPool.query(`DELETE FROM google_calendar_accounts WHERE user_id = $1`, [pmsUserId]);
}
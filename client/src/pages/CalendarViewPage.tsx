import { useState, useMemo, useEffect, CSSProperties, useRef } from "react";
import {
  format, addDays, addMonths, subMonths,
  startOfWeek, startOfMonth,
  isSameDay, isSameMonth,
} from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/context/ThemeContext";
import {
  clearGoogleCalendarTokens,
  getGoogleAuthUrl,
  loadGoogleCalendarTokens,
  saveGoogleCalendarTokens,
  syncCalendarEventsToGoogle,
} from "@/lib/googleCalendar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CalendarViewPageProps {
  user?: {
    id?: string;
    role?: string;
    employeeCode?: string;
    department?: string;
  };
}

type CalendarEventSource = "plan" | "manual" | "google";

interface CalendarEvent {
  id: string;
  title: string;
  project: string;
  date: string;
  startTime: string;
  endTime: string;
  colorIdx: number;
  source?: CalendarEventSource;
  pmsId?: string;
  googleEventId?: string;
}

interface ModalState {
  mode: "new" | "edit";
  event: Partial<CalendarEvent>;
}

type ViewMode = "day" | "week" | "month";

interface EventPillProps {
  event: CalendarEvent;
  onClick: (event: CalendarEvent) => void;
  style?: CSSProperties;
  compact?: boolean;
}

interface DayColumnProps {
  day: Date;
  events: CalendarEvent[];
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (event: CalendarEvent) => void;
  isToday: boolean;
  colors?: any;
}

interface WeekGridProps {
  weekDays: Date[];
  events: CalendarEvent[];
  onSlotClick: (day: Date, hour: number) => void;
  onEventClick: (event: CalendarEvent) => void;
  today: Date;
  colors?: any;
}

interface MonthGridProps {
  monthDays: Date[];
  selectedDate: Date;
  events: CalendarEvent[];
  onDayClick: (day: Date) => void;
  today: Date;
  colors?: any;
}

interface MiniCalendarProps {
  value: Date;
  onChange: (day: Date) => void;
  colors?: any;
}

interface EventModalProps {
  event: Partial<CalendarEvent>;
  onClose: () => void;
  onSave: (evt: CalendarEvent) => void;
  onDelete: (id: string) => void;
  mode: "new" | "edit";
  user?: CalendarViewPageProps["user"];
}

interface ProjectOption {
  id: string;
  project_name: string;
  project_code?: string;
}

interface TaskOption {
  id: string;
  task_name: string;
  project_id?: string;
  project_code?: string;
}

const normalizeProjectOption = (candidate: Partial<ProjectOption> & { project_name?: string; project_code?: string }, index: number): ProjectOption => ({
  id: candidate.id || candidate.project_code || `${candidate.project_name || "project"}-${index}`,
  project_name: candidate.project_name || "",
  project_code: candidate.project_code,
});

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKING_HOURS: number[] = Array.from({ length: 15 }, (_, i) => i + 7);

const EVENT_COLORS = [
  { bg: "#1a73e8", light: "#e8f0fe", text: "#1a73e8" },
  { bg: "#0f9d58", light: "#e6f4ea", text: "#0f9d58" },
  { bg: "#f4b400", light: "#fef9e7", text: "#b06000" },
  { bg: "#d93025", light: "#fce8e6", text: "#c5221f" },
  { bg: "#9334e6", light: "#f3e8fd", text: "#7627bb" },
  { bg: "#00897b", light: "#e0f2f1", text: "#00695c" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getManualEventsKey = (userId?: string) => (userId ? `manual_calendar_events_${userId}` : null);

const toMin = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

const toDurationMinutes = (startTime: string, endTime: string) => Math.max(30, toMin(endTime) - toMin(startTime));

const readStoredArray = (key: string | null) => {
  if (!key || typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeEventTitle = (value?: string | null, fallback?: string | null) => {
  const trimmed = value?.trim();
  if (trimmed && trimmed !== "Untitled Task") return trimmed;
  return fallback?.trim() || "Untitled Task";
};

const isPlanTask = (task: any) => {
  return Boolean(
    task?.source === 'plan' ||
    task?.isPlanTask === true ||
    task?.description === 'Scheduled via Plan for Day' ||
    task?.problemAndIssues === 'Auto-filled from daily plan'
  );
};

const buildPlanEvent = (task: any, fallbackDate: string): CalendarEvent => {
  let initialTitle = task.title;
  if (initialTitle === "Untitled Task") initialTitle = null;

  return {
    id: task.id || task.pmsId || `planned-${Math.random().toString(36).slice(2, 8)}`,
    title: normalizeEventTitle(initialTitle || task.task_name || task.taskName || task.taskDescription, task.project || task.projectName || task.project_code),
    project: task.project || task.projectName || task.project_code || "General",
    date: task.date || fallbackDate,
    startTime: task.startTime || "09:00",
    endTime: task.endTime || "10:00",
    colorIdx: 0,
    source: "plan",
    pmsId: task.pmsId || task.taskId || undefined,
    googleEventId: task.googleEventId || undefined,
  };
};

const mergePlanEvents = (tasks: any[], fallbackDate: string) => {
  const map = new Map<string, CalendarEvent>();
  tasks.forEach((task) => {
    const event = buildPlanEvent(task, fallbackDate);
    map.set(event.id, event);
  });
  return Array.from(map.values());
};

const persistManualEvents = (userId: string | undefined, events: CalendarEvent[]) => {
  const key = getManualEventsKey(userId);
  if (!key) return;

  const manualEvents = events.filter((event) => event.source === "manual");
  if (manualEvents.length === 0) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(manualEvents));
};

const persistPlanUpdate = (userId: string | undefined, originalDate: string | undefined, event: CalendarEvent) => {
  if (!userId) return;

  const nextDate = event.date;
  const scheduleKey = `plan_schedule_${userId}_${nextDate}`;
  const scheduleTasks = readStoredArray(scheduleKey);
  const durationMinutes = toDurationMinutes(event.startTime, event.endTime);

  const existingSchedule = scheduleTasks.find((task: any) => task.id === event.id || task.pmsId === event.pmsId);

  const scheduleTask = {
    ...(existingSchedule || {}),
    id: event.id,
    pmsId: event.pmsId,
    task_name: event.title,
    projectName: event.project,
    startTime: event.startTime,
    endTime: event.endTime,
    durationMinutes,
    googleEventId: event.googleEventId,
    scheduleData: {
      ...((existingSchedule || {}).scheduleData || {}),
      startTime: event.startTime,
      endTime: event.endTime,
      durationMinutes,
    },
  };

  const nextScheduleTasks = scheduleTasks.some((task: any) => task.id === event.id || task.pmsId === event.pmsId)
    ? scheduleTasks.map((task: any) => (task.id === event.id || task.pmsId === event.pmsId ? scheduleTask : task))
    : [...scheduleTasks, scheduleTask];

  window.localStorage.setItem(scheduleKey, JSON.stringify(nextScheduleTasks));

  if (originalDate && originalDate !== nextDate) {
    const oldScheduleKey = `plan_schedule_${userId}_${originalDate}`;
    const oldScheduleTasks = readStoredArray(oldScheduleKey);

    window.localStorage.setItem(oldScheduleKey, JSON.stringify(oldScheduleTasks.filter((task: any) => task.id !== event.id && task.pmsId !== event.pmsId)));
  }
};

const removePlanEvent = (userId: string | undefined, date: string | undefined, event: CalendarEvent) => {
  if (!userId || !date) return;

  const scheduleKey = `plan_schedule_${userId}_${date}`;
  const scheduleTasks = readStoredArray(scheduleKey);

  window.localStorage.setItem(scheduleKey, JSON.stringify(scheduleTasks.filter((task: any) => task.id !== event.id && task.pmsId !== event.pmsId)));
};

const fmtHour = (h: number): string => {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
};

// Helper function to calculate available slot duration at target time
const getAvailableSlotDuration = (targetHour: number, dayEvents: CalendarEvent[]): number => {
  const SLOT_END_HOUR = 23;
  
  // Find events that might conflict with starting at targetHour
  const eventsAfter = dayEvents
    .filter((evt) => toMin(evt.startTime) >= targetHour * 60)
    .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));

  if (eventsAfter.length === 0) {
    // No events after this hour, can use until end of day
    return (SLOT_END_HOUR - targetHour) * 60;
  }

  const firstEventAfter = eventsAfter[0];
  const availableMinutes = toMin(firstEventAfter.startTime) - (targetHour * 60);
  
  // Return available duration in minutes (minimum 30 mins)
  return Math.max(30, availableMinutes);
};

// Current Time Indicator Component
function CurrentTimeIndicator({ show = true }: { show?: boolean }) {
  const [currentTime, setCurrentTime] = useState<{ hour: number; minutes: number; percentage: number } | null>(null);

  useEffect(() => {
    if (!show) return;

    const updateTime = () => {
      const now = new Date();
      const hour = now.getHours();
      const minutes = now.getMinutes();
      
      // Only show indicator during working hours (7 AM - 11 PM)
      if (hour >= 7 && hour < 23) {
        const percentage = ((hour - 7) * 60 + minutes) / (16 * 60) * 100;
        setCurrentTime({ hour, minutes, percentage });
      } else {
        setCurrentTime(null);
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [show]);

  if (!currentTime) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: `${currentTime.percentage}%`,
        height: 2,
        background: "#dc2626",
        zIndex: 10,
        boxShadow: "0 0 2px rgba(220, 38, 38, 0.5)",
        transition: "top 0.5s ease-in-out",
      }}
    />
  );
}

// ─── Components ───────────────────────────────────────────────────────────────

function EventPill({ event, onClick, style, compact = false, onDragStart, onDragEnd, onResizeStart }: EventPillProps & { onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; onResizeStart?: (e: React.MouseEvent, mode: "top" | "bottom") => void }) {
  const c = EVENT_COLORS[event.colorIdx ?? 0];
  const dur = toMin(event.endTime) - toMin(event.startTime);
  const [isResizing, setIsResizing] = useState(false);

  const handleResizeStart = (e: React.MouseEvent, mode: "top" | "bottom") => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    onResizeStart?.(e, mode);
  };

  return (
    <div
      draggable={!isResizing}
      onClick={() => onClick(event)}
      onDragStart={(e) => {
        e.dataTransfer!.effectAllowed = "move";
        e.dataTransfer!.setData("application/json", JSON.stringify(event));
        onDragStart?.(e);
      }}
      onDragEnd={() => onDragEnd?.()}
      style={{
        background: c.bg, color: "#fff", borderRadius: 6,
        padding: compact ? "2px 6px" : "4px 8px",
        cursor: "grab", overflow: "hidden", userSelect: "none",
        fontSize: 12, lineHeight: 1.3, boxSizing: "border-box", position: "relative", ...style,
      }}
      onMouseDown={(e) => e.currentTarget.style.cursor = "grabbing"}
      onMouseUp={(e) => e.currentTarget.style.cursor = "grab"}
    >
      {/* Resize handle at the top of the event */}
      {!compact && (
        <div
          onMouseDown={(e) => handleResizeStart(e, "top")}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            cursor: "row-resize",
            background: "rgba(255, 255, 255, 0.3)",
            borderRadius: "6px 6px 0 0",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = "rgba(255, 255, 255, 0.6)";
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255, 255, 255, 0.3)";
            }
          }}
        />
      )}
      <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {event.title}
      </div>
      {!compact && dur > 30 && (
        <div style={{ opacity: 0.85, fontSize: 11, marginTop: 1 }}>
          {event.startTime} – {event.endTime}
        </div>
      )}
      {/* Resize handle at the bottom of the event */}
      {!compact && (
        <div
          onMouseDown={(e) => handleResizeStart(e, "bottom")}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 4,
            cursor: "row-resize",
            background: "rgba(255, 255, 255, 0.3)",
            borderRadius: "0 0 6px 6px",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.background = "rgba(255, 255, 255, 0.6)";
          }}
          onMouseLeave={(e) => {
            if (!isResizing) {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255, 255, 255, 0.3)";
            }
          }}
        />
      )}
    </div>
  );
}

function DayColumn({ day, events, onSlotClick, onEventClick, onDragStart, onDragEnd, onEventDrop, onEventResize, colors }: DayColumnProps & { onDragStart?: (e: React.DragEvent) => void; onDragEnd?: () => void; onEventDrop?: (event: CalendarEvent, targetHour: number) => void; onEventResize?: (event: CalendarEvent, newTime: string, mode: "start" | "end") => void }) {
  const SLOT_H = 48;
  const START_HOUR = 7;
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);
  const [resizingEvent, setResizingEvent] = useState<string | null>(null);
  const [resizeStartY, setResizeStartY] = useState<number>(0);
  const [resizeMode, setResizeMode] = useState<"top" | "bottom" | null>(null);
  const dayContainerRef = useRef<HTMLDivElement>(null);

  // Fallback colors if not provided
  const defaultColors = {
    border: "#e0e0e0",
    lightBorder: "#f0f0f0",
    dragOverBg: "#e8f0ff",
    hoverBg: "#f8f9ff",
  };
  const colorScheme = colors || defaultColors;

  useEffect(() => {
    if (!resizingEvent || !dayContainerRef.current || !resizeMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = dayContainerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const currentY = e.clientY - rect.top;
      const deltaY = currentY - resizeStartY;
      
      const event = events.find((evt) => evt.id === resizingEvent);
      if (!event) return;

      const startMin = toMin(event.startTime);
      const endMin = toMin(event.endTime);
      const deltaMinutes = Math.round((deltaY / SLOT_H) * 60);

      if (resizeMode === "bottom") {
        // Resize end time
        let newEndMin = endMin + deltaMinutes;
        newEndMin = Math.max(startMin + 30, Math.min(newEndMin, 23 * 60 + 59));

        const newEndHours = Math.floor(newEndMin / 60);
        const newEndMins = newEndMin % 60;
        const newEndTime = `${String(newEndHours).padStart(2, '0')}:${String(newEndMins).padStart(2, '0')}`;
        onEventResize?.(event, newEndTime, "end");
      } else if (resizeMode === "top") {
        // Resize start time
        let newStartMin = startMin + deltaMinutes;
        newStartMin = Math.max(7 * 60, Math.min(newStartMin, endMin - 30));

        const newStartHours = Math.floor(newStartMin / 60);
        const newStartMins = newStartMin % 60;
        const newStartTime = `${String(newStartHours).padStart(2, '0')}:${String(newStartMins).padStart(2, '0')}`;
        onEventResize?.(event, newStartTime, "start");
      }

      setResizeStartY(currentY);
    };

    const handleMouseUp = () => {
      setResizingEvent(null);
      setResizeMode(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingEvent, resizeStartY, resizeMode, events, onEventResize]);

  const handleResizeStart = (event: CalendarEvent, e: React.MouseEvent, mode: "top" | "bottom") => {
    setResizingEvent(event.id);
    setResizeMode(mode);
    setResizeStartY(e.clientY - (dayContainerRef.current?.getBoundingClientRect().top || 0));
  };

  const isToday = isSameDay(day, new Date());

  return (
    <div ref={dayContainerRef} style={{ flex: 1, minWidth: 0, position: "relative", borderLeft: `1px solid ${colorScheme.border}` }}>
      <CurrentTimeIndicator show={isToday} />
      {WORKING_HOURS.map((hour) => (
        <div
          key={hour}
          onClick={() => onSlotClick(day, hour)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer!.dropEffect = "move";
            setDragOverHour(hour);
            (e.currentTarget as HTMLDivElement).style.background = colorScheme.dragOverBg;
          }}
          onDragLeave={(e) => {
            setDragOverHour(null);
            (e.currentTarget as HTMLDivElement).style.background = colorScheme.hoverBg;
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverHour(null);
            (e.currentTarget as HTMLDivElement).style.background = "";
            try {
              const data = e.dataTransfer!.getData("application/json");
              console.log(`Drop event at hour ${hour}, data length: ${data.length}`);
              const draggedEvent = JSON.parse(data) as CalendarEvent;
              console.log(`Parsed dragged event:`, draggedEvent);
              if (draggedEvent && onEventDrop) {
                console.log(`Calling onEventDrop with event ${draggedEvent.id} to hour ${hour}`);
                onEventDrop(draggedEvent, hour);
              } else {
                console.log(`Missing draggedEvent or onEventDrop callback`);
              }
            } catch (err) {
              console.error("Drop failed:", err);
            }
          }}
          style={{ height: SLOT_H, borderBottom: `1px solid ${colorScheme.lightBorder}`, boxSizing: "border-box", cursor: "pointer", background: dragOverHour === hour ? colorScheme.dragOverBg : "" }}
          onMouseEnter={(e) => { if (dragOverHour !== hour) (e.currentTarget as HTMLDivElement).style.background = colorScheme.hoverBg; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = dragOverHour === hour ? colorScheme.dragOverBg : ""; }}
        />
      ))}
      {events.map((evt) => {
        const startMin = toMin(evt.startTime);
        const endMin = toMin(evt.endTime);
        const topOffset = ((startMin - START_HOUR * 60) / 60) * SLOT_H;
        const height = Math.max(20, ((endMin - startMin) / 60) * SLOT_H - 2);
        return (
          <EventPill
            key={evt.id}
            event={evt}
            onClick={onEventClick}
            compact={false}
            onDragStart={onDragStart}
            onDragEnd={() => onDragEnd?.()}
            onResizeStart={(e, mode) => handleResizeStart(evt, e, mode)}
            style={{ position: "absolute", left: 2, right: 2, top: topOffset, height, zIndex: 1 }}
          />
        );
      })}
    </div>
  );
}

function WeekGrid({ weekDays, events, onSlotClick, onEventClick, today, onEventDrop, onEventResize, colors }: WeekGridProps & { onEventDrop?: (event: CalendarEvent, targetHour: number) => void; onEventResize?: (event: CalendarEvent, newTime: string, mode: "start" | "end") => void }) {
  const SLOT_H = 48;
  
  // Fallback colors if not provided
  const defaultColors = {
    border: "#e0e0e0",
  };
  const colorScheme = colors || defaultColors;
  return (
    <div style={{ display: "flex", flex: 1, overflow: "auto", position: "relative" }}>
      <div style={{ width: 56, flexShrink: 0 }}>
        <div style={{ height: 20 }} />
        {WORKING_HOURS.map((h) => (
          <div key={h} style={{ height: SLOT_H, boxSizing: "border-box", paddingRight: 8, display: "flex", alignItems: "flex-start", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 11, color: "#70757a", marginTop: -6 }}>{fmtHour(h)}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", borderBottom: `1px solid ${colorScheme.border}`, height: 20 }}>
          {weekDays.map((day) => {
            const dayIsToday = isSameDay(day, today);
            return (
              <div key={day.toISOString()} style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 4, borderLeft: `1px solid ${colorScheme.border}` }}>
                <span style={{ fontSize: 11, color: dayIsToday ? "#1a73e8" : "#70757a" }}>{format(day, "EEE").toUpperCase()}</span>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: dayIsToday ? "#1a73e8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: dayIsToday ? 700 : 400, color: dayIsToday ? "#fff" : "#3c4043" }}>{format(day, "d")}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", flex: 1 }}>
          {weekDays.map((day) => {
            const dayStr = format(day, "yyyy-MM-dd");
            const dayEvts = events.filter((e) => e.date === dayStr);
            return (
              <DayColumn
                key={day.toISOString()}
                day={day}
                events={dayEvts}
                onSlotClick={onSlotClick}
                onEventClick={onEventClick}
                isToday={isSameDay(day, today)}
                onEventDrop={onEventDrop}
                onEventResize={onEventResize}
                colors={colors}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ monthDays, selectedDate, events, onDayClick, today, colors }: MonthGridProps) {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  
  // Fallback colors if not provided
  const defaultColors = {
    border: "#e0e0e0",
    lightBorder: "#f0f0f0",
    selectedBg: "#e8f0fe",
    background: "#fff",
    hoverBg: "#f8f9ff",
  };
  const colorScheme = colors || defaultColors;
  
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: `1px solid ${colorScheme.border}` }}>
        {DAYS.map((d) => (
          <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 500, color: "#70757a" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "minmax(90px, 1fr)" }}>
        {monthDays.map((day) => {
          const dayStr = format(day, "yyyy-MM-dd");
          const dayEvts = events.filter((e) => e.date === dayStr);
          const inMonth = isSameMonth(day, selectedDate);
          const dayIsToday = isSameDay(day, today);
          const isSel = isSameDay(day, selectedDate);
          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              style={{ border: `1px solid ${colorScheme.lightBorder}`, padding: "4px 6px", cursor: "pointer", overflow: "hidden", background: isSel ? colorScheme.selectedBg : colorScheme.background }}
              onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = colorScheme.hoverBg; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = isSel ? colorScheme.selectedBg : colorScheme.background; }}
            >
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 2 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: dayIsToday ? "#1a73e8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 12, color: dayIsToday ? "#fff" : inMonth ? "#3c4043" : "#b0b0b0", fontWeight: dayIsToday ? 700 : 400 }}>
                    {format(day, "d")}
                  </span>
                </div>
              </div>
              {dayEvts.slice(0, 3).map((evt) => (
                <EventPill key={evt.id} event={evt} onClick={() => { }} style={{ marginBottom: 2 }} compact />
              ))}
              {dayEvts.length > 3 && <div style={{ fontSize: 11, color: "#1a73e8", paddingLeft: 2 }}>+{dayEvts.length - 3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniCalendar({ value, onChange, colors }: MiniCalendarProps) {
  const [month, setMonth] = useState<Date>(new Date(value));
  const monthStart = startOfMonth(month);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const days = Array.from({ length: 42 }, (_, i) => addDays(calStart, i));
  const today = new Date();
  
  // Fallback colors if not provided
  const defaultColors = {
    secondaryText: "#70757a",
    text: "#3c4043",
    accentColor: "#1a73e8",
    dragOverBg: "#e8f0fe",
  };
  const colorScheme = colors || defaultColors;

  return (
    <div style={{ padding: "8px 12px", userSelect: "none" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <button onClick={() => setMonth(subMonths(month, 1))} style={{ background: "none", border: "none", cursor: "pointer", color: colorScheme.secondaryText, fontSize: 16, padding: "2px 6px" }}>‹</button>
        <span style={{ fontSize: 13, fontWeight: 500, color: colorScheme.text }}>{format(month, "MMMM yyyy")}</span>
        <button onClick={() => setMonth(addMonths(month, 1))} style={{ background: "none", border: "none", cursor: "pointer", color: colorScheme.secondaryText, fontSize: 16, padding: "2px 6px" }}>›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 28px)", gap: 0, justifyContent: "center" }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: colorScheme.secondaryText, height: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>{d}</div>
        ))}
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          const isSel = isSameDay(day, value);
          const inMonth = isSameMonth(day, month);
          return (
            <div
              key={day.toISOString()}
              onClick={() => { onChange(day); setMonth(day); }}
              style={{
                width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 12,
                background: isSel ? colorScheme.accentColor : isToday ? colorScheme.dragOverBg : "transparent",
                color: isSel ? "#fff" : isToday ? colorScheme.accentColor : inMonth ? colorScheme.text : colorScheme.secondaryText,
                fontWeight: isSel || isToday ? 600 : 400,
              }}
            >{format(day, "d")}</div>
          );
        })}
      </div>
    </div>
  );
}

function EventModal({ event, onClose, onSave, onDelete, mode, user }: EventModalProps) {
  const [title, setTitle] = useState<string>(event?.title === "Untitled Task" ? "" : (event?.title || ""));
  const [project, setProject] = useState<string>(event?.project || "");
  const [date, setDate] = useState<string>(event?.date || format(new Date(), "yyyy-MM-dd"));
  const [start, setStart] = useState<string>(event?.startTime || "09:00");
  const [end, setEnd] = useState<string>(event?.endTime || "10:00");
  const [colorIdx, setColorIdx] = useState<number>(event?.colorIdx ?? 0);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [selectedProjectCode, setSelectedProjectCode] = useState<string>("");
  const [selectedTaskId, setSelectedTaskId] = useState<string>(event?.pmsId || "");
  const [loadingProjects, setLoadingProjects] = useState<boolean>(false);
  const [loadingTasks, setLoadingTasks] = useState<boolean>(false);

  const dur = Math.max(0, toMin(end) - toMin(start));

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    let isMounted = true;
    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const params = new URLSearchParams({
          userRole: user.role || "",
          userEmpCode: user.employeeCode || "",
          userDepartment: user.department || "",
        });

        const response = await fetch(`/api/projects?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Unable to load projects");
        }

        const data = await response.json();
        if (!isMounted) return;

        const nextProjects = Array.isArray(data)
          ? data.map((candidate: Partial<ProjectOption> & { project_name?: string; project_code?: string }, index: number) =>
              normalizeProjectOption(candidate, index)
            )
          : [];
        setProjects(nextProjects);
      } catch {
        if (isMounted) {
          setProjects([]);
          setSelectedProjectId("");
          setSelectedProjectCode("");
        }
      } finally {
        if (isMounted) {
          setLoadingProjects(false);
        }
      }
    };

    loadProjects();

    return () => {
      isMounted = false;
    };
  }, [user?.department, user?.employeeCode, user?.id, user?.role]);

  useEffect(() => {
    const matchedProject = projects.find((candidate) => candidate.project_name === project || candidate.project_code === project);
    if (matchedProject) {
      setSelectedProjectId(matchedProject.id);
      setSelectedProjectCode(matchedProject.project_code || "");
      return;
    }

    setSelectedProjectId("");
    setSelectedProjectCode("");
  }, [project, projects]);

  useEffect(() => {
    if (!selectedProjectCode) {
      setTasks([]);
      setSelectedTaskId("");
      return;
    }

    let isMounted = true;
    const loadTasks = async () => {
      setLoadingTasks(true);
      try {
        const params = new URLSearchParams({
          projectId: selectedProjectCode,
          userDepartment: user?.department || "",
          userEmpCode: user?.employeeCode || "",
          userRole: user?.role || "",
        });

        const response = await fetch(`/api/tasks?${params.toString()}`);
        if (!response.ok) {
          throw new Error("Unable to load tasks");
        }

        const data = await response.json();
        if (!isMounted) return;

        const nextTasks = Array.isArray(data) ? data : [];
        setTasks(nextTasks);

        if (event?.pmsId && nextTasks.some((task) => task.id === event.pmsId)) {
          setSelectedTaskId(event.pmsId);
        } else if (nextTasks.length > 0 && !selectedTaskId) {
          setSelectedTaskId("");
        }
      } catch {
        if (isMounted) {
          setTasks([]);
        }
      } finally {
        if (isMounted) {
          setLoadingTasks(false);
        }
      }
    };

    loadTasks();

    return () => {
      isMounted = false;
    };
  }, [event?.pmsId, selectedProjectCode, selectedTaskId, user?.department, user?.employeeCode]);

  const handleProjectChange = (nextProject: string) => {
    setProject(nextProject);

    const matchedProject = projects.find((candidate) => candidate.project_name === nextProject || candidate.project_code === nextProject);
    if (matchedProject) {
      setSelectedProjectId(matchedProject.id);
      setSelectedProjectCode(matchedProject.project_code || "");
      setProject(matchedProject.project_name);
      setSelectedTaskId("");
      return;
    }

    setSelectedProjectId("");
    setSelectedProjectCode("");
    setTasks([]);
    setSelectedTaskId("");
  };

  const handleTaskChange = (nextTaskId: string) => {
    setSelectedTaskId(nextTaskId);
    const selectedTask = tasks.find((task) => task.id === nextTaskId);
    if (selectedTask) {
      setTitle(selectedTask.task_name);
      const matchedProject = projects.find((candidate) =>
        candidate.id === selectedTask.project_id || candidate.project_code === selectedTask.project_code
      );
      setProject(matchedProject?.project_name || project);
    }
  };

  const selectedTask = tasks.find((task) => task.id === selectedTaskId);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, width: 480, maxWidth: "95vw", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>
        <div style={{ background: EVENT_COLORS[colorIdx].bg, padding: "20px 24px 16px", color: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selectedTask ? "Task title" : "Add title"}
              style={{ background: "transparent", border: "none", borderBottom: "1px solid rgba(255,255,255,0.5)", color: "#fff", fontSize: 22, fontWeight: 400, outline: "none", width: "100%", marginRight: 12, paddingBottom: 4 }}
            />
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "#fff", fontSize: 18, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {EVENT_COLORS.map((c, i) => (
              <div key={i} onClick={() => setColorIdx(i)} style={{ width: 20, height: 20, borderRadius: "50%", background: c.bg, border: i === colorIdx ? "2px solid white" : "2px solid transparent", cursor: "pointer" }} />
            ))}
          </div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>PROJECT</label>
            <input
              value={project}
              onChange={(e) => handleProjectChange(e.target.value)}
              list="calendar-project-options"
              placeholder="Select or type a project"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 12px", fontSize: 14, outline: "none" }}
            />
            <datalist id="calendar-project-options">
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.project_name} />
              ))}
            </datalist>
            {loadingProjects && (
              <div style={{ fontSize: 12, color: "#70757a", marginTop: 6 }}>Loading projects…</div>
            )}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>TASK</label>
            <select
              value={selectedTaskId}
              onChange={(e) => handleTaskChange(e.target.value)}
              disabled={!selectedProjectId || loadingTasks}
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 12px", fontSize: 14, outline: "none", background: "#fff" }}
            >
              <option value="">{selectedProjectId ? "Select a task (optional)" : "Choose a project to load tasks"}</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>{task.task_name}</option>
              ))}
            </select>
            {loadingTasks && (
              <div style={{ fontSize: 12, color: "#70757a", marginTop: 6 }}>Loading tasks…</div>
            )}
            {!selectedProjectId && (
              <div style={{ fontSize: 12, color: "#70757a", marginTop: 6 }}>Pick a project to see available tasks.</div>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>DATE</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>START</label>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "#5f6368", display: "block", marginBottom: 4 }}>END</label>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e0", borderRadius: 6, padding: "8px 10px", fontSize: 13, outline: "none" }} />
            </div>
          </div>
          {dur > 0 && (
            <div style={{ fontSize: 12, color: "#70757a", marginBottom: 16 }}>
              Duration: {Math.floor(dur / 60) > 0 ? `${Math.floor(dur / 60)}h ` : ""}{dur % 60 > 0 ? `${dur % 60}m` : ""}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            {mode === "edit" && event.id ? (
              <button onClick={() => onDelete(event.id!)} style={{ background: "none", border: "none", color: "#d93025", cursor: "pointer", fontSize: 13, padding: "8px 0" }}>Delete event</button>
            ) : <div />}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={onClose} style={{ padding: "8px 20px", border: "1px solid #dadce0", borderRadius: 6, background: "white", cursor: "pointer", fontSize: 14, color: "#3c4043" }}>Cancel</button>
              <button
                onClick={() => onSave({ id: event?.id || String(Date.now()), title, project, date, startTime: start, endTime: end, colorIdx, source: event?.source || "manual", pmsId: selectedTask?.id || event?.pmsId })}
                style={{ padding: "8px 20px", border: "none", borderRadius: 6, background: "#1a73e8", color: "#fff", cursor: "pointer", fontSize: 14, fontWeight: 500 }}
              >Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CalendarViewPage({ user }: CalendarViewPageProps) {
  const { toast } = useToast();
  const { isDark } = useTheme();
  
  // Theme-aware colors
  const colors = {
    background: isDark ? "#1a1a1a" : "#fff",
    text: isDark ? "#ffffff" : "#3c4043",
    secondaryText: isDark ? "#b0b0b0" : "#70757a",
    border: isDark ? "#404040" : "#e0e0e0",
    lightBorder: isDark ? "#333333" : "#f0f0f0",
    hoverBg: isDark ? "#2a2a2a" : "#f8f9ff",
    dragOverBg: isDark ? "#1f3a7a" : "#e8f0ff",
    selectedBg: isDark ? "#1f2a5c" : "#e8f0fe",
    buttonBg: isDark ? "#303030" : "#fff",
    buttonBorder: isDark ? "#555555" : "#dadce0",
    accentColor: "#1a73e8",
  };
  
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [googleConnected, setGoogleConnected] = useState<boolean>(false);
  const [googleStatus, setGoogleStatus] = useState<string>("Not connected");
  const [googleSyncing, setGoogleSyncing] = useState<boolean>(false);
  const [autoSync, setAutoSync] = useState<boolean>(false);
  const [draggedEvent, setDraggedEvent] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const targetDate = format(selectedDate, "yyyy-MM-dd");
    const manualEvents = readStoredArray(getManualEventsKey(user?.id)).map((event: any) => ({
      ...event,
      title: normalizeEventTitle(event.title, event.project),
      source: "manual" as const,
    }));

    const scheduleKey = `plan_schedule_${user?.id}_${targetDate}`;
    const scheduleTasks = readStoredArray(scheduleKey);
    const legacyPlanTasks = readStoredArray(`pendingTasks_${user?.id}_${targetDate}`).filter(isPlanTask);
    const planEvents = mergePlanEvents(scheduleTasks.length > 0 ? scheduleTasks : legacyPlanTasks, targetDate);

    const mergedEvents = [...manualEvents, ...planEvents];
    const unique = Array.from(new Map(mergedEvents.map((event) => [event.id, event])).values());
    setEvents(unique);
  }, [selectedDate, user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedTokens = loadGoogleCalendarTokens(user?.id);
    setGoogleConnected(Boolean(storedTokens));
    setGoogleStatus(storedTokens ? "Connected to Google Calendar" : "Not connected");

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "GOOGLE_CALENDAR_CONNECTED") return;

      saveGoogleCalendarTokens(user?.id, event.data.tokens);
      setGoogleConnected(true);
      setGoogleStatus("Connected to Google Calendar");
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [user?.id]);

  const weekDays = useMemo<Date[]>(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

  const monthDays = useMemo<Date[]>(() => {
    const monthStart = startOfMonth(selectedDate);
    const start = startOfWeek(monthStart, { weekStartsOn: 0 });
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

  const filteredEvents = useMemo<CalendarEvent[]>(() => {
    if (!searchTerm.trim()) return events;
    const kw = searchTerm.toLowerCase();
    return events.filter((e) => `${e.title} ${e.project}`.toLowerCase().includes(kw));
  }, [events, searchTerm]);

  const navigate = (dir: number): void => {
    if (viewMode === "day") setSelectedDate((d) => addDays(d, dir));
    else if (viewMode === "week") setSelectedDate((d) => addDays(d, dir * 7));
    else setSelectedDate((d) => (dir > 0 ? addMonths(d, 1) : subMonths(d, 1)));
  };

  const openNew = (date: Date, hour: number): void => {
    setModal({
      mode: "new",
      event: {
        date: format(date, "yyyy-MM-dd"),
        startTime: `${String(hour).padStart(2, "0")}:00`,
        endTime: `${String(hour + 1).padStart(2, "0")}:00`,
        colorIdx: 0,
        source: "manual",
      },
    });
  };

  const openEdit = (event: CalendarEvent): void => {
    setModal({ mode: "edit", event });
  };

  const syncEventToTimeEntry = async (event: CalendarEvent) => {
    if (!user?.id) return;
    try {
      await fetch('/api/time-entries/sync-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: user.id, event })
      });
    } catch (err) {
      console.error("Failed to sync event to time entries:", err);
    }
  };

  const handleEventDrop = (draggedEvent: CalendarEvent, targetHour: number): void => {
    console.log(`handleEventDrop called with event:`, draggedEvent, `targetHour:`, targetHour);
    console.log(`Dragged event has googleEventId: ${draggedEvent.googleEventId}`);
    if (!draggedEvent || !draggedEvent.id) {
      console.log(`Missing event or event ID`);
      return;
    }

    // Get events on the target day to calculate available slot
    const targetDate = draggedEvent.date;
    const dayEventsOnTarget = events.filter((e) => e.date === targetDate && e.id !== draggedEvent.id);
    
    // Calculate available slot duration at the target time
    const availableMinutes = getAvailableSlotDuration(targetHour, dayEventsOnTarget);
    
    // Get the original task duration
    const originalDurationMinutes = toMin(draggedEvent.endTime) - toMin(draggedEvent.startTime);
    
    // Use the smaller of: original duration or available slot
    const newDurationMinutes = Math.min(originalDurationMinutes, availableMinutes);
    
    const newStartMinutes = targetHour * 60;
    const newEndMinutes = Math.min(23 * 60 + 59, newStartMinutes + newDurationMinutes);
    
    const newStartTime = `${String(targetHour).padStart(2, '0')}:00`;
    const newEndHours = Math.floor(newEndMinutes / 60);
    const newEndMins = newEndMinutes % 60;
    const newEndTime = `${String(newEndHours).padStart(2, '0')}:${String(newEndMins).padStart(2, '0')}`;

    const updatedEvent = {
      ...draggedEvent,
      startTime: newStartTime,
      endTime: newEndTime,
    };

    console.log(`Updated event:`, updatedEvent);
    console.log(`Original duration: ${originalDurationMinutes} mins, Available slot: ${availableMinutes} mins, New duration: ${newDurationMinutes} mins`);
    console.log(`Updated event has googleEventId: ${updatedEvent.googleEventId}`);
    const updatedEvents = events.map((e) => (e.id === draggedEvent.id ? updatedEvent : e));
    setEvents(updatedEvents);
    setDraggedEvent(null);

    if (updatedEvent.source === "manual") {
      console.log(`Persisting manual events with googleEventId: ${updatedEvent.googleEventId}`);
      persistManualEvents(user?.id, updatedEvents.filter((e) => e.source === "manual"));
    } else if (updatedEvent.source === "plan") {
      console.log(`Persisting plan update with googleEventId: ${updatedEvent.googleEventId}`);
      persistPlanUpdate(user?.id, updatedEvent.date, updatedEvent);
    }

    syncEventToTimeEntry(updatedEvent);

    const durationChangeMsg = newDurationMinutes < originalDurationMinutes 
      ? ` (duration adjusted from ${originalDurationMinutes} to ${newDurationMinutes} minutes to fit available slot)` 
      : "";
    
    toast({
      title: "✅ Event Moved",
      description: `${updatedEvent.title} moved to ${newStartTime}–${newEndTime}${durationChangeMsg}`,
    });
    console.log(`Event drop completed`);
  };

  const handleEventResize = (event: CalendarEvent, newTime: string, mode: "start" | "end" = "end"): void => {
    const startMin = toMin(event.startTime);
    const endMin = toMin(event.endTime);

    let updatedEvent: CalendarEvent;

    if (mode === "end") {
      const newEndMin = toMin(newTime);

      // Validate: minimum 30 minutes
      if (newEndMin - startMin < 30) {
        toast({
          title: "⚠️ Invalid Duration",
          description: "Task duration must be at least 30 minutes",
          variant: "destructive",
        });
        return;
      }

      updatedEvent = {
        ...event,
        endTime: newTime,
      };

      syncEventToTimeEntry(updatedEvent);

      const newDurationMinutes = newEndMin - startMin;
      toast({
        title: "✅ Event Resized",
        description: `${updatedEvent.title} resized to ${newDurationMinutes} minutes (${event.startTime}–${newTime})`,
      });
    } else {
      // mode === "start"
      const newStartMin = toMin(newTime);

      // Validate: minimum 30 minutes
      if (endMin - newStartMin < 30) {
        toast({
          title: "⚠️ Invalid Duration",
          description: "Task duration must be at least 30 minutes",
          variant: "destructive",
        });
        return;
      }

      updatedEvent = {
        ...event,
        startTime: newTime,
      };

      syncEventToTimeEntry(updatedEvent);

      const newDurationMinutes = endMin - newStartMin;
      toast({
        title: "✅ Event Resized",
        description: `${updatedEvent.title} resized to ${newDurationMinutes} minutes (${newTime}–${event.endTime})`,
      });
    }

    const updatedEvents = events.map((e) => (e.id === event.id ? updatedEvent : e));
    setEvents(updatedEvents);

    if (updatedEvent.source === "manual") {
      persistManualEvents(user?.id, updatedEvents.filter((e) => e.source === "manual"));
    } else if (updatedEvent.source === "plan") {
      persistPlanUpdate(user?.id, updatedEvent.date, updatedEvent);
    }
  };

  const connectGoogleCalendar = async () => {
    if (!user?.id) {
      setGoogleStatus("Sign in to connect Google Calendar.");
      return;
    }

    try {
      const authUrl = await getGoogleAuthUrl();
      const popup = window.open(authUrl, "timestrap-google-calendar", "width=520,height=700");
      if (!popup) {
        setGoogleStatus("Popup blocked. Please allow popups and try again.");
        return;
      }

      setGoogleStatus("Waiting for Google authorization...");
      const poll = window.setInterval(() => {
        if (popup.closed) {
          window.clearInterval(poll);
          setGoogleStatus(loadGoogleCalendarTokens(user.id) ? "Connected to Google Calendar" : "Not connected");
        }
      }, 500);
    } catch {
      setGoogleStatus("Unable to connect Google Calendar.");
    }
  };

  const disconnectGoogleCalendar = () => {
    clearGoogleCalendarTokens(user?.id);
    setGoogleConnected(false);
    setGoogleStatus("Not connected");
  };

  const syncGoogleCalendar = async () => {
    if (!user?.id) {
      setGoogleStatus("Sign in to sync Google Calendar.");
      return;
    }

    if (!googleConnected) {
      setGoogleStatus("Connect Google Calendar first.");
      return;
    }

    const syncableEvents = events
      .filter((event) => event.source !== "google")
      .map((event) => ({
        ...event,
        title: normalizeEventTitle(event.title, event.project),
      }));
    console.log(`Found ${syncableEvents.length} syncable events`);
    syncableEvents.forEach(evt => {
      console.log(`  - ${evt.title} (${evt.startTime}-${evt.endTime}) googleEventId: ${evt.googleEventId || 'NONE'}`);
    });
    
    // Track events with googleEventId (for detecting deleted events)
    const eventsWithGoogleId = syncableEvents.filter(e => e.googleEventId);
    const eventsWithoutGoogleId = syncableEvents.filter(e => !e.googleEventId);
    console.log(`  Events with existing googleEventId (may have been deleted from Google): ${eventsWithGoogleId.length}`);
    console.log(`  Events without googleEventId (new): ${eventsWithoutGoogleId.length}`);
    if (syncableEvents.length === 0) {
      setGoogleStatus("No events to sync.");
      return;
    }

    setGoogleSyncing(true);
    setGoogleStatus("Syncing to Google Calendar...");

    try {
      const synced = await syncCalendarEventsToGoogle(user.id, syncableEvents);
      const syncedMap = new Map(synced.map((item) => [item.id, item.googleEventId]));
      const nextEvents = events.map((event) => {
        const googleEventId = syncedMap.get(event.id);
        return googleEventId ? { ...event, googleEventId } : event;
      });

      setEvents(nextEvents);
      persistManualEvents(user?.id, nextEvents.filter((event) => event.source === "manual"));
      nextEvents.filter((event) => event.source === "plan").forEach((event) => {
        persistPlanUpdate(user?.id, events.find((current) => current.id === event.id)?.date, event);
      });
      const syncedCount = synced.length;
      setGoogleStatus("Synced to Google Calendar.");
      toast({
        title: "✅ Sync Complete",
        description: `Successfully synced ${syncedCount} event${syncedCount !== 1 ? 's' : ''} to Google Calendar.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to sync Google Calendar.";
      setGoogleStatus(message);
      toast({
        title: "❌ Sync Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setGoogleSyncing(false);
    }
  };

  // Auto-sync: trigger syncGoogleCalendar every 5 seconds when enabled
  useEffect(() => {
    if (!autoSync || !googleConnected || !user?.id) return;
    // Sync immediately on enable
    syncGoogleCalendar();
    const interval = setInterval(() => {
      syncGoogleCalendar();
    }, 5 * 1000);
    return () => clearInterval(interval);
  }, [autoSync, googleConnected, user?.id]);

  const saveEvent = (evt: CalendarEvent): void => {
    const existingEvent = events.find((event) => event.id === evt.id);
    const normalizedTitle = normalizeEventTitle(evt.title, evt.project);
    const nextEvent = existingEvent
      ? { ...evt, title: normalizedTitle, googleEventId: existingEvent.googleEventId, source: evt.source || existingEvent.source }
      : { ...evt, title: normalizedTitle };
    const nextEvents = existingEvent
      ? events.map((event) => (event.id === evt.id ? nextEvent : event))
      : [...events, nextEvent];

    setEvents(nextEvents);

    if (nextEvent.source === "manual") {
      persistManualEvents(user?.id, nextEvents);
    } else if (nextEvent.source === "plan") {
      persistPlanUpdate(user?.id, existingEvent?.date, nextEvent);
    }

    syncEventToTimeEntry(nextEvent);

    setModal(null);
  };

  const deleteEvent = (id: string): void => {
    const target = events.find((event) => event.id === id);

    if (!target) {
      setEvents((prev) => prev.filter((event) => event.id !== id));
      setModal(null);
      return;
    }

    const nextEvents = events.filter((event) => event.id !== id);
    setEvents(nextEvents);

    if (target.source === "manual") {
      persistManualEvents(user?.id, nextEvents);
    } else if (target.source === "plan") {
      removePlanEvent(user?.id, target.date, target);
    }

    setModal(null);
  };

  const headerLabel =
    viewMode === "month"
      ? format(selectedDate, "MMMM yyyy")
      : viewMode === "week"
        ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], isSameMonth(weekDays[0], weekDays[6]) ? "d, yyyy" : "MMM d, yyyy")}`
        : format(selectedDate, "EEEE, MMMM d, yyyy");

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Google Sans', Roboto, sans-serif", background: colors.background, color: colors.text, overflow: "hidden" }}>
      {/* Sidebar */}
      {sidebarOpen && (
        <div style={{ width: 256, borderRight: `1px solid ${colors.border}`, display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
          <div style={{ padding: "12px 16px" }}>
            <button
              onClick={() => openNew(today, 9)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px 10px 14px", border: "none", borderRadius: 24, background: colors.buttonBg, boxShadow: "0 1px 3px rgba(0,0,0,0.2)", cursor: "pointer", fontSize: 14, color: colors.text, fontWeight: 500 }}
            >
              <span style={{ fontSize: 22, color: colors.accentColor, fontWeight: 300, lineHeight: 1 }}>+</span>
              Create
            </button>
          </div>

          <MiniCalendar value={selectedDate} onChange={setSelectedDate} colors={colors} />

          <div style={{ padding: "8px 16px" }}>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search events…"
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${colors.border}`, borderRadius: 20, padding: "7px 14px", fontSize: 13, outline: "none", color: colors.text, background: colors.background }}
            />
          </div>

          <div style={{ padding: "8px 16px", borderTop: `1px solid ${colors.border}`, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.secondaryText, marginBottom: 8, letterSpacing: "0.05em" }}>GOOGLE CALENDAR</div>
            <div style={{ fontSize: 12, color: colors.text, marginBottom: 8, lineHeight: 1.4 }}>{googleStatus}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={googleConnected ? disconnectGoogleCalendar : connectGoogleCalendar}
                disabled={!user?.id}
                style={{
                  border: `1px solid ${colors.buttonBorder}`,
                  borderRadius: 6,
                  background: googleConnected ? colors.buttonBg : colors.accentColor,
                  color: googleConnected ? colors.text : "#fff",
                  padding: "8px 12px",
                  cursor: user?.id ? "pointer" : "not-allowed",
                  fontSize: 13,
                  fontWeight: 500,
                  opacity: user?.id ? 1 : 0.7,
                }}
              >
                {googleConnected ? "Disconnect Google" : "Connect Google Calendar"}
              </button>
              <button
                onClick={syncGoogleCalendar}
                disabled={!googleConnected || googleSyncing}
                style={{
                  border: `1px solid ${colors.buttonBorder}`,
                  borderRadius: 6,
                  background: googleConnected ? "#0f9d58" : colors.hoverBg,
                  color: googleConnected ? "#fff" : colors.secondaryText,
                  padding: "8px 12px",
                  cursor: googleConnected && !googleSyncing ? "pointer" : "not-allowed",
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {googleSyncing ? "Syncing..." : "Sync schedules"}
              </button>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: colors.text,
                  cursor: googleConnected ? "pointer" : "not-allowed",
                  opacity: googleConnected ? 1 : 0.5,
                  padding: "4px 0",
                }}
              >
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={(e) => setAutoSync(e.target.checked)}
                  disabled={!googleConnected}
                  style={{ accentColor: colors.accentColor, width: 16, height: 16 }}
                />
                Auto-sync every 5 sec
              </label>
            </div>
          </div>

          <div style={{ padding: "8px 16px", borderTop: `1px solid ${colors.border}`, marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.secondaryText, marginBottom: 8, letterSpacing: "0.05em" }}>MY CALENDARS</div>
            {["Work", "Personal", "Meetings", "Deadlines"].map((cal, i) => (
              <div key={cal} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: EVENT_COLORS[i].bg }} />
                {cal}
              </div>
            ))}
          </div>

          <div style={{ padding: "8px 16px 16px", borderTop: "1px solid #e0e0e0", marginTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "#70757a", marginBottom: 8, letterSpacing: "0.05em" }}>UPCOMING</div>
            {filteredEvents.slice(0, 5).map((evt) => (
              <div key={evt.id} onClick={() => openEdit(evt)} style={{ padding: "6px 0", borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: EVENT_COLORS[evt.colorIdx ?? 0].bg, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{evt.title}</span>
                </div>
                <div style={{ fontSize: 11, color: "#70757a", marginTop: 2, paddingLeft: 14 }}>{evt.date} · {evt.startTime}–{evt.endTime}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", height: 56, padding: "0 16px", borderBottom: `1px solid ${colors.border}`, gap: 8, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen((o) => !o)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.secondaryText, fontSize: 20, padding: "6px", borderRadius: "50%", display: "flex" }}>☰</button>

          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: colors.accentColor, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>📅</span>
            </div>
            <span style={{ fontSize: 18, color: colors.text, fontWeight: 400 }}>Calendar</span>
          </div>

          <button onClick={() => setSelectedDate(today)} style={{ marginLeft: 16, padding: "6px 14px", border: `1px solid ${colors.buttonBorder}`, borderRadius: 6, background: colors.buttonBg, cursor: "pointer", fontSize: 13, color: colors.text }}>Today</button>
          <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.secondaryText, fontSize: 20, padding: "4px 6px" }}>‹</button>
          <button onClick={() => navigate(1)} style={{ background: "none", border: "none", cursor: "pointer", color: colors.secondaryText, fontSize: 20, padding: "4px 6px" }}>›</button>

          <h2 style={{ fontSize: 20, fontWeight: 400, color: colors.text, margin: 0, flex: 1 }}>{headerLabel}</h2>

          <div style={{ display: "flex", border: `1px solid ${colors.buttonBorder}`, borderRadius: 6, overflow: "hidden" }}>
            {(["day", "week", "month"] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: "6px 14px", border: "none", cursor: "pointer", fontSize: 13,
                  background: viewMode === mode ? colors.dragOverBg : colors.buttonBg,
                  color: viewMode === mode ? colors.accentColor : colors.text,
                  fontWeight: viewMode === mode ? 600 : 400,
                  borderRight: mode !== "month" ? "1px solid #dadce0" : "none",
                }}
              >{mode.charAt(0).toUpperCase() + mode.slice(1)}</button>
            ))}
          </div>
        </div>

        {/* Calendar body */}
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {viewMode === "week" && (
            <WeekGrid weekDays={weekDays} events={filteredEvents} onSlotClick={openNew} onEventClick={openEdit} today={today} onEventDrop={handleEventDrop} onEventResize={handleEventResize} colors={colors} />
          )}

          {viewMode === "day" && (
            <div style={{ display: "flex", flex: 1, overflow: "auto" }}>
              <div style={{ width: 56, flexShrink: 0 }}>
                <div style={{ height: 40 }} />
                {WORKING_HOURS.map((h) => (
                  <div key={h} style={{ height: 48, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", paddingRight: 8 }}>
                    <span style={{ fontSize: 11, color: colors.secondaryText, marginTop: -6 }}>{fmtHour(h)}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ height: 40, borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", paddingLeft: 16, gap: 8 }}>
                  <span style={{ fontSize: 13, color: isSameDay(selectedDate, today) ? colors.accentColor : colors.secondaryText }}>{format(selectedDate, "EEE").toUpperCase()}</span>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: isSameDay(selectedDate, today) ? colors.accentColor : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontWeight: isSameDay(selectedDate, today) ? 700 : 400, color: isSameDay(selectedDate, today) ? "#fff" : colors.text }}>{format(selectedDate, "d")}</span>
                  </div>
                </div>
                <DayColumn
                  day={selectedDate}
                  events={filteredEvents.filter((e) => e.date === format(selectedDate, "yyyy-MM-dd"))}
                  onSlotClick={openNew}
                  onEventClick={openEdit}
                  onEventDrop={handleEventDrop}
                  onEventResize={handleEventResize}
                  isToday={isSameDay(selectedDate, today)}
                  colors={colors}
                />
              </div>
            </div>
          )}

          {viewMode === "month" && (
            <MonthGrid monthDays={monthDays} selectedDate={selectedDate} events={filteredEvents} onDayClick={setSelectedDate} today={today} colors={colors} />
          )}
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <EventModal
          event={modal.event}
          mode={modal.mode}
          onClose={() => setModal(null)}
          onSave={saveEvent}
          onDelete={deleteEvent}
          user={user}
        />
      )}
    </div>
  );
}

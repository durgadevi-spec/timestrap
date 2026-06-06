import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { pool } from "../db";
import { pmsPool } from "../pmsSupabase";
import { lmsPool } from "../lmsSupabase";

// Ensure reports directory exists
const reportsDir = path.join(process.cwd(), "reports");
if (!fs.existsSync(reportsDir)) {
  fs.mkdirSync(reportsDir, { recursive: true });
}

function formatDate(d: any): string {
  if (!d) return "N/A";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return d;
  }
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "N/A";
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  } catch {
    return "N/A";
  }
}

function generateFileName(reportType: string, format: string): string {
  const timestamp = Date.now();
  return `${reportType}_${timestamp}.${format}`;
}

// ── EXCEL HELPERS ────────────────────────────────────────────────────────────

function styleHeader(sheet: ExcelJS.Worksheet, columns: string[]) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4F46E5" } };
  headerRow.alignment = { horizontal: "center" };
  sheet.columns = columns.map((col) => ({
    header: col,
    key: col.toLowerCase().replace(/ /g, "_"),
    width: 22,
  }));
}

// ── PDF HELPERS ──────────────────────────────────────────────────────────────

function createPDFDoc(title: string, subtitle: string): { doc: PDFKit.PDFDocument; filePath: string } {
  const fileName = generateFileName(title.replace(/ /g, "_"), "pdf");
  const filePath = path.join(reportsDir, fileName);
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(fs.createWriteStream(filePath));

  // Header
  doc.rect(0, 0, doc.page.width, 80).fill("#4F46E5");
  doc.fillColor("#FFFFFF").fontSize(20).font("Helvetica-Bold")
    .text(title, 40, 20, { align: "left" });
  doc.fontSize(11).font("Helvetica")
    .text(subtitle, 40, 50, { align: "left" });
  doc.fillColor("#000000").moveDown(3);

  return { doc, filePath };
}

function pdfTableRow(doc: PDFKit.PDFDocument, cols: string[], isHeader = false) {
  const colWidth = (doc.page.width - 80) / cols.length;
  const y = doc.y;
  if (isHeader) {
    doc.rect(40, y - 4, doc.page.width - 80, 20).fill("#E0E7FF");
    doc.fillColor("#1E1B4B");
  } else {
    doc.fillColor("#111827");
  }
  cols.forEach((col, i) => {
    doc.fontSize(isHeader ? 9 : 8.5)
      .font(isHeader ? "Helvetica-Bold" : "Helvetica")
      .text(col || "N/A", 40 + i * colWidth, y, {
        width: colWidth - 4,
        lineBreak: false,
      });
  });
  doc.moveDown(1.2);
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 1 — Individual Employee Timesheet Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateEmployeeTimesheetReport(
  employeeCode: string,
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT te.date, te.project_name, te.task_description, 
            te.start_time, te.end_time, te.total_hours,
            te.percentage_complete, te.status, te.achievements,
            te.tools_used, e.name as employee_name
     FROM time_entries te
     JOIN employees e ON te.employee_id = e.id
     WHERE LOWER(te.employee_code) = LOWER($1)
       AND te.date BETWEEN $2 AND $3
       AND te.status != 'draft'
     ORDER BY te.date ASC`,
    [employeeCode, startDate, endDate]
  );

  const rows = res.rows;
  const empName = rows[0]?.employee_name || employeeCode;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Timesheet Report");
    styleHeader(ws, ["Date", "Project", "Task", "Start", "End", "Hours", "Progress%", "Status", "Achievements"]);
    rows.forEach((r) => {
      ws.addRow([
        formatDate(r.date), r.project_name, r.task_description,
        r.start_time, r.end_time, r.total_hours,
        r.percentage_complete, r.status, r.achievements,
      ]);
    });
    const fileName = generateFileName(`timesheet_${employeeCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Timesheet Report — ${empName}`,
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Date", "Project", "Task", "Hours", "Status", "Progress%"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        formatDate(r.date), r.project_name,
        r.task_description?.slice(0, 30),
        r.total_hours, r.status,
        `${r.percentage_complete}%`,
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 2 — Individual Employee Leave Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateEmployeeLeaveReport(
  employeeCode: string,
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await lmsPool.query(
    `SELECT leave_type, start_date, end_date, status, 
            reason, leave_duration_type, username
     FROM leaves
     WHERE LOWER(user_id) = LOWER($1)
       AND start_date BETWEEN $2 AND $3
     ORDER BY start_date ASC`,
    [employeeCode, startDate, endDate]
  );

  const rows = res.rows;
  const empName = rows[0]?.username || employeeCode;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leave Report");
    styleHeader(ws, ["Employee", "Leave Type", "Start Date", "End Date", "Duration", "Status", "Reason"]);
    rows.forEach((r) => {
      ws.addRow([
        empName, r.leave_type,
        formatDate(r.start_date), formatDate(r.end_date),
        r.leave_duration_type, r.status, r.reason,
      ]);
    });
    const fileName = generateFileName(`leave_${employeeCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Leave Report — ${empName}`,
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Leave Type", "Start", "End", "Duration", "Status", "Reason"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        r.leave_type, formatDate(r.start_date),
        formatDate(r.end_date), r.leave_duration_type,
        r.status, r.reason?.slice(0, 30),
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 3 — Individual Employee Task Completion Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateEmployeeTaskReport(
  employeeCode: string,
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pmsPool.query(
    `SELECT pt.task_name, pt.status, pt.priority, pt.progress,
            pt.start_date, pt.end_date, pt.completed_at,
            p.title as project_name,
            e.name as employee_name
     FROM project_tasks pt
     JOIN projects p ON pt.project_id = p.id
     JOIN task_members tm ON pt.id = tm.task_id
     JOIN employees e ON tm.employee_id = e.id
     WHERE LOWER(e.emp_code) = LOWER($1)
       AND (pt.start_date BETWEEN $2 AND $3
            OR pt.end_date BETWEEN $2 AND $3)
     ORDER BY pt.end_date ASC NULLS LAST`,
    [employeeCode, startDate, endDate]
  );

  const rows = res.rows;
  const empName = rows[0]?.employee_name || employeeCode;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Task Report");
    styleHeader(ws, ["Project", "Task", "Priority", "Status", "Progress%", "Start Date", "End Date", "Completed At"]);
    rows.forEach((r) => {
      ws.addRow([
        r.project_name, r.task_name, r.priority,
        r.status, `${r.progress}%`,
        formatDate(r.start_date), formatDate(r.end_date),
        formatDate(r.completed_at),
      ]);
    });
    const fileName = generateFileName(`tasks_${employeeCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Task Report — ${empName}`,
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Project", "Task", "Priority", "Status", "Progress%", "Due Date"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        r.project_name, r.task_name?.slice(0, 25),
        r.priority, r.status,
        `${r.progress}%`, formatDate(r.end_date),
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 4 — Team Timesheet Compliance Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateTeamTimesheetComplianceReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const allEmpRes = await pool.query(
    `SELECT employee_code, name FROM employees WHERE is_active = true ORDER BY name`
  );

  const submittedRes = await pool.query(
    `SELECT employee_code, COUNT(DISTINCT date) as days_submitted
     FROM time_entries
     WHERE date BETWEEN $1 AND $2
       AND status != 'draft'
     GROUP BY employee_code`,
    [startDate, endDate]
  );

  const submittedMap = new Map(
    submittedRes.rows.map((r) => [r.employee_code, Number(r.days_submitted)])
  );

  const totalDays = Math.ceil(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000
  ) + 1;

  const rows = allEmpRes.rows.map((e) => ({
    name: e.name,
    code: e.employee_code,
    daysSubmitted: submittedMap.get(e.employee_code) || 0,
    totalDays,
    complianceRate: `${Math.round(((submittedMap.get(e.employee_code) || 0) / totalDays) * 100)}%`,
    status: (submittedMap.get(e.employee_code) || 0) >= totalDays ? "Compliant" : "Non-Compliant",
  }));

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Compliance Report");
    styleHeader(ws, ["Employee", "Code", "Days Submitted", "Total Days", "Compliance Rate", "Status"]);
    rows.forEach((r) => {
      ws.addRow([r.name, r.code, r.daysSubmitted, r.totalDays, r.complianceRate, r.status]);
    });
    const fileName = generateFileName("team_compliance", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Team Timesheet Compliance Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Code", "Days Submitted", "Total Days", "Rate", "Status"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [r.name, r.code, String(r.daysSubmitted), String(r.totalDays), r.complianceRate, r.status]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 5 — Team Attendance/Leave Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateTeamLeaveReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await lmsPool.query(
    `SELECT user_id as employee_code, username as employee_name,
            leave_type, start_date, end_date,
            leave_duration_type, status, reason
     FROM leaves
     WHERE start_date BETWEEN $1 AND $2
     ORDER BY start_date ASC`,
    [startDate, endDate]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Leave Report");
    styleHeader(ws, ["Employee", "Code", "Leave Type", "Start", "End", "Duration", "Status", "Reason"]);
    rows.forEach((r) => {
      ws.addRow([
        r.employee_name, r.employee_code, r.leave_type,
        formatDate(r.start_date), formatDate(r.end_date),
        r.leave_duration_type, r.status, r.reason,
      ]);
    });
    const fileName = generateFileName("team_leave", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Team Attendance & Leave Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Leave Type", "Start", "End", "Duration", "Status"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        r.employee_name, r.leave_type,
        formatDate(r.start_date), formatDate(r.end_date),
        r.leave_duration_type, r.status,
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 6 — Team Productivity Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateTeamProductivityReport(
  startDate: string,
  endDate: string,
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pool.query(
    `SELECT te.employee_code, te.employee_name,
            COUNT(DISTINCT te.date) as days_worked,
            COUNT(*) as total_entries,
            SUM(
              EXTRACT(HOUR FROM (te.end_time::time - te.start_time::time)) +
              EXTRACT(MINUTE FROM (te.end_time::time - te.start_time::time)) / 60.0
            ) as total_hours,
            AVG(te.percentage_complete) as avg_completion
     FROM time_entries te
     JOIN employees e ON te.employee_id = e.id
     WHERE te.date BETWEEN $1 AND $2
       AND e.is_active = true
     GROUP BY te.employee_code, te.employee_name
     ORDER BY total_hours DESC NULLS LAST`,
    [startDate, endDate]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Productivity Report");
    styleHeader(ws, ["Employee", "Code", "Days Worked", "Total Entries", "Total Hours", "Avg Completion%"]);
    rows.forEach((r) => {
      ws.addRow([
        r.employee_name, r.employee_code,
        r.days_worked, r.total_entries,
        Number(r.total_hours || 0).toFixed(1),
        `${Number(r.avg_completion || 0).toFixed(0)}%`,
      ]);
    });
    const fileName = generateFileName("team_productivity", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Team Productivity Report",
      `Period: ${startDate} to ${endDate}`
    );
    pdfTableRow(doc, ["Employee", "Code", "Days Worked", "Entries", "Hours", "Avg%"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        r.employee_name, r.employee_code,
        String(r.days_worked), String(r.total_entries),
        Number(r.total_hours || 0).toFixed(1),
        `${Number(r.avg_completion || 0).toFixed(0)}%`,
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 7 — Overdue Tasks Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateOverdueTasksReport(
  format: "pdf" | "excel"
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];

  const res = await pmsPool.query(
    `SELECT pt.task_name, pt.status, pt.priority, pt.progress,
            pt.end_date, p.title as project_name,
            e.name as assigned_to, e.emp_code as employee_code,
            (CURRENT_DATE - pt.end_date::date) as days_overdue
     FROM project_tasks pt
     JOIN projects p ON pt.project_id = p.id
     LEFT JOIN task_members tm ON pt.id = tm.task_id
     LEFT JOIN employees e ON tm.employee_id = e.id
     WHERE pt.end_date < $1
       AND LOWER(pt.status) != 'completed'
     ORDER BY pt.end_date ASC NULLS LAST`,
    [today]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Overdue Tasks");
    styleHeader(ws, ["Project", "Task", "Assigned To", "Priority", "Progress%", "Due Date", "Days Overdue", "Status"]);
    rows.forEach((r) => {
      ws.addRow([
        r.project_name, r.task_name, r.assigned_to,
        r.priority, `${r.progress}%`,
        formatDate(r.end_date), r.days_overdue, r.status,
      ]);
    });
    const fileName = generateFileName("overdue_tasks", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Overdue Tasks Report",
      `Generated on: ${today}`
    );
    pdfTableRow(doc, ["Project", "Task", "Assigned To", "Priority", "Due Date", "Days Overdue"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        r.project_name, r.task_name?.slice(0, 25),
        r.assigned_to, r.priority,
        formatDate(r.end_date), String(r.days_overdue),
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 8 — Project Progress Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateProjectProgressReport(
  format: "pdf" | "excel"
): Promise<string> {
  const res = await pmsPool.query(
    `SELECT p.title, p.project_code, p.status, p.progress,
            p.start_date, p.end_date, p.client_name,
            COUNT(pt.id) as total_tasks,
            COUNT(CASE WHEN LOWER(pt.status) = 'completed' THEN 1 END) as completed_tasks,
            COUNT(CASE WHEN pt.end_date < CURRENT_DATE AND LOWER(pt.status) != 'completed' THEN 1 END) as overdue_tasks
     FROM projects p
     LEFT JOIN project_tasks pt ON pt.project_id = p.id
     WHERE LOWER(p.status) = 'in progress'
     GROUP BY p.id, p.title, p.project_code, p.status, p.progress,
              p.start_date, p.end_date, p.client_name
     ORDER BY p.progress ASC`
  );

  const rows = res.rows;
  const today = new Date().toISOString().split("T")[0];

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Project Progress");
    styleHeader(ws, ["Project", "Code", "Client", "Progress%", "Start Date", "End Date", "Total Tasks", "Completed", "Overdue"]);
    rows.forEach((r) => {
      ws.addRow([
        r.title, r.project_code, r.client_name,
        `${r.progress}%`,
        formatDate(r.start_date), formatDate(r.end_date),
        r.total_tasks, r.completed_tasks, r.overdue_tasks,
      ]);
    });
    const fileName = generateFileName("project_progress", "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      "Project Progress Report",
      `Generated on: ${today}`
    );
    pdfTableRow(doc, ["Project", "Code", "Progress%", "End Date", "Tasks", "Completed", "Overdue"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        r.title, r.project_code, `${r.progress}%`,
        formatDate(r.end_date),
        String(r.total_tasks), String(r.completed_tasks), String(r.overdue_tasks),
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REPORT 9 — Project Task Breakdown Report
// ════════════════════════════════════════════════════════════════════════════
export async function generateProjectTaskBreakdownReport(
  projectCode: string,
  format: "pdf" | "excel"
): Promise<string> {
  const projRes = await pmsPool.query(
    `SELECT id, title FROM projects WHERE LOWER(project_code) = LOWER($1)`,
    [projectCode]
  );

  if (projRes.rows.length === 0) throw new Error(`Project ${projectCode} not found`);

  const project = projRes.rows[0];

  const res = await pmsPool.query(
    `SELECT pt.task_name, pt.status, pt.priority, pt.progress,
            pt.start_date, pt.end_date,
            e.name as assigned_to
     FROM project_tasks pt
     LEFT JOIN task_members tm ON pt.id = tm.task_id
     LEFT JOIN employees e ON tm.employee_id = e.id
     WHERE pt.project_id = $1::uuid
     ORDER BY pt.end_date ASC NULLS LAST`,
    [project.id]
  );

  const rows = res.rows;

  if (format === "excel") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Task Breakdown");
    styleHeader(ws, ["Task", "Assigned To", "Priority", "Status", "Progress%", "Start Date", "End Date"]);
    rows.forEach((r) => {
      ws.addRow([
        r.task_name, r.assigned_to, r.priority,
        r.status, `${r.progress}%`,
        formatDate(r.start_date), formatDate(r.end_date),
      ]);
    });
    const fileName = generateFileName(`project_tasks_${projectCode}`, "xlsx");
    const filePath = path.join(reportsDir, fileName);
    await wb.xlsx.writeFile(filePath);
    return fileName;
  } else {
    const { doc, filePath } = createPDFDoc(
      `Project Task Breakdown — ${project.title}`,
      `Project Code: ${projectCode}`
    );
    pdfTableRow(doc, ["Task", "Assigned To", "Priority", "Status", "Progress%", "Due Date"], true);
    rows.forEach((r) => {
      pdfTableRow(doc, [
        r.task_name?.slice(0, 28), r.assigned_to,
        r.priority, r.status,
        `${r.progress}%`, formatDate(r.end_date),
      ]);
    });
    doc.end();
    return path.basename(filePath);
  }
}

import OpenAI from "openai";
import { randomUUID } from "crypto";
import { retrieveContext } from "./retrieval";
import { lmsPool } from "../lmsSupabase";
import { pmsPool } from "../pmsSupabase";
import { pool } from "../db";
import { storage } from "../storage";
import { getProjects as getPMSProjects } from "../pmsSupabase";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractFirstName(fullName: string): string {
  if (!fullName) return "there";
  const cleaned = fullName.replace(/^[A-Z]\./i, "").trim();
  const first = cleaned.split(" ")[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function formatDate(d: any): string {
  if (!d) return "N/A";
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function calcHours(start: string, end: string): string {
  try {
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const diff = eh * 60 + em - (sh * 60 + sm);
    if (diff <= 0) return "0h 0m";
    return `${Math.floor(diff / 60)}h ${diff % 60}m`;
  } catch {
    return "0h 0m";
  }
}

function resolveEmployeeCode(
  args: { employeeCode?: string },
  userContext: { employeeCode: string; role: string }
): string {
  if (!args.employeeCode || args.employeeCode === userContext.employeeCode) {
    return userContext.employeeCode;
  }
  if (!['manager', 'hr', 'admin'].includes(userContext.role)) {
    throw new Error("Access denied: insufficient permissions");
  }
  return args.employeeCode;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runRAGChat(
  message: string,
  history: { role: "user" | "assistant" | "system"; content: string }[],
  userContext: {
    employeeId: string;
    employeeCode: string;
    role: string;
    department: string;
    lmsUserId?: string;
    employeeName?: string;
  },
  onChunk: (chunk: {
    type: "text" | "interactive_daily_plan" | "action_executed";
    content?: string;
    projects?: any[];
    action?: string;
    status?: string;
  }) => void
) {
  const firstName = extractFirstName(userContext.employeeName || "");

  // 1. RAG context
  const context = await retrieveContext(message, {
    role: userContext.role,
    employee_id: userContext.employeeId,
    employee_code: userContext.employeeCode,
  });
  const contextStr =
    context.length > 0
      ? context.map((c, i) => `[Reference ${i + 1}]:\n${c}`).join("\n\n")
      : "No matching reference records found.";

  const today = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const lastWeekStart = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  // 2. System prompt
  const systemPrompt = `
TODAY'S DATE: ${today}
YESTERDAY: ${yesterday}
THIS WEEK STARTS: ${lastWeekStart}

You are ARIA (Automated Resource & Intelligence Assistant), an intelligent AI Agent built exclusively for Knockturn Private Limited.
You are embedded inside the company's internal ERP system called Timestrap.

IDENTITY:
- You are not a chatbot. You are a smart AI Agent.
- You think, decide, and act — not just answer.
- You are professional, concise, and confident.
- You never say "I don't have access" or "I cannot help with that".
- You always try a tool first before saying something is unavailable.
- You respond in the same language the user writes in.

CURRENT USER:
- Name: ${firstName}
- Employee Code: ${userContext.employeeCode}
- Employee ID: ${userContext.employeeId}
- Role: ${userContext.role}
- Department: ${userContext.department}
- LMS User ID: ${userContext.lmsUserId || userContext.employeeCode}

KNOWLEDGE SOURCES (use in this order):
1. TOOLS — for anything related to user's own data
2. RETRIEVED CONTEXT — for broader company data
3. WORLD KNOWLEDGE — for general questions

STRICT RULES:
- ALWAYS call a tool for data queries. Never guess from memory.
- "my tasks" → getMyTasks
- "my leaves" → getMyLeaves
- "my timesheets" → getRecentTimesheets
- specific date timesheet → getTimesheetsByDate
- submitting timesheet → submitTimesheet
- requesting leave → requestLeave
- creating task → createTask
- completing task → markTaskComplete
- changing deadline → updateTaskDeadline
- approving leave → approveLeaveRequest
- rejecting leave → rejectLeaveRequest
- "did I submit my plan" → getDailyPlan
- "delete my plan" → deleteDailyPlan

COUNT & STATUS RULES (CRITICAL — NEVER VIOLATE):
- NEVER state or guess a count for projects, tasks, timesheets, leaves, or any data from memory or previous context. Always call the relevant tool first (e.g. getMyTasks, getMyProjects), then answer using ONLY the numbers returned by the tool.
- NEVER confirm or deny any submission status (daily plan, timesheet, leave request) from memory or assumption. Always call the relevant tool (getDailyPlan, getTimesheetsByDate, getMyLeaves) to verify before answering.
- If the user corrects a number you gave, do NOT agree — call the tool again and report the actual result.
- If asked about another employee's data (tasks, projects, plans), pass their employeeCode to the tool so the database retrieves THEIR records, not the current user's.
- If the same data is requested more than once in a conversation, ALWAYS call the tool again. Never reuse a previous tool result.
- Every answer that includes a number MUST come from a tool call in THIS turn. If you did not call a tool in this turn, you CANNOT state a number.

EMPLOYEE NAME RESOLUTION RULES:
- When the user asks about another employee by name (e.g., "Durga", "Naveen", "Sam"):
  1. ALWAYS call the "getEmployees" tool first with the search parameter (e.g., search: "Durga") to find their employeeCode.
  2. If a single employee is found, IMMEDIATELY call the requested tool (e.g., getMyProjects or getMyTasks) in the SAME turn using that resolved employee code. Never pause, stop, or ask the user to hold on between these two steps.
  3. Both steps must happen in the same response/turn — resolve then fetch, no waiting.
  4. If the tool returns MULTIPLE employees, you MUST ask the user to clarify before calling any other tool. Show the list of matches with their names and department/role (e.g., "I found multiple employees named Durga: 1. Durga Devi (Software Developer), 2. Durga Prasad (Operations). Which one do you mean?").
  5. Never guess, assume, or arbitrarily pick one employee when multiple matches exist.

DATE RULES:
- Always convert "yesterday", "today", "last week" to exact YYYY-MM-DD before calling any tool.

CONVERSATION CONTEXT:
- When user says "anything else?" or "other than this?" — do NOT repeat the same query.
  Say "Those are all your active tasks" or search with different filters.

SECURITY RULES:
- Employees ONLY see their own data.
- Managers, HR, Admin can see all employee data via employeeCode parameter.
- Always verify role before sensitive actions.

DELETION RULES:
- Before deleting anything (plan, timesheet, task), ALWAYS ask the user for confirmation first.
- Say: "Are you sure you want to delete your plan for [date]? This cannot be undone."
- Only call the delete tool AFTER the user explicitly confirms.

RESPONSE FORMATTING:
- Always address the user as "${firstName}", never by employee code.
- Use markdown: bold for labels, bullet points for lists.
- Use emojis naturally (✅ ❌ 📅 ⚠️ 👋 📋 🌴 ⏱️).
- Be direct and concise. No filler.
- Never say "As an AI language model..."
- Never say "I don't have real-time access..."
- YOU ARE the ERP system.

GREETING BEHAVIOR:
When the user greets you (any language, any phrasing):
- Warmly greet them as "${firstName}"
- Call getMyTasks + getMyLeaves + getTimesheetsByDate (for today: ${today}) simultaneously
- Respond with a clean at-a-glance summary — counts only, no full lists:

  Good morning ${firstName} 👋 Here's your day at a glance:

  📋 **Tasks** — X active, Y due this week, Z overdue
  🌴 **Leaves** — X approved, Y pending
  ⏱️ **Timesheet** — submitted / not submitted today
  ⚠️ **Overdue** — X tasks past deadline

  Type "show my tasks" or "show my leaves" for full details.

- For any other question, format the tool data in full detail clearly.

- When an employee wants to log a timesheet, use the timesheet tools
  to guide them conversationally. Always confirm before finalizing.

- When an employee wants to plan their day, fetch their tasks, suggest
  a plan based on deadlines and priority, wait for confirmation, then submit.

RETRIEVED DATABASE CONTEXT:
${contextStr}

You are ARIA. You think. You decide. You act.
You are the intelligent brain of Knockturn Private Limited's ERP system.
`;

  // 3. Tool definitions
  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: "function",
      function: {
        name: "getMyTasks",
        description: `Fetch active assigned tasks from PMS. Always call this tool to get the exact count. Never guess or recall task counts from previous context.
If a manager/HR/admin asks about another employee's tasks, pass that employee's code in the employeeCode parameter.`,
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to query (e.g. 'E0048'). Defaults to the logged-in user. Only managers/HR/admin can query other employees.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getMyLeaves",
        description: "Fetch the logged-in employee's leave requests.",
        parameters: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected", ""],
              description: "Optional status filter.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getTimesheetsByDate",
        description: "Fetch timesheets for a specific date or date range.",
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "Specific date YYYY-MM-DD" },
            from_date: { type: "string", description: "Start date YYYY-MM-DD" },
            to_date: { type: "string", description: "End date YYYY-MM-DD" },
            employeeCode: { type: "string", description: "Optional employee code. Managers/admins/HR only." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getRecentTimesheets",
        description: "Fetch recent timesheet entries without a specific date.",
        parameters: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Number to fetch (default 5, max 20)" },
            employeeCode: { type: "string", description: "Optional employee code. Managers/admins/HR only." },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "viewPendingLeaves",
        description: "View all pending leave requests. Managers/HR/Admin only.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "approveLeaveRequest",
        description: "Approve a pending leave request by ID.",
        parameters: {
          type: "object",
          properties: {
            leaveId: { type: "string", description: "Leave request UUID." },
          },
          required: ["leaveId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rejectLeaveRequest",
        description: "Reject a pending leave request by ID.",
        parameters: {
          type: "object",
          properties: {
            leaveId: { type: "string", description: "Leave request UUID." },
          },
          required: ["leaveId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "markTaskComplete",
        description: "Mark a project task as completed.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
          },
          required: ["taskId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "assignTaskToEmployee",
        description: "Assign a task to an employee. Managers/Admins only.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
            employeeCode: { type: "string", description: "Employee code (e.g. E0047)." },
          },
          required: ["taskId", "employeeCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "updateTaskDeadline",
        description: "Update a task's deadline. Managers/Admins only.",
        parameters: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "Task UUID." },
            deadline: { type: "string", description: "New deadline YYYY-MM-DD." },
          },
          required: ["taskId", "deadline"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "approveTimesheet",
        description: "Approve a timesheet entry. Managers/Admins only.",
        parameters: {
          type: "object",
          properties: {
            timesheetId: { type: "string", description: "Time entry UUID." },
          },
          required: ["timesheetId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "rejectTimesheet",
        description: "Reject a timesheet entry. Managers/Admins only.",
        parameters: {
          type: "object",
          properties: {
            timesheetId: { type: "string", description: "Time entry UUID." },
          },
          required: ["timesheetId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submitTimesheet",
        description: "Submit a new timesheet entry for the logged-in employee.",
        parameters: {
          type: "object",
          properties: {
            projectName: { type: "string" },
            taskDescription: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD" },
            startTime: { type: "string", description: "HH:MM 24h" },
            endTime: { type: "string", description: "HH:MM 24h" },
            percentageComplete: { type: "number" },
            quantify: { type: "string" },
            problemAndIssues: { type: "string" },
            achievements: { type: "string" },
            scopeOfImprovements: { type: "string" },
            toolsUsed: { type: "array", items: { type: "string" } },
          },
          required: ["projectName", "taskDescription", "date", "startTime", "endTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "requestLeave",
        description: "Submit a new leave request for the logged-in employee.",
        parameters: {
          type: "object",
          properties: {
            leaveType: { type: "string", enum: ["Casual", "Sick", "Privilege", "Maternity", "Paternity"] },
            startDate: { type: "string" },
            endDate: { type: "string" },
            reason: { type: "string" },
            leaveDurationType: { type: "string", enum: ["Full Day", "Half Day"] },
          },
          required: ["leaveType", "startDate", "endDate", "reason"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "createTask",
        description: "Create a new project task in PMS.",
        parameters: {
          type: "object",
          properties: {
            projectCode: { type: "string" },
            taskName: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: ["Low", "Medium", "High"] },
            startDate: { type: "string" },
            endDate: { type: "string" },
            assigneeCode: { type: "string" },
            status: { type: "string" },
            progress: { type: "number" },
          },
          required: ["projectCode", "taskName"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "prepareDailyPlanSelection",
        description: "Initialize the daily planning workflow by fetching the employee's active projects.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "getEmployees",
        description: "Fetch a list of employees or search employees by name, department, role, or active status. Restricted to admin, hr, and manager roles.",
        parameters: {
          type: "object",
          properties: {
            department: {
              type: "string",
              description: "Filter by department (e.g. 'Software', 'Finance', 'HR', 'Admin', 'IT Support', 'Engineering')."
            },
            role: {
              type: "string",
              description: "Filter by role (e.g. 'employee', 'manager', 'admin', 'hr')."
            },
            isActive: {
              type: "boolean",
              description: "Filter by active status (true for active, false for inactive)."
            },
            search: {
              type: "string",
              description: "Search keyword matching employee name, email, or employee code."
            }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "getTeamData",
        description: `Fetch any team-level data for managers, HR, and admins.
Use this for ANY question about the team including:
- Who hasn't submitted timesheets?
- Which tasks are overdue?
- Who is on leave?
- Who is the most productive employee?
- Which department is performing best?
- Who has the most completed tasks?
- Who logs the most hours?
- Compare employee performance
- Team workload analysis
- Any question that requires team or employee data

Data available to answer these questions:
- time_entries: hours logged, submission rate, project work
- project_tasks: completed tasks, overdue tasks, progress
- leaves: attendance patterns
- employees: department, role, active status

Fetch the relevant dataType(s) and let GPT calculate, 
rank, and analyse the results intelligently.`,
        parameters: {
          type: "object",
          properties: {
            dataType: {
              type: "string",
              enum: ["timesheets", "tasks", "leaves", "employees"],
              description: "The type of team data to fetch.",
            },
            date: {
              type: "string",
              description: "Specific date filter YYYY-MM-DD",
            },
            startDate: {
              type: "string",
              description: "Start of date range YYYY-MM-DD",
            },
            endDate: {
              type: "string",
              description: "End of date range YYYY-MM-DD",
            },
            department: {
              type: "string",
              description: "Filter by department name e.g. Software, HR",
            },
            status: {
              type: "string",
              description: "Filter by status e.g. pending, approved, rejected, completed, In Progress",
            },
            employeeCode: {
              type: "string",
              description: "Filter down to a specific employee code e.g. E0047",
            },
          },
          required: ["dataType"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getEmployeeDetail",
        description: `Fetch a complete profile and activity summary for a specific employee.
Use this when a manager asks:
- Tell me about E0047
- What has Priya been working on?
- Show me Naveen's full activity
- How productive is this employee?
Returns profile, active tasks, recent timesheets, and leave history all one call.`,
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "The employee code to look up e.g. E0047",
            },
          },
          required: ["employeeCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getMyProjects",
        description: `Fetch all active projects an employee is assigned to. Always call this tool to get the exact count. Never guess or recall project counts from previous context.
Use this when the employee wants to log a timesheet, plan their day, or asks about their projects.
If a manager/HR/admin asks about another employee's projects, pass that employee's code in the employeeCode parameter.
Returns project id, name, project_code, status, and deadline.`,
        parameters: {
          type: "object",
          properties: {
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to query (e.g. 'E0048'). Defaults to the logged-in user. Only managers/HR/admin can query other employees.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getProjectKeySteps",
        description: `Fetch available key steps for a specific project.
Use this during timesheet logging when the employee has selected a project and task,
and you need to show them which key step category their work falls under.
Key steps are things like: Development, Integration, Testing, Setup, Validation.`,
        parameters: {
          type: "object",
          properties: {
            projectCode: {
              type: "string",
              description: "The project_code of the project (e.g. 'BOQ-AI', 'BLE-01')",
            },
          },
          required: ["projectCode"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getProjectSubtasks",
        description: `Fetch active subtasks for a specific PMS task UUID.
Use this during timesheet logging after the employee has selected a task,
to show available subtasks they may have worked on.
Only returns incomplete subtasks (is_completed = false, progress < 100).`,
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The UUID of the PMS task",
            },
          },
          required: ["taskId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submitTimesheetEntry",
        description: `Never ask the employee multiple questions at once. 
Ask one natural question at a time, like a conversation.
Start by showing their active projects and tasks, then ask 
"Which of these did you work on today?" — nothing else yet.

Submit a single timesheet task entry for the logged-in employee.
Call this once per task the employee worked on today.
After ALL tasks have been submitted, call finalizeTimesheetSubmission to lock the day.

Collect these fields conversationally before calling — one natural response is enough:
- projectName: match exactly to the PMS project name
- taskDescription: the PMS task name or a clear description
- startTime / endTime: in HH:MM 24h format (convert "9am" to "09:00" automatically)
- percentageComplete: 0-100
- keyStep: selected from getProjectKeySteps results (optional, do not force)
- pmsId: the PMS task UUID from getMyTasks results
- pmsSubtaskId: subtask UUID if employee mentioned a subtask (optional)
- quantify: a measurable result (e.g. "3 bugs fixed", "1 layout built")
- achievements: what was accomplished
- problemAndIssues: any blockers (optional)
- scopeOfImprovements: suggestions for next time (optional)
- toolsUsed: array of tool names (optional, can be empty)
- date: always default to today unless employee specifies otherwise`,
        parameters: {
          type: "object",
          properties: {
            projectName: { type: "string" },
            taskDescription: { type: "string" },
            date: { type: "string", description: "YYYY-MM-DD, default today" },
            startTime: { type: "string", description: "HH:MM 24h format" },
            endTime: { type: "string", description: "HH:MM 24h format" },
            percentageComplete: { type: "number" },
            keyStep: { type: "string", description: "Key step title from getProjectKeySteps" },
            pmsId: { type: "string", description: "PMS task UUID" },
            pmsSubtaskId: { type: "string", description: "PMS subtask UUID (optional)" },
            quantify: { type: "string" },
            achievements: { type: "string" },
            problemAndIssues: { type: "string" },
            scopeOfImprovements: { type: "string" },
            toolsUsed: { type: "array", items: { type: "string" } },
          },
          required: ["projectName", "taskDescription", "startTime", "endTime"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "finalizeTimesheetSubmission",
        description: `Call this ONCE after all timesheet entries have been submitted via submitTimesheetEntry.
This locks the daily submission, checks the 8-hour requirement, and sends confirmation emails.
Only call this when the employee confirms they have no more tasks to add.
Never call this before at least one submitTimesheetEntry has succeeded.`,
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD, default today" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "submitDailyPlan",
        description: `Submit the employee's plan for today.
Use this when the employee wants to plan their day.
Always call getMyProjects and getMyTasks first to get available tasks.
Suggest a plan based on deadlines and priority, show it to the employee,
and wait for their confirmation or edits before calling this.

selectedTasks: tasks the employee WILL work on today
unselectedTasks: tasks being skipped today — always include a reason and a proposed new date`,
        parameters: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD, default today" },
            selectedTasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "PMS task UUID" },
                  projectName: { type: "string" },
                  task_name: { type: "string" },
                  source: { type: "string", description: "Always 'PMS'" },
                  isLocked: { type: "boolean", description: "Always false" },
                },
                required: ["id", "projectName", "task_name"],
              },
            },
            unselectedTasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  taskId: { type: "string", description: "PMS task UUID" },
                  taskName: { type: "string" },
                  reason: { type: "string", description: "Why skipping today" },
                  newDueDate: { type: "string", description: "YYYY-MM-DD proposed date" },
                },
                required: ["taskId", "taskName", "reason", "newDueDate"],
              },
            },
          },
          required: ["selectedTasks"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "getDailyPlan",
        description: `Check if a daily plan has been submitted for a specific date. Always call this tool to verify plan status — never confirm or deny a plan from memory.
If a manager/HR/admin asks about another employee's plan, pass that employee's code in the employeeCode parameter.`,
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "YYYY-MM-DD format. Defaults to today if not provided.",
            },
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to query. Defaults to the logged-in user. Only managers/HR/admin can query other employees.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "deleteDailyPlan",
        description: `Delete the daily plan for a specific date. Always ask for confirmation before executing deletion — say "Are you sure you want to delete your plan for [date]? This cannot be undone." and only call this tool AFTER the user explicitly confirms.
If a manager/HR/admin wants to delete another employee's plan, pass that employee's code in the employeeCode parameter.`,
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description: "YYYY-MM-DD format. Defaults to today if not provided.",
            },
            employeeCode: {
              type: "string",
              description: "Optional. Employee code to delete plan for. Defaults to the logged-in user. Only managers/HR/admin can delete other employees' plans.",
            },
          },
        },
      },
    }
  ];

  // 4. GPT call loop — intent detection, tool selection, and execution (up to 5 iterations for tool chaining)
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: message },
  ];

  let currentMessages = [...messages];
  let loopCount = 0;
  const maxLoops = 5;

  while (loopCount < maxLoops) {
    loopCount++;

    // Force tool choice on the first iteration for non-conversational queries
    const isConversational = message.trim().split(/\s+/).length <= 2;
    const toolChoiceValue = (loopCount === 1 && !isConversational) ? "required" : "auto";

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: currentMessages,
      tools,
      tool_choice: toolChoiceValue,
      stream: true,
    });

    let toolCallsToExecute: any[] = [];
    let responseText = "";

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        responseText += delta.content;
        onChunk({ type: "text", content: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallsToExecute[tc.index]) {
            toolCallsToExecute[tc.index] = { id: tc.id, name: tc.function?.name || "", arguments: "" };
          }
          if (tc.function?.arguments) {
            toolCallsToExecute[tc.index].arguments += tc.function.arguments;
          }
        }
      }
    }

    const activeToolCalls = toolCallsToExecute.filter(Boolean);

    if (activeToolCalls.length === 0) {
      // No tools requested; we are done.
      break;
    }

    // Append assistant tool calls message to currentMessages
    currentMessages.push({
      role: "assistant",
      content: responseText || null,
      tool_calls: activeToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    } as any);

    // Execute tool calls
    for (const tc of activeToolCalls) {
      if (!tc) continue;

      let args: any = {};
      try { args = JSON.parse(tc.arguments); } catch { }

      console.log(`Executing tool (loop ${loopCount}): ${tc.name}`, args);

      let toolResult: any = null;

      try {
        // ── READ TOOLS — return raw data to GPT ──────────────────────────────

        if (tc.name === "getMyTasks") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const res = await pmsPool.query(
            `SELECT pt.id, pt.task_name, pt.status, pt.priority, pt.start_date, pt.end_date, pt.progress, p.title as project_name
           FROM project_tasks pt
           INNER JOIN projects p ON pt.project_id = p.id
           WHERE LOWER(p.status) = 'in progress'
             AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
             AND (
               -- 1. Employee is explicitly assigned to this task
               EXISTS (
                 SELECT 1 FROM task_members tm
                 INNER JOIN employees e ON tm.employee_id = e.id
                 WHERE tm.task_id = pt.id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 2. Task belongs to a project mapped to the employee's department
               EXISTS (
                 SELECT 1 FROM project_departments pd
                 INNER JOIN employees e ON LOWER(e.department) = LOWER(pd.department)
                 WHERE pd.project_id = pt.project_id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 3. Task belongs to a project created by the employee
               EXISTS (
                 SELECT 1 FROM employees e
                 WHERE e.id = p.created_by_employee_id AND LOWER(e.emp_code) = LOWER($1)
               )
             )
           ORDER BY pt.end_date ASC NULLS LAST`,
            [targetEmpCode]
          );
          toolResult = { totalTasks: res.rows.length, tasks: res.rows.map((r) => ({ ...r, end_date: formatDate(r.end_date) })) };
        }

        else if (tc.name === "getMyLeaves") {
          let query = "SELECT * FROM leaves WHERE LOWER(user_id) = LOWER($1)";
          const params: any[] = [userContext.lmsUserId || userContext.employeeCode];
          if (args.status) { params.push(args.status); query += ` AND status ILIKE $${params.length}`; }
          query += " ORDER BY start_date DESC LIMIT 20";
          const res = await lmsPool.query(query, params);
          toolResult = {
            leaves: res.rows.map((r) => ({
              ...r,
              start_date: formatDate(r.start_date),
              end_date: formatDate(r.end_date),
            })),
          };
        }

        else if (tc.name === "getTimesheetsByDate") {
          let targetEmployeeId = userContext.employeeId;
          let targetEmployeeCode = userContext.employeeCode;

          if (args.employeeCode && args.employeeCode !== userContext.employeeCode) {
            if (!["manager", "admin", "hr"].includes(userContext.role)) {
              toolResult = { error: "Access denied: cannot view other employees' timesheets." };
            } else {
              const empRes = await pool.query("SELECT id FROM employees WHERE employee_code = $1", [args.employeeCode]);
              if (empRes.rows.length === 0) {
                toolResult = { error: `Employee ${args.employeeCode} not found.` };
              } else {
                targetEmployeeId = empRes.rows[0].id;
                targetEmployeeCode = args.employeeCode;
              }
            }
          }

          if (!toolResult) {
            let query = `SELECT * FROM time_entries WHERE employee_id = $1`;
            const params: any[] = [targetEmployeeId];
            if (args.date) { params.push(args.date); query += ` AND date = $${params.length}`; }
            else if (args.from_date && args.to_date) {
              params.push(args.from_date, args.to_date);
              query += ` AND date BETWEEN $${params.length - 1} AND $${params.length}`;
            }
            query += ` ORDER BY date DESC LIMIT 20`;
            const res = await pool.query(query, params);
            toolResult = { employee: targetEmployeeCode, timesheets: res.rows };
          }
        }

        else if (tc.name === "getRecentTimesheets") {
          let targetEmployeeId = userContext.employeeId;
          let targetEmployeeCode = userContext.employeeCode;

          if (args.employeeCode && args.employeeCode !== userContext.employeeCode) {
            if (!["manager", "admin", "hr"].includes(userContext.role)) {
              toolResult = { error: "Access denied." };
            } else {
              const empRes = await pool.query("SELECT id FROM employees WHERE employee_code = $1", [args.employeeCode]);
              if (empRes.rows.length > 0) {
                targetEmployeeId = empRes.rows[0].id;
                targetEmployeeCode = args.employeeCode;
              }
            }
          }

          if (!toolResult) {
            const limit = args.limit ? Math.min(Number(args.limit), 20) : 5;
            const res = await pool.query(
              `SELECT * FROM time_entries WHERE employee_id = $1 ORDER BY submitted_at DESC, date DESC LIMIT $2`,
              [targetEmployeeId, limit]
            );
            toolResult = { employee: targetEmployeeCode, timesheets: res.rows };
          }
        }

        else if (tc.name === "viewPendingLeaves") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers/HR/admin can view pending leaves." };
          } else {
            const res = await lmsPool.query("SELECT * FROM leaves WHERE status ILIKE 'pending' LIMIT 20");
            toolResult = { pending_leaves: res.rows };
          }
        }

        // ── ACTION TOOLS — execute and return outcome to GPT ─────────────────

        else if (tc.name === "approveLeaveRequest") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            await lmsPool.query("UPDATE leaves SET status = 'Approved' WHERE id = $1", [args.leaveId]);
            toolResult = { success: true, action: "approveLeave", leaveId: args.leaveId };
            onChunk({ type: "action_executed", action: "approveLeaveRequest", status: "success" });
          }
        }

        else if (tc.name === "rejectLeaveRequest") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            await lmsPool.query("UPDATE leaves SET status = 'Rejected' WHERE id = $1", [args.leaveId]);
            toolResult = { success: true, action: "rejectLeave", leaveId: args.leaveId };
            onChunk({ type: "action_executed", action: "rejectLeaveRequest", status: "success" });
          }
        }

        else if (tc.name === "markTaskComplete") {
          const taskRes = await pmsPool.query("SELECT * FROM project_tasks WHERE id = $1::uuid", [args.taskId]);
          const task = taskRes.rows[0];
          if (!task) {
            toolResult = { error: `Task ${args.taskId} not found.` };
          } else {
            if (userContext.role === "employee") {
              const memberRes = await pmsPool.query(
                `SELECT 1 FROM task_members tm
               INNER JOIN employees e ON tm.employee_id = e.id
               WHERE tm.task_id = $1::uuid AND LOWER(e.emp_code) = LOWER($2)`,
                [args.taskId, userContext.employeeCode]
              );
              if (memberRes.rows.length === 0) {
                toolResult = { error: "Access denied: you can only complete your own tasks." };
              }
            }
            if (!toolResult) {
              await pmsPool.query(
                "UPDATE project_tasks SET status = 'Completed', progress = 100, updated_at = NOW(), completed_at = NOW() WHERE id = $1::uuid",
                [args.taskId]
              );
              toolResult = { success: true, action: "markTaskComplete", taskName: task.task_name };
              onChunk({ type: "action_executed", action: "markTaskComplete", status: "success" });
            }
          }
        }

        else if (tc.name === "assignTaskToEmployee") {
          if (!["manager", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers/admins can reassign tasks." };
          } else {
            const empRes = await pmsPool.query(
              "SELECT id, name FROM employees WHERE LOWER(emp_code) = LOWER($1)",
              [args.employeeCode]
            );
            if (empRes.rows.length === 0) {
              toolResult = { error: `Employee ${args.employeeCode} not found.` };
            } else {
              await pmsPool.query("DELETE FROM task_members WHERE task_id = $1::uuid", [args.taskId]);
              await pmsPool.query("INSERT INTO task_members (task_id, employee_id) VALUES ($1::uuid, $2::uuid)", [args.taskId, empRes.rows[0].id]);
              await pmsPool.query("UPDATE project_tasks SET updated_at = NOW() WHERE id = $1::uuid", [args.taskId]);
              toolResult = { success: true, action: "assignTask", assignedTo: empRes.rows[0].name, employeeCode: args.employeeCode };
              onChunk({ type: "action_executed", action: "assignTaskToEmployee", status: "success" });
            }
          }
        }

        else if (tc.name === "updateTaskDeadline") {
          if (!["manager", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            await pmsPool.query("UPDATE project_tasks SET end_date = $2, updated_at = NOW() WHERE id = $1::uuid", [args.taskId, args.deadline]);
            toolResult = { success: true, action: "updateDeadline", taskId: args.taskId, newDeadline: args.deadline };
            onChunk({ type: "action_executed", action: "updateTaskDeadline", status: "success" });
          }
        }

        else if (tc.name === "approveTimesheet") {
          if (!["manager", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            const updated = userContext.role === "admin"
              ? await storage.adminApproveTimeEntry(args.timesheetId, userContext.employeeId)
              : await storage.managerApproveTimeEntry(args.timesheetId, userContext.employeeId);
            toolResult = updated
              ? { success: true, action: "approveTimesheet", employee: updated.employeeName, date: updated.date }
              : { error: "Timesheet not found." };
            if (updated) onChunk({ type: "action_executed", action: "approveTimesheet", status: "success" });
          }
        }

        else if (tc.name === "rejectTimesheet") {
          if (!["manager", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied." };
          } else {
            const updated = await storage.updateTimeEntryStatus(args.timesheetId, "rejected", userContext.employeeId, "Rejected by ARIA");
            toolResult = updated
              ? { success: true, action: "rejectTimesheet", employee: updated.employeeName, date: updated.date }
              : { error: "Timesheet not found." };
            if (updated) onChunk({ type: "action_executed", action: "rejectTimesheet", status: "success" });
          }
        }

        else if (tc.name === "submitTimesheet") {
          const empRes = await pool.query("SELECT name FROM employees WHERE id = $1", [userContext.employeeId]);
          const employeeName = empRes.rows[0]?.name || userContext.employeeCode;
          const totalHours = calcHours(args.startTime, args.endTime);
          const entryId = randomUUID();

          await pool.query(
            `INSERT INTO time_entries (
             id, employee_id, employee_code, employee_name, date, project_name,
             task_description, problem_and_issues, quantify, achievements,
             scope_of_improvements, tools_used, start_time, end_time, total_hours,
             percentage_complete, status, manager_approved, submitted_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())`,
            [
              entryId, userContext.employeeId, userContext.employeeCode, employeeName,
              args.date, args.projectName, args.taskDescription,
              args.problemAndIssues || "", args.quantify || "N/A",
              args.achievements || "", args.scopeOfImprovements || "",
              args.toolsUsed || [], args.startTime, args.endTime,
              totalHours, args.percentageComplete ?? 100, "pending", false,
            ]
          );
          toolResult = {
            success: true, action: "submitTimesheet",
            project: args.projectName, date: args.date,
            hours: totalHours, task: args.taskDescription,
          };
          onChunk({ type: "action_executed", action: "submitTimesheet", status: "success" });
        }

        else if (tc.name === "requestLeave") {
          const empRes = await pool.query("SELECT name FROM employees WHERE id = $1", [userContext.employeeId]);
          const employeeName = empRes.rows[0]?.name || userContext.employeeCode;
          const insertRes = await lmsPool.query(
            `INSERT INTO leaves (user_id, leave_type, start_date, end_date, reason, status, username, leave_duration_type, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id`,
            [
              userContext.employeeCode, args.leaveType || "Casual",
              args.startDate, args.endDate, args.reason || "",
              "Pending", employeeName, args.leaveDurationType || "Full Day",
            ]
          );
          toolResult = {
            success: true, action: "requestLeave",
            leaveId: insertRes.rows[0]?.id,
            leaveType: args.leaveType, startDate: args.startDate,
            endDate: args.endDate, reason: args.reason,
          };
          onChunk({ type: "action_executed", action: "requestLeave", status: "success" });
        }

        else if (tc.name === "createTask") {
          const projRes = await pmsPool.query(
            "SELECT id, title FROM projects WHERE project_code = $1 OR LOWER(title) = LOWER($1)",
            [args.projectCode]
          );
          if (projRes.rows.length === 0) {
            toolResult = { error: `Project "${args.projectCode}" not found.` };
          } else {
            const projectId = projRes.rows[0].id;
            const projectTitle = projRes.rows[0].title;

            let assignerId: string | null = null;
            const assignerRes = await pmsPool.query("SELECT id FROM employees WHERE LOWER(emp_code) = LOWER($1)", [userContext.employeeCode]);
            if (assignerRes.rows.length > 0) {
              assignerId = assignerRes.rows[0].id;
            } else {
              const fallback = await pmsPool.query("SELECT id FROM employees LIMIT 1");
              if (fallback.rows.length > 0) assignerId = fallback.rows[0].id;
            }

            if (!assignerId) {
              toolResult = { error: "Assigner not found in PMS." };
            } else {
              const taskId = randomUUID();
              const startDate = args.startDate || today;
              const endDate = args.endDate || today;

              await pmsPool.query(
                `INSERT INTO project_tasks (id, project_id, assigner_id, task_name, description, status, priority, start_date, end_date, progress, created_at, updated_at)
               VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
                [taskId, projectId, assignerId, args.taskName, args.description || "",
                  args.status || "In Progress", args.priority || "Medium", startDate, endDate, args.progress || 0]
              );

              let assignedToName = "";
              if (args.assigneeCode) {
                const empRes = await pmsPool.query(
                  "SELECT id, name FROM employees WHERE LOWER(emp_code) = LOWER($1) OR LOWER(name) = LOWER($1)",
                  [args.assigneeCode]
                );
                if (empRes.rows.length > 0) {
                  assignedToName = empRes.rows[0].name;
                  await pmsPool.query("INSERT INTO task_members (task_id, employee_id) VALUES ($1::uuid, $2::uuid)", [taskId, empRes.rows[0].id]);
                }
              }

              toolResult = {
                success: true, action: "createTask",
                taskName: args.taskName, project: projectTitle,
                deadline: endDate, assignedTo: assignedToName || "unassigned",
              };
              onChunk({ type: "action_executed", action: "createTask", status: "success" });
            }
          }
        }

        // ── SPECIAL TOOL — interactive widget, stream directly ───────────────

        else if (tc.name === "prepareDailyPlanSelection") {
          const projects = await getPMSProjects("employee", userContext.employeeCode, userContext.department);
          onChunk({
            type: "interactive_daily_plan",
            projects: projects.map((p) => ({
              id: p.id,
              project_code: p.project_code,
              project_name: p.project_name,
              progress: p.progress_percentage || 0,
              deadline: p.end_date || "No deadline",
            })),
          });
          toolResult = { action: "prepareDailyPlan", status: "widget_shown" };
        }

        else if (tc.name === "getEmployees") {
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied. Only managers, HR, and admins can query employee information." };
          } else {
            let query = `SELECT id, employee_code as "employeeCode", name, email, role, department, group_name as "groupName", is_active as "isActive" FROM employees WHERE 1=1`;
            const params: any[] = [];

            if (args.department) {
              params.push(args.department);
              query += ` AND department ILIKE $${params.length}`;
            }
            if (args.role) {
              params.push(args.role);
              query += ` AND role ILIKE $${params.length}`;
            }
            if (args.isActive !== undefined) {
              params.push(args.isActive);
              query += ` AND is_active = $${params.length}`;
            }
            if (args.search) {
              params.push(`%${args.search}%`);
              query += ` AND (name ILIKE $${params.length} OR email ILIKE $${params.length} OR employee_code ILIKE $${params.length})`;
            }

            query += ` ORDER BY name ASC LIMIT 100`;
            const res = await pool.query(query, params);
            toolResult = { employees: res.rows };
          }
        }

        else if (tc.name === "getTeamData") {
          // Security — employees cannot access team data
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers, HR, and admins can view team data." };
          } else {

            if (args.dataType === "timesheets") {
              // Build flexible timesheet query across all employees
              let query = `
              SELECT 
                te.employee_code, te.employee_name, te.date,
                te.project_name, te.task_description, te.total_hours,
                te.status, te.manager_approved, te.submitted_at,
                te.percentage_complete
              FROM time_entries te
              INNER JOIN employees e ON te.employee_id = e.id
              WHERE e.is_active = true
            `;
              const params: any[] = [];

              if (args.department) {
                params.push(args.department);
                query += ` AND LOWER(e.department) = LOWER($${params.length})`;
              }
              if (args.employeeCode) {
                params.push(args.employeeCode);
                query += ` AND LOWER(te.employee_code) = LOWER($${params.length})`;
              }
              if (args.date) {
                params.push(args.date);
                query += ` AND te.date = $${params.length}`;
              } else if (args.startDate && args.endDate) {
                params.push(args.startDate, args.endDate);
                query += ` AND te.date BETWEEN $${params.length - 1} AND $${params.length}`;
              }
              if (args.status) {
                params.push(args.status);
                query += ` AND LOWER(te.status) = LOWER($${params.length})`;
              }

              query += ` ORDER BY te.date DESC, te.employee_name ASC LIMIT 50`;

              const res = await pool.query(query, params);

              // Also fetch who has NOT submitted for a specific date
              let notSubmitted: any[] = [];
              if (args.date || (!args.startDate && !args.endDate)) {
                const targetDate = args.date || today;
                const submittedCodes = res.rows.map((r) => r.employee_code);
                const allEmpQuery = args.department
                  ? `SELECT employee_code, name FROM employees WHERE is_active = true AND LOWER(department) = LOWER($1)`
                  : `SELECT employee_code, name FROM employees WHERE is_active = true`;
                const allEmpRes = args.department
                  ? await pool.query(allEmpQuery, [args.department])
                  : await pool.query(allEmpQuery);
                notSubmitted = allEmpRes.rows.filter(
                  (e) => !submittedCodes.includes(e.employee_code)
                );
              }

              toolResult = {
                dataType: "timesheets",
                totalEntries: res.rows.length,
                timesheets: res.rows,
                notSubmittedToday: notSubmitted,
              };
            }

            else if (args.dataType === "tasks") {
              // Fetch tasks across the whole team from PMS
              let query = `
              SELECT 
                pt.id, pt.task_name, pt.status, pt.priority,
                pt.start_date, pt.end_date, pt.progress,
                p.title as project_name,
                e.name as assigned_to, e.emp_code as employee_code
              FROM project_tasks pt
              INNER JOIN projects p ON pt.project_id = p.id
              LEFT JOIN task_members tm ON pt.id = tm.task_id
              LEFT JOIN employees e ON tm.employee_id = e.id
              WHERE 1=1
            `;
              const params: any[] = [];

              if (args.employeeCode) {
                params.push(args.employeeCode);
                query += ` AND LOWER(e.emp_code) = LOWER($${params.length})`;
              }
              if (args.status) {
                params.push(args.status);
                query += ` AND LOWER(pt.status) = LOWER($${params.length})`;
              }
              if (args.endDate) {
                params.push(args.endDate);
                query += ` AND pt.end_date <= $${params.length}`;
              }

              query += ` ORDER BY pt.end_date ASC NULLS LAST LIMIT 50`;

              const res = await pmsPool.query(query, params);

              // Calculate overdue
              const overdue = res.rows.filter(
                (r) => r.end_date && new Date(r.end_date) < new Date() && r.status?.toLowerCase() !== "completed"
              );

              toolResult = {
                dataType: "tasks",
                totalTasks: res.rows.length,
                overdueTasks: overdue.length,
                tasks: res.rows.map((r) => ({
                  ...r,
                  start_date: formatDate(r.start_date),
                  end_date: formatDate(r.end_date),
                })),
              };
            }

            else if (args.dataType === "leaves") {
              let query = `
              SELECT 
                user_id as employee_code, username as employee_name,
                leave_type, start_date, end_date,
                status, reason, leave_duration_type
              FROM leaves
              WHERE 1=1
            `;
              const params: any[] = [];

              if (args.employeeCode) {
                params.push(args.employeeCode);
                query += ` AND LOWER(user_id) = LOWER($${params.length})`;
              }
              if (args.status) {
                params.push(args.status);
                query += ` AND LOWER(status) = LOWER($${params.length})`;
              }
              if (args.startDate && args.endDate) {
                params.push(args.startDate, args.endDate);
                query += ` AND start_date BETWEEN $${params.length - 1} AND $${params.length}`;
              } else if (args.date) {
                params.push(args.date);
                query += ` AND $${params.length} BETWEEN start_date AND end_date`;
              }

              query += ` ORDER BY start_date DESC LIMIT 50`;

              const res = await lmsPool.query(query, params);

              toolResult = {
                dataType: "leaves",
                totalLeaves: res.rows.length,
                leaves: res.rows.map((r) => ({
                  ...r,
                  start_date: formatDate(r.start_date),
                  end_date: formatDate(r.end_date),
                })),
              };
            }

            else if (args.dataType === "employees") {
              let query = `
              SELECT 
                employee_code, name, department, role,
                group_name, is_active, created_at
              FROM employees
              WHERE is_active = true
            `;
              const params: any[] = [];

              if (args.department) {
                params.push(args.department);
                query += ` AND LOWER(department) = LOWER($${params.length})`;
              }
              if (args.status === "inactive") {
                query = query.replace("is_active = true", "is_active = false");
              }

              query += ` ORDER BY name ASC`;

              const res = await pool.query(query, params);

              toolResult = {
                dataType: "employees",
                totalEmployees: res.rows.length,
                employees: res.rows,
              };
            }
          }
        }

        else if (tc.name === "getEmployeeDetail") {
          // Security — employees cannot view other employees' details
          if (!["manager", "hr", "admin"].includes(userContext.role)) {
            toolResult = { error: "Access denied: only managers, HR, and admins can view employee details." };
          } else {
            const code = args.employeeCode;

            // 1. Profile from main DB
            const profileRes = await pool.query(
              `SELECT employee_code, name, email, department, role, group_name, is_active, created_at
             FROM employees WHERE LOWER(employee_code) = LOWER($1)`,
              [code]
            );

            if (profileRes.rows.length === 0) {
              toolResult = { error: `Employee ${code} not found.` };
            } else {
              const profile = profileRes.rows[0];

              // 2. Recent timesheets (last 7 days)
              const timesheetRes = await pool.query(
                `SELECT date, project_name, task_description, total_hours, status
               FROM time_entries
               WHERE LOWER(employee_code) = LOWER($1)
               ORDER BY date DESC LIMIT 10`,
                [code]
              );

              // 3. Active tasks from PMS
              const taskRes = await pmsPool.query(
                `SELECT pt.task_name, pt.status, pt.progress, pt.end_date, p.title as project_name
               FROM project_tasks pt
               INNER JOIN projects p ON pt.project_id = p.id
               INNER JOIN task_members tm ON pt.id = tm.task_id
               INNER JOIN employees e ON tm.employee_id = e.id
               WHERE LOWER(e.emp_code) = LOWER($1)
                 AND (pt.status IS NULL OR LOWER(pt.status) != 'completed')
               ORDER BY pt.end_date ASC NULLS LAST`,
                [code]
              );

              // 4. Leave history from LMS
              const leaveRes = await lmsPool.query(
                `SELECT leave_type, start_date, end_date, status, reason
               FROM leaves
               WHERE LOWER(user_id) = LOWER($1)
               ORDER BY start_date DESC LIMIT 5`,
                [code]
              );

              toolResult = {
                profile,
                activeTasks: taskRes.rows.map((r) => ({
                  ...r,
                  end_date: formatDate(r.end_date),
                })),
                recentTimesheets: timesheetRes.rows,
                leaveHistory: leaveRes.rows.map((r) => ({
                  ...r,
                  start_date: formatDate(r.start_date),
                  end_date: formatDate(r.end_date),
                })),
              };
            }
          }
        }

        else if (tc.name === "getMyProjects") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const res = await pmsPool.query(
            `SELECT DISTINCT
             p.id,
             p.title as project_name,
             p.project_code,
             p.client_name,
             p.status,
             p.end_date,
             p.progress as progress_percentage
           FROM projects p
           WHERE LOWER(p.status) = 'in progress'
             AND (
               -- 1. Employee is assigned to a task in the project
               EXISTS (
                 SELECT 1 FROM project_tasks pt
                 INNER JOIN task_members tm ON pt.id = tm.task_id
                 INNER JOIN employees e ON tm.employee_id = e.id
                 WHERE pt.project_id = p.id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 2. Employee created the project
               EXISTS (
                 SELECT 1 FROM employees e
                 WHERE e.id = p.created_by_employee_id AND LOWER(e.emp_code) = LOWER($1)
               )
               OR
               -- 3. Employee's department is mapped to the project
               EXISTS (
                 SELECT 1 FROM project_departments pd
                 INNER JOIN employees e ON LOWER(e.department) = LOWER(pd.department)
                 WHERE pd.project_id = p.id AND LOWER(e.emp_code) = LOWER($1)
               )
             )
           ORDER BY project_name`,
            [targetEmpCode]
          );
          toolResult = {
            totalProjects: res.rows.length,
            projects: res.rows,
          };
        }

        else if (tc.name === "getProjectKeySteps") {
          const res = await pmsPool.query(
            `SELECT ks.id, ks.title AS name
           FROM key_steps ks
           INNER JOIN projects p ON ks.project_id = p.id
           WHERE p.project_code = $1
           ORDER BY ks.title`,
            [args.projectCode]
          );
          toolResult = {
            projectCode: args.projectCode,
            keySteps: res.rows,
          };
        }

        else if (tc.name === "getProjectSubtasks") {
          const res = await pmsPool.query(
            `SELECT s.id, s.title, s.description, s.progress,
                  e.emp_code as assigned_emp_code
           FROM subtasks s
           LEFT JOIN employees e
             ON s.assigned_to::text = e.id::text
             OR s.assigned_to::text = e.emp_code::text
           WHERE s.task_id = $1::uuid
             AND (s.is_completed = false OR s.is_completed IS NULL)
             AND (s.progress < 100 OR s.progress IS NULL)`,
            [args.taskId]
          );
          toolResult = {
            taskId: args.taskId,
            subtasks: res.rows,
          };
        }

        else if (tc.name === "submitTimesheetEntry") {
          const empRes = await pool.query(
            "SELECT name FROM employees WHERE id = $1",
            [userContext.employeeId]
          );
          const employeeName = empRes.rows[0]?.name || userContext.employeeCode;
          const totalHours = calcHours(args.startTime, args.endTime);
          const entryDate = args.date || today;
          const entryId = randomUUID();

          await pool.query(
            `INSERT INTO time_entries (
             id, employee_id, employee_code, employee_name, date, project_name,
             task_description, problem_and_issues, quantify, achievements,
             scope_of_improvements, tools_used, start_time, end_time, total_hours,
             percentage_complete, status, manager_approved, submitted_at,
             pms_id, pms_subtask_id, key_step
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),$19,$20,$21
           )`,
            [
              entryId,
              userContext.employeeId,
              userContext.employeeCode,
              employeeName,
              entryDate,
              args.projectName,
              args.taskDescription,
              args.problemAndIssues || "",
              args.quantify || "N/A",
              args.achievements || "",
              args.scopeOfImprovements || "",
              args.toolsUsed || [],
              args.startTime,
              args.endTime,
              totalHours,
              args.percentageComplete ?? 100,
              "pending",
              false,
              args.pmsId || null,
              args.pmsSubtaskId || null,
              args.keyStep || null,
            ]
          );

          toolResult = {
            success: true,
            action: "submitTimesheetEntry",
            entryId,
            project: args.projectName,
            task: args.taskDescription,
            date: entryDate,
            hours: totalHours,
            keyStep: args.keyStep || null,
            message: "Entry saved. Add more tasks or say done to finalize.",
          };
        }

        else if (tc.name === "finalizeTimesheetSubmission") {
          const finalizeDate = args.date || today;
          const port = process.env.PORT || 5003;

          const response = await fetch(
            `http://localhost:${port}/api/time-entries/submit-daily/${userContext.employeeId}/${finalizeDate}`,
            { method: "POST" }
          );

          const result = await response.json().catch(() => ({}));

          toolResult = {
            success: response.ok,
            action: "finalizeTimesheetSubmission",
            date: finalizeDate,
            status: response.ok ? "locked" : "error",
            details: result,
            message: response.ok
              ? "Timesheet finalized and submitted. Confirmation email sent to your manager."
              : "Entries saved but finalization failed. Please check the Time Strap app.",
          };
        }

        else if (tc.name === "submitDailyPlan") {
          const planDate = args.date || today;
          const port = process.env.PORT || 5003;

          const response = await fetch(`http://localhost:${port}/api/daily-plans`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              employeeId: userContext.employeeId,
              date: planDate,
              selectedTasks: (args.selectedTasks || []).map((t: any) => ({
                id: t.id,
                projectName: t.projectName,
                task_name: t.task_name,
                source: t.source || "PMS",
                isLocked: t.isLocked ?? false,
              })),
              unselectedTasks: (args.unselectedTasks || []).map((t: any) => ({
                taskId: t.taskId,
                taskName: t.taskName,
                reason: t.reason,
                newDueDate: t.newDueDate,
              })),
            }),
          });

          const result = await response.json().catch(() => ({}));

          toolResult = {
            success: response.ok,
            action: "submitDailyPlan",
            date: planDate,
            plannedTaskCount: (args.selectedTasks || []).length,
            postponedTaskCount: (args.unselectedTasks || []).length,
            details: result,
            message: response.ok
              ? `Plan submitted for ${planDate}. ${(args.selectedTasks || []).length} tasks planned, ${(args.unselectedTasks || []).length} postponed.`
              : "Plan submission failed. Please try via the Time Strap app.",
          };
        }

        else if (tc.name === "getDailyPlan") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const planDate = args.date || today;

          // Resolve the employee's UUID from their code
          const empRes = await pool.query(
            "SELECT id, name FROM employees WHERE LOWER(employee_code) = LOWER($1)",
            [targetEmpCode]
          );
          if (empRes.rows.length === 0) {
            toolResult = { error: `Employee ${targetEmpCode} not found.` };
          } else {
            const targetEmployeeId = empRes.rows[0].id;
            const targetName = empRes.rows[0].name;
            const plan = await storage.getDailyPlanByDate(targetEmployeeId, planDate);

            if (!plan) {
              toolResult = {
                submitted: false,
                employeeCode: targetEmpCode,
                employeeName: targetName,
                date: planDate,
                message: `No daily plan found for ${targetEmpCode} on ${planDate}.`,
              };
            } else {
              const tasks = await storage.getPlanTasks(plan.id);
              toolResult = {
                submitted: true,
                employeeCode: targetEmpCode,
                employeeName: targetName,
                date: planDate,
                submittedAt: plan.submittedAt,
                totalTasks: tasks.length,
                tasks: tasks.map((t) => ({
                  taskName: t.taskName,
                  projectName: t.projectName,
                  status: t.status,
                  source: t.source,
                })),
              };
            }
          }
        }

        else if (tc.name === "deleteDailyPlan") {
          const targetEmpCode = resolveEmployeeCode(args, userContext);
          const planDate = args.date || today;
          const port = process.env.PORT || 5003;

          // Resolve the employee's UUID from their code
          const empRes = await pool.query(
            "SELECT id FROM employees WHERE LOWER(employee_code) = LOWER($1)",
            [targetEmpCode]
          );
          if (empRes.rows.length === 0) {
            toolResult = { error: `Employee ${targetEmpCode} not found.` };
          } else {
            const targetEmployeeId = empRes.rows[0].id;

            const response = await fetch(
              `http://localhost:${port}/api/daily-plans/${planDate}/${targetEmployeeId}`,
              { method: "DELETE" }
            );

            const result = await response.json().catch(() => ({}));
            toolResult = {
              success: response.ok,
              action: "deleteDailyPlan",
              employeeCode: targetEmpCode,
              date: planDate,
              message: response.ok
                ? `Daily plan for ${planDate} has been deleted successfully.`
                : result.error || "Failed to delete daily plan.",
            };
          }
        }

      } catch (err: any) {
        console.error(`Tool ${tc.name} error:`, err);
        toolResult = { error: err.message };
      }

      currentMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResult),
      } as any);
    }
  }
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "dotenv/config";
import { runCoordinator } from "./server/rag/coordinator";

const userContext = {
  employeeId: "d3995cf8-5d57-452a-a131-d7e1a107ce83",
  employeeCode: "E0048",
  role: "employee",
  department: "Software",
  employeeName: "Durga Devi"
};

async function testQuery(message: string) {
  console.log(`\n========================================`);
  console.log(`TESTING USER QUERY: "${message}"`);
  console.log(`========================================`);

  await runCoordinator({
    message,
    userContext,
    history: [],
    onChunk: (chunk) => {
      if (chunk.type === "text" && chunk.content) {
        process.stdout.write(chunk.content);
      } else if (chunk.type === "done") {
        console.log("\n[Done Streaming]");
      }
    }
  });
  console.log("\n");
}

async function main() {
  console.log("Starting 10-Query Verification Suite...");
  
  const queries = [
    "show my tasks",
    "show my timesheet today",
    "what are office timings",
    "how am i performing this month",
    "what are my at risk tasks",
    "good morning aria",
    "give me my full status today",
    "what is the late arrival policy",
    "check my attendance risk",
    "apply for leave on 2026-06-10"
  ];

  for (const query of queries) {
    await testQuery(query);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test error:", err);
    process.exit(1);
  });

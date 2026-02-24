import { Database } from "./dist/db/database.js";

async function test() {
  const db = new Database("./data/test.db");
  try {
    await db.initialize();
    console.log("Database initialized successfully");
  } catch (error) {
    console.error("Error:", error.message);
  }
}

test();

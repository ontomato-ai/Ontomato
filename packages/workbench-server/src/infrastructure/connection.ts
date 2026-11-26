import { initializePostgres, closePostgres } from "./postgres";
let initialized = false;
export async function initializeConnection() {
  if (!initialized) {
    await initializePostgres();
    initialized = true;
  }
}
export async function closeConnection() {
  await closePostgres();
  initialized = false;
}

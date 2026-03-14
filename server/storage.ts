// Export the storage interface and implementation
export { type IStorage, PostgresStorage } from "./pg-storage";
import { PostgresStorage } from "./pg-storage";

// Create storage instance
export const storage = new PostgresStorage();

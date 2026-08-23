import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userStates = sqliteTable("user_states", {
  userId: text("user_id").primaryKey(),
  userEmail: text("user_email"),
  displayName: text("display_name"),
  schemaVersion: integer("schema_version").notNull().default(2),
  payload: text("payload").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const aiRateLimits = sqliteTable("ai_rate_limits", {
  userId: text("user_id").notNull(),
  windowStart: integer("window_start").notNull(),
  requestCount: integer("request_count").notNull().default(1),
}, (table) => [primaryKey({ columns: [table.userId, table.windowStart] })]);

import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  bio: text("bio"),
  avatar: text("avatar"),
  isOnline: boolean("is_online").default(false),
  lastSeen: timestamp("last_seen"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const friends = pgTable("friends", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  friendId: integer("friend_id").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"), // pending, accepted, rejected
  createdAt: timestamp("created_at").defaultNow(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  senderId: integer("sender_id").notNull().references(() => users.id),
  receiverId: integer("receiver_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const groupChats = pgTable("group_chats", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const groupMembers = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groupChats.id),
  userId: integer("user_id").notNull().references(() => users.id),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const groupMessages = pgTable("group_messages", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groupChats.id),
  senderId: integer("sender_id").notNull().references(() => users.id),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  bio: true,
  avatar: true,
});

export const updateUserSchema = createInsertSchema(users).pick({
  displayName: true,
  bio: true,
  avatar: true,
  isOnline: true,
  lastSeen: true,
});

export const insertFriendSchema = createInsertSchema(friends).pick({
  userId: true,
  friendId: true,
  status: true,
});

export const insertMessageSchema = createInsertSchema(messages).pick({
  senderId: true,
  receiverId: true,
  content: true,
});

export const insertGroupChatSchema = createInsertSchema(groupChats).pick({
  name: true,
  createdBy: true,
});

export const insertGroupMemberSchema = createInsertSchema(groupMembers).pick({
  groupId: true,
  userId: true,
});

export const insertGroupMessageSchema = createInsertSchema(groupMessages).pick({
  groupId: true,
  senderId: true,
  content: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

export type Friend = typeof friends.$inferSelect;
export type InsertFriend = z.infer<typeof insertFriendSchema>;

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export type GroupChat = typeof groupChats.$inferSelect;
export type InsertGroupChat = z.infer<typeof insertGroupChatSchema>;

export type GroupMember = typeof groupMembers.$inferSelect;
export type InsertGroupMember = z.infer<typeof insertGroupMemberSchema>;

export type GroupMessage = typeof groupMessages.$inferSelect;
export type InsertGroupMessage = z.infer<typeof insertGroupMessageSchema>;

// Additional schemas for API requests
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  password: z.string()
    .min(6, "Password must be at least 6 characters"),
  displayName: z.string().optional(),
});

export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;

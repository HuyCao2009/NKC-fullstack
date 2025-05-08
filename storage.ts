import { 
  users, type User, type InsertUser, type UpdateUser,
  friends, type Friend, type InsertFriend,
  messages, type Message, type InsertMessage,
  groupChats, type GroupChat, type InsertGroupChat,
  groupMembers, type GroupMember, type InsertGroupMember,
  groupMessages, type GroupMessage, type InsertGroupMessage
} from "@shared/schema";
import session from "express-session";
import { db } from './db';
import { eq, and, or, desc, count } from 'drizzle-orm';
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, data: UpdateUser): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  
  // Friend methods
  getFriendship(userId: number, friendId: number): Promise<Friend | undefined>;
  getFriendRequests(userId: number): Promise<Friend[]>;
  getFriends(userId: number): Promise<User[]>;
  createFriendRequest(data: InsertFriend): Promise<Friend>;
  updateFriendRequest(id: number, status: string): Promise<Friend | undefined>;
  
  // Message methods
  getMessage(id: number): Promise<Message | undefined>;
  getMessagesBetweenUsers(userId: number, friendId: number): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  markMessagesAsRead(receiverId: number, senderId: number): Promise<void>;
  getUnreadMessageCount(receiverId: number): Promise<number>;
  
  // Group chat methods
  getGroupChat(id: number): Promise<GroupChat | undefined>;
  getUserGroupChats(userId: number): Promise<GroupChat[]>;
  createGroupChat(groupChat: InsertGroupChat): Promise<GroupChat>;
  
  // Group members methods
  addUserToGroup(data: InsertGroupMember): Promise<GroupMember>;
  getGroupMembers(groupId: number): Promise<User[]>;
  
  // Group messages methods
  getGroupMessages(groupId: number): Promise<GroupMessage[]>;
  createGroupMessage(message: InsertGroupMessage): Promise<GroupMessage>;
  
  // Session store
  sessionStore: any;
}

export class DatabaseStorage implements IStorage {
  sessionStore: any;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool,
      createTableIfMissing: true
    });
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values({
      ...insertUser,
      isOnline: false,
      lastSeen: new Date()
    }).returning();
    return user;
  }

  async updateUser(id: number, data: UpdateUser): Promise<User | undefined> {
    const [updatedUser] = await db.update(users)
      .set(data)
      .where(eq(users.id, id))
      .returning();
    return updatedUser;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  // Friend methods
  async getFriendship(userId: number, friendId: number): Promise<Friend | undefined> {
    const [friendship] = await db.select().from(friends).where(
      or(
        and(eq(friends.userId, userId), eq(friends.friendId, friendId)),
        and(eq(friends.userId, friendId), eq(friends.friendId, userId))
      )
    );
    return friendship;
  }

  async getFriendRequests(userId: number): Promise<Friend[]> {
    return await db.select().from(friends)
      .where(and(
        eq(friends.friendId, userId),
        eq(friends.status, "pending")
      ));
  }

  async getFriends(userId: number): Promise<User[]> {
    // Get all accepted friendships where the user is either userId or friendId
    const acceptedFriendships = await db.select().from(friends)
      .where(and(
        or(
          eq(friends.userId, userId),
          eq(friends.friendId, userId)
        ),
        eq(friends.status, "accepted")
      ));
    
    // Extract friend IDs (depending on which side of the friendship the user is on)
    const friendIds = acceptedFriendships.map(f => 
      f.userId === userId ? f.friendId : f.userId
    );
    
    if (friendIds.length === 0) return [];
    
    // Get all users that are friends
    return await db.select().from(users)
      .where(friendIds.length === 1 
        ? eq(users.id, friendIds[0]) 
        : or(...friendIds.map(id => eq(users.id, id)))
      );
  }

  async createFriendRequest(data: InsertFriend): Promise<Friend> {
    const [friend] = await db.insert(friends).values(data).returning();
    return friend;
  }

  async updateFriendRequest(id: number, status: string): Promise<Friend | undefined> {
    const [updatedFriendship] = await db.update(friends)
      .set({ status })
      .where(eq(friends.id, id))
      .returning();
    return updatedFriendship;
  }

  // Message methods
  async getMessage(id: number): Promise<Message | undefined> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    return message;
  }

  async getMessagesBetweenUsers(userId: number, friendId: number): Promise<Message[]> {
    return await db.select().from(messages)
      .where(
        or(
          and(eq(messages.senderId, userId), eq(messages.receiverId, friendId)),
          and(eq(messages.senderId, friendId), eq(messages.receiverId, userId))
        )
      )
      .orderBy(messages.createdAt);
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages)
      .values({
        ...insertMessage,
        isRead: false
      })
      .returning();
    return message;
  }

  async markMessagesAsRead(receiverId: number, senderId: number): Promise<void> {
    await db.update(messages)
      .set({ isRead: true })
      .where(
        and(
          eq(messages.senderId, senderId),
          eq(messages.receiverId, receiverId),
          eq(messages.isRead, false)
        )
      );
  }

  async getUnreadMessageCount(receiverId: number): Promise<number> {
    const result = await db.select({ count: count() })
      .from(messages)
      .where(
        and(
          eq(messages.receiverId, receiverId),
          eq(messages.isRead, false)
        )
      );
    return result[0].count;
  }

  // Group chat methods
  async getGroupChat(id: number): Promise<GroupChat | undefined> {
    const [group] = await db.select().from(groupChats).where(eq(groupChats.id, id));
    return group;
  }

  async getUserGroupChats(userId: number): Promise<GroupChat[]> {
    // Get all group IDs the user is a member of
    const memberGroups = await db.select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, userId));
    
    if (memberGroups.length === 0) return [];
    
    // Get all group chats for those IDs
    const groupIds = memberGroups.map(g => g.groupId);
    return await db.select().from(groupChats)
      .where(groupIds.length === 1 
        ? eq(groupChats.id, groupIds[0]) 
        : or(...groupIds.map(id => eq(groupChats.id, id)))
      );
  }

  async createGroupChat(insertGroupChat: InsertGroupChat): Promise<GroupChat> {
    const [groupChat] = await db.insert(groupChats)
      .values(insertGroupChat)
      .returning();
    return groupChat;
  }

  // Group members methods
  async addUserToGroup(data: InsertGroupMember): Promise<GroupMember> {
    const [groupMember] = await db.insert(groupMembers)
      .values(data)
      .returning();
    return groupMember;
  }

  async getGroupMembers(groupId: number): Promise<User[]> {
    // Get all user IDs in the group
    const members = await db.select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    
    if (members.length === 0) return [];
    
    // Get all users for those IDs
    const userIds = members.map(m => m.userId);
    return await db.select().from(users)
      .where(userIds.length === 1 
        ? eq(users.id, userIds[0]) 
        : or(...userIds.map(id => eq(users.id, id)))
      );
  }

  // Group messages methods
  async getGroupMessages(groupId: number): Promise<GroupMessage[]> {
    return await db.select().from(groupMessages)
      .where(eq(groupMessages.groupId, groupId))
      .orderBy(groupMessages.createdAt);
  }

  async createGroupMessage(insertGroupMessage: InsertGroupMessage): Promise<GroupMessage> {
    const [groupMessage] = await db.insert(groupMessages)
      .values(insertGroupMessage)
      .returning();
    return groupMessage;
  }
}

export const storage = new DatabaseStorage();

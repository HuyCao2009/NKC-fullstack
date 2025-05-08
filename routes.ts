import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth } from "./auth";
import { setupWebsocket } from "./websocket";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

// Setup multer for file uploads
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniquePrefix + '-' + file.originalname);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max size
  fileFilter: (req, file, cb) => {
    // Only accept images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Middleware to check if user is authenticated
function isAuthenticated(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication routes
  setupAuth(app);

  // Create HTTP server
  const httpServer = createServer(app);
  
  // Setup WebSocket server
  setupWebsocket(httpServer);

  // Serve uploaded files
  app.use('/uploads', express.static(uploadsDir));

  // User routes
  app.get("/api/users", isAuthenticated, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      // Remove sensitive data
      const safeUsers = users.map(user => {
        const { password, ...safeUser } = user;
        return safeUser;
      });
      res.json(safeUsers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:id", isAuthenticated, async (req, res) => {
    try {
      const user = await storage.getUser(parseInt(req.params.id));
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      // Remove sensitive data
      const { password, ...safeUser } = user;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch("/api/users/:id", isAuthenticated, async (req, res) => {
    try {
      // Ensure user can only update their own profile
      const userId = parseInt(req.params.id);
      if (userId !== req.user?.id) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const updatedUser = await storage.updateUser(userId, req.body);
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Remove sensitive data
      const { password, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  // Avatar upload
  app.post("/api/users/avatar", isAuthenticated, upload.single('avatar'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const avatarPath = `/uploads/${req.file.filename}`;
      const updatedUser = await storage.updateUser(req.user!.id, { avatar: avatarPath });
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Remove sensitive data
      const { password, ...safeUser } = updatedUser;
      res.json(safeUser);
    } catch (error) {
      res.status(500).json({ message: "Failed to upload avatar" });
    }
  });

  // Friend routes
  app.get("/api/friends", isAuthenticated, async (req, res) => {
    try {
      const friends = await storage.getFriends(req.user!.id);
      // Remove sensitive data
      const safeFriends = friends.map(friend => {
        const { password, ...safeFriend } = friend;
        return safeFriend;
      });
      res.json(safeFriends);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch friends" });
    }
  });

  app.get("/api/friends/requests", isAuthenticated, async (req, res) => {
    try {
      const friendRequests = await storage.getFriendRequests(req.user!.id);
      
      // Get user data for each request
      const requestsWithUserData = await Promise.all(
        friendRequests.map(async (request) => {
          const user = await storage.getUser(request.userId);
          if (!user) return null;
          
          // Remove sensitive data
          const { password, ...safeUser } = user;
          return {
            ...request,
            user: safeUser
          };
        })
      );
      
      // Filter out any null values
      res.json(requestsWithUserData.filter(Boolean));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch friend requests" });
    }
  });

  app.post("/api/friends/request", isAuthenticated, async (req, res) => {
    try {
      const friendId = parseInt(req.body.friendId);
      if (isNaN(friendId)) {
        return res.status(400).json({ message: "Invalid friend ID" });
      }

      // Validate friend exists
      const friend = await storage.getUser(friendId);
      if (!friend) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if the friend request already exists
      const existingFriendship = await storage.getFriendship(req.user!.id, friendId);
      if (existingFriendship) {
        return res.status(400).json({ message: "Friend request already exists" });
      }

      // Create friend request
      const friendRequest = await storage.createFriendRequest({
        userId: req.user!.id,
        friendId,
        status: "pending"
      });

      res.status(201).json(friendRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to send friend request" });
    }
  });

  app.put("/api/friends/request/:id", isAuthenticated, async (req, res) => {
    try {
      const requestId = parseInt(req.params.id);
      if (isNaN(requestId)) {
        return res.status(400).json({ message: "Invalid request ID" });
      }

      const status = req.body.status;
      if (status !== "accepted" && status !== "rejected") {
        return res.status(400).json({ message: "Invalid status" });
      }

      const updatedRequest = await storage.updateFriendRequest(requestId, status);
      if (!updatedRequest) {
        return res.status(404).json({ message: "Friend request not found" });
      }

      res.json(updatedRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to update friend request" });
    }
  });

  // Message routes
  app.get("/api/messages/:friendId", isAuthenticated, async (req, res) => {
    try {
      const friendId = parseInt(req.params.friendId);
      if (isNaN(friendId)) {
        return res.status(400).json({ message: "Invalid friend ID" });
      }

      const messages = await storage.getMessagesBetweenUsers(req.user!.id, friendId);
      res.json(messages);
      
      // Mark messages as read
      await storage.markMessagesAsRead(req.user!.id, friendId);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/messages", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        receiverId: z.number(),
        content: z.string().min(1),
      });
      
      const validatedData = schema.parse(req.body);
      
      const message = await storage.createMessage({
        senderId: req.user!.id,
        receiverId: validatedData.receiverId,
        content: validatedData.content,
      });

      res.status(201).json(message);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Validation error",
          errors: fromZodError(error).message
        });
      }
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Group chat routes
  app.get("/api/groups", isAuthenticated, async (req, res) => {
    try {
      const groups = await storage.getUserGroupChats(req.user!.id);
      res.json(groups);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch group chats" });
    }
  });

  app.post("/api/groups", isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        name: z.string().min(1),
      });
      
      const validatedData = schema.parse(req.body);
      
      const group = await storage.createGroupChat({
        name: validatedData.name,
        createdBy: req.user!.id,
      });

      // Add the creator to the group
      await storage.addUserToGroup({
        groupId: group.id,
        userId: req.user!.id,
      });

      res.status(201).json(group);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Validation error",
          errors: fromZodError(error).message
        });
      }
      res.status(500).json({ message: "Failed to create group chat" });
    }
  });

  app.post("/api/groups/:id/members", isAuthenticated, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }

      const userId = parseInt(req.body.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Validate group exists
      const group = await storage.getGroupChat(groupId);
      if (!group) {
        return res.status(404).json({ message: "Group not found" });
      }

      // Add user to group
      const groupMember = await storage.addUserToGroup({
        groupId,
        userId,
      });

      res.status(201).json(groupMember);
    } catch (error) {
      res.status(500).json({ message: "Failed to add member to group" });
    }
  });

  app.get("/api/groups/:id/messages", isAuthenticated, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }

      const messages = await storage.getGroupMessages(groupId);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch group messages" });
    }
  });

  app.post("/api/groups/:id/messages", isAuthenticated, async (req, res) => {
    try {
      const groupId = parseInt(req.params.id);
      if (isNaN(groupId)) {
        return res.status(400).json({ message: "Invalid group ID" });
      }

      const message = await storage.createGroupMessage({
        groupId,
        senderId: req.user!.id,
        content: req.body.content,
      });

      res.status(201).json(message);
    } catch (error) {
      res.status(500).json({ message: "Failed to send group message" });
    }
  });

  return httpServer;
}

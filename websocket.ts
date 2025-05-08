import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { storage } from './storage';
import { parse } from 'url';

interface ClientConnection {
  userId: number;
  ws: WebSocket;
}

export function setupWebsocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<number, WebSocket>();

  // Handle WebSocket connection
  wss.on('connection', (ws: WebSocket, userId: number) => {
    clients.set(userId, ws);
    
    // Send a welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      data: { message: 'Connected to NKC Chat WebSocket' }
    }));

    // Handle messages from client
    ws.on('message', async (message: string) => {
      try {
        const data = JSON.parse(message);
        
        if (data.type === 'message') {
          // Store the message
          const newMessage = await storage.createMessage({
            senderId: userId,
            receiverId: data.receiverId,
            content: data.content,
          });

          // Send to recipient if they're online
          const recipientWs = clients.get(data.receiverId);
          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify({
              type: 'message',
              data: newMessage
            }));
          }

          // Send confirmation back to sender
          ws.send(JSON.stringify({
            type: 'message_sent',
            data: newMessage
          }));
        }
        
        if (data.type === 'group_message') {
          // Store the group message
          const newMessage = await storage.createGroupMessage({
            groupId: data.groupId,
            senderId: userId,
            content: data.content,
          });

          // Get all group members
          const members = await storage.getGroupMembers(data.groupId);

          // Send to all online group members except the sender
          members.forEach(member => {
            if (member.id !== userId) {
              const memberWs = clients.get(member.id);
              if (memberWs && memberWs.readyState === WebSocket.OPEN) {
                memberWs.send(JSON.stringify({
                  type: 'group_message',
                  data: newMessage
                }));
              }
            }
          });

          // Send confirmation back to sender
          ws.send(JSON.stringify({
            type: 'group_message_sent',
            data: newMessage
          }));
        }
        
        if (data.type === 'typing') {
          const recipientWs = clients.get(data.receiverId);
          if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
            recipientWs.send(JSON.stringify({
              type: 'typing',
              data: { senderId: userId }
            }));
          }
        }
        
        if (data.type === 'read_messages') {
          await storage.markMessagesAsRead(userId, data.senderId);
          
          // Notify the original sender that their messages were read
          const senderWs = clients.get(data.senderId);
          if (senderWs && senderWs.readyState === WebSocket.OPEN) {
            senderWs.send(JSON.stringify({
              type: 'messages_read',
              data: { readerId: userId }
            }));
          }
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Failed to process message' }
        }));
      }
    });

    // Handle client disconnect
    ws.on('close', async () => {
      clients.delete(userId);
      // Update user status to offline
      await storage.updateUser(userId, { 
        isOnline: false, 
        lastSeen: new Date() 
      });
    });
  });

  // Handle HTTP server upgrade to WebSocket
  server.on('upgrade', async (request, socket, head) => {
    const { pathname, query } = parse(request.url || '', true);
    
    if (pathname === '/api/ws') {
      // Get session cookie from request and verify user is authenticated
      const userId = Number(query.userId);
      
      if (isNaN(userId)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      
      // Verify the user exists
      const user = await storage.getUser(userId);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      
      // Update user status to online
      await storage.updateUser(userId, { isOnline: true });
      
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, userId);
      });
    } else {
      socket.destroy();
    }
  });

  return wss;
}

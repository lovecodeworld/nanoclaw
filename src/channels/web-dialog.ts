/**
 * Web Dialog Channel
 *
 * Provides a web-based chat interface for testing and development.
 * Works standalone without any other channel configuration.
 *
 * Features:
 * - HTTP server with simple web UI
 * - WebSocket for real-time bidirectional communication
 * - Session-based JIDs (web:session-uuid)
 * - Auto-registration for standalone usage
 */
import { createServer, Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';

import { Channel, RegisteredGroup } from '../types.js';
import { ChannelOpts, registerChannel } from './registry.js';
import { logger } from '../logger.js';

interface WebSession {
  id: string;
  ws: WebSocket;
  jid: string;
  userName: string;
  connectedAt: Date;
}

class WebDialogChannel implements Channel {
  name = 'web-dialog';
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private sessions = new Map<string, WebSession>();
  private jidToSession = new Map<string, string>();
  private connected = false;

  constructor(
    private port: number,
    private onMessage: ChannelOpts['onMessage'],
    private onChatMetadata: ChannelOpts['onChatMetadata'],
    private registeredGroups: () => Record<string, RegisteredGroup>,
    private registerGroup: (jid: string, group: RegisteredGroup) => void,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    this.httpServer = createServer((req, res) => {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.getWebUI());
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sessions: this.sessions.size }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws: WebSocket) => {
      const sessionId = randomUUID();
      const jid = `web:${sessionId}`;
      const userName = `WebUser-${sessionId.slice(0, 8)}`;

      const session: WebSession = {
        id: sessionId,
        ws,
        jid,
        userName,
        connectedAt: new Date(),
      };

      this.sessions.set(sessionId, session);
      this.jidToSession.set(jid, sessionId);

      logger.info({ sessionId, jid }, 'Web dialog session connected');

      // Send welcome message
      ws.send(
        JSON.stringify({
          type: 'system',
          message: `Connected as ${userName}. Session ID: ${sessionId}`,
          sessionId,
          jid,
        }),
      );

      // Register chat metadata
      this.onChatMetadata(
        jid,
        new Date().toISOString(),
        userName,
        'web-dialog',
        false,
      );

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'chat') {
            const msgId = randomUUID();
            const timestamp = new Date().toISOString();

            // Auto-register this session if not already registered
            const groups = this.registeredGroups();
            if (!groups[jid]) {
              logger.info(
                { jid, userName },
                'Auto-registering web dialog session',
              );
              this.registerGroup(jid, {
                name: userName,
                folder: `web_${sessionId}`,
                trigger: '@Andy',
                added_at: timestamp,
                requiresTrigger: false, // No trigger required for web sessions
                isMain: false,
              });
            }

            // Store and deliver message to orchestrator
            this.onMessage(jid, {
              id: msgId,
              chat_jid: jid,
              sender: jid,
              sender_name: userName,
              content: message.content,
              timestamp,
              is_from_me: false,
              is_bot_message: false,
            });

            logger.debug(
              { sessionId, content: message.content },
              'Web dialog message received',
            );
          }
        } catch (err) {
          logger.error({ err }, 'Failed to parse web dialog message');
        }
      });

      ws.on('close', () => {
        logger.info({ sessionId, jid }, 'Web dialog session disconnected');
        this.sessions.delete(sessionId);
        this.jidToSession.delete(jid);
      });

      ws.on('error', (err) => {
        logger.error({ err, sessionId }, 'Web dialog WebSocket error');
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.port, '0.0.0.0', () => {
        logger.info({ port: this.port }, 'Web dialog channel started');
        this.connected = true;
        resolve();
      });

      this.httpServer!.on('error', reject);
    });
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const sessionId = this.jidToSession.get(jid);
    if (!sessionId) {
      logger.warn({ jid }, 'Web dialog session not found for JID');
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn({ jid, sessionId }, 'Web dialog session not found');
      return;
    }

    if (session.ws.readyState !== WebSocket.OPEN) {
      logger.warn({ jid, sessionId }, 'Web dialog WebSocket not open');
      return;
    }

    session.ws.send(
      JSON.stringify({
        type: 'message',
        content: text,
        timestamp: new Date().toISOString(),
      }),
    );

    logger.debug(
      { jid, content: text.substring(0, 100) },
      'Web dialog message sent',
    );
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    // Close all WebSocket connections
    for (const session of this.sessions.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.close();
      }
    }

    this.sessions.clear();
    this.jidToSession.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.connected = false;
    logger.info('Web dialog channel stopped');
  }

  private getWebUI(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NanoClaw Web Dialog</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .container {
            width: 90%;
            max-width: 800px;
            height: 90vh;
            background: white;
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
        }
        .header h1 {
            font-size: 24px;
            margin-bottom: 5px;
        }
        .header .status {
            font-size: 14px;
            opacity: 0.9;
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .message {
            margin-bottom: 16px;
            animation: fadeIn 0.3s ease-in;
        }
        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        .message.user {
            text-align: right;
        }
        .message .bubble {
            display: inline-block;
            max-width: 70%;
            padding: 12px 16px;
            border-radius: 18px;
            word-wrap: break-word;
            white-space: pre-wrap;
        }
        .message.user .bubble {
            background: #667eea;
            color: white;
            border-bottom-right-radius: 4px;
        }
        .message.assistant .bubble {
            background: white;
            color: #333;
            border-bottom-left-radius: 4px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        .message.system .bubble {
            background: #ffeaa7;
            color: #636e72;
            font-size: 13px;
            text-align: center;
            width: 100%;
            max-width: 100%;
        }
        .input-area {
            padding: 20px;
            background: white;
            border-top: 1px solid #e0e0e0;
            display: flex;
            gap: 10px;
        }
        #messageInput {
            flex: 1;
            padding: 12px 16px;
            border: 2px solid #e0e0e0;
            border-radius: 24px;
            font-size: 14px;
            outline: none;
            transition: border-color 0.2s;
        }
        #messageInput:focus {
            border-color: #667eea;
        }
        #sendButton {
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 24px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        #sendButton:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
        }
        #sendButton:active {
            transform: translateY(0);
        }
        #sendButton:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .typing-indicator {
            display: none;
            padding: 12px 16px;
            background: white;
            border-radius: 18px;
            width: 60px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        .typing-indicator.active {
            display: inline-block;
        }
        .typing-indicator span {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #999;
            border-radius: 50%;
            margin: 0 2px;
            animation: bounce 1.4s infinite ease-in-out both;
        }
        .typing-indicator span:nth-child(1) {
            animation-delay: -0.32s;
        }
        .typing-indicator span:nth-child(2) {
            animation-delay: -0.16s;
        }
        @keyframes bounce {
            0%, 80%, 100% {
                transform: scale(0);
            }
            40% {
                transform: scale(1);
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>NanoClaw Web Dialog</h1>
            <div class="status" id="status">Connecting...</div>
        </div>
        <div class="messages" id="messages">
            <div class="message system">
                <div class="bubble">Connecting to NanoClaw...</div>
            </div>
        </div>
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="Type your message..." disabled>
            <button id="sendButton" disabled>Send</button>
        </div>
    </div>

    <script>
        const messagesDiv = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const statusDiv = document.getElementById('status');

        let ws;
        let sessionId;
        let jid;

        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(protocol + '//' + window.location.host);

            ws.onopen = () => {
                console.log('WebSocket connected');
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'system') {
                        addMessage('system', data.message);
                        sessionId = data.sessionId;
                        jid = data.jid;
                        statusDiv.textContent = 'Connected - ' + sessionId.slice(0, 8);
                        messageInput.disabled = false;
                        sendButton.disabled = false;
                        messageInput.focus();
                    } else if (data.type === 'message') {
                        addMessage('assistant', data.content);
                    }
                } catch (err) {
                    console.error('Failed to parse message:', err);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                statusDiv.textContent = 'Connection error';
            };

            ws.onclose = () => {
                console.log('WebSocket closed');
                statusDiv.textContent = 'Disconnected';
                messageInput.disabled = true;
                sendButton.disabled = true;
                addMessage('system', 'Connection closed. Refresh to reconnect.');
            };
        }

        function addMessage(type, content) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + type;

            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            bubble.textContent = content;

            messageDiv.appendChild(bubble);
            messagesDiv.appendChild(messageDiv);

            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function sendMessage() {
            const content = messageInput.value.trim();
            if (!content || !ws || ws.readyState !== WebSocket.OPEN) return;

            ws.send(JSON.stringify({
                type: 'chat',
                content: content
            }));

            addMessage('user', content);
            messageInput.value = '';
        }

        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        sendButton.addEventListener('click', sendMessage);

        connect();
    </script>
</body>
</html>`;
  }
}

// Channel factory - always enabled (no credentials needed)
function createWebDialogChannel(opts: ChannelOpts): Channel | null {
  const port = parseInt(process.env.WEB_DIALOG_PORT || '3002', 10);

  logger.info({ port }, 'Initializing web dialog channel');

  return new WebDialogChannel(
    port,
    opts.onMessage,
    opts.onChatMetadata,
    opts.registeredGroups,
    opts.registerGroup,
  );
}

// Register channel
registerChannel('web-dialog', createWebDialogChannel);

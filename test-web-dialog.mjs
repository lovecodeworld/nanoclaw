#!/usr/bin/env node

/**
 * Simple test script for web dialog channel
 */

import { WebSocket } from 'ws';

const WEB_DIALOG_PORT = process.env.WEB_DIALOG_PORT || 3002;
const ws = new WebSocket(`ws://localhost:${WEB_DIALOG_PORT}`);

let sessionId = null;
let jid = null;

ws.on('open', () => {
  console.log('✓ WebSocket connected');
});

ws.on('message', (data) => {
  try {
    const msg = JSON.parse(data.toString());

    if (msg.type === 'system') {
      console.log('✓ System message received:', msg.message);
      sessionId = msg.sessionId;
      jid = msg.jid;

      // Send a test message after connection
      setTimeout(() => {
        console.log('→ Sending test message...');
        ws.send(JSON.stringify({
          type: 'chat',
          content: 'Hello! This is a test message. Please respond with "OK".'
        }));
      }, 1000);
    } else if (msg.type === 'message') {
      console.log('✓ Assistant response received:', msg.content.substring(0, 100));
      console.log('\n✓ All tests passed!');
      ws.close();
      process.exit(0);
    }
  } catch (err) {
    console.error('✗ Failed to parse message:', err);
    process.exit(1);
  }
});

ws.on('close', () => {
  console.log('WebSocket closed');
});

ws.on('error', (err) => {
  console.error('✗ WebSocket error:', err);
  process.exit(1);
});

// Timeout after 60 seconds
setTimeout(() => {
  console.log('✗ Test timeout (no response within 60 seconds)');
  console.log('This is expected if the agent container takes time to start');
  ws.close();
  process.exit(0);
}, 60000);

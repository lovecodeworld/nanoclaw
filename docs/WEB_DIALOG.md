# Web Dialog Channel

A web-based chat interface for NanoClaw that works standalone without any other channel configuration. Perfect for testing, development, and scenarios where you don't have access to messaging platforms.

## Features

- **Zero Configuration**: Works out-of-the-box without credentials
- **Real-time Communication**: WebSocket-based bidirectional messaging
- **Beautiful UI**: Clean, modern web interface
- **Session Management**: Each browser connection gets a unique session
- **Standalone Mode**: No other channels required

## Quick Start

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   npm run build
   ```

2. **Start NanoClaw**:
   ```bash
   npm start
   ```

3. **Open your browser**:
   Navigate to `http://localhost:3002` (or the port you configured)

4. **Start chatting!**
   The web interface will automatically connect and you can start sending messages to your NanoClaw assistant.

## Configuration

The web dialog channel can be configured via environment variables:

```bash
# .env file
WEB_DIALOG_PORT=3002  # Port for the web server (default: 3002)
```

## How It Works

### Architecture

1. **HTTP Server**: Serves the web UI and handles health checks
2. **WebSocket Server**: Manages real-time bidirectional communication
3. **Session Management**: Each connection gets a unique JID (`web:session-uuid`)
4. **Message Flow**:
   - User sends message via WebSocket
   - Message routed to NanoClaw orchestrator
   - Agent processes message in container
   - Response sent back via WebSocket

### JID Format

Web dialog uses JIDs with the `web:` prefix:
- Format: `web:session-uuid`
- Example: `web:a1b2c3d4-e5f6-7890-abcd-ef1234567890`

### Endpoints

- `GET /` - Web chat interface
- `GET /health` - Health check (returns session count)
- `WebSocket /` - WebSocket connection for chat

## Testing with GitHub Models API

GitHub provides free AI model inference for testing. To use it:

1. **Set environment variables**:
   ```bash
   # Use GitHub token (automatically available in GitHub Actions)
   export ANTHROPIC_API_KEY=$GITHUB_TOKEN
   export ANTHROPIC_BASE_URL=https://models.inference.ai.azure.com
   ```

2. **Run in GitHub Actions**:
   The included workflow file `.github/workflows/test-web-dialog.yml` demonstrates end-to-end testing using GitHub's free models.

3. **Available Models**:
   - GPT-4o
   - GPT-4o-mini
   - And others (see [GitHub Marketplace Models](https://github.com/marketplace/models))

**Note**: GitHub Models API uses OpenAI-compatible format, not Anthropic format. The credential proxy handles API forwarding.

## Development

### Running in Development Mode

```bash
npm run dev
```

The server will reload automatically when you make changes.

### Testing Locally

```bash
# Terminal 1: Start NanoClaw
npm start

# Terminal 2: Test WebSocket connection
node << 'EOF'
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3002');

ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({
    type: 'chat',
    content: 'Hello!'
  }));
});

ws.on('message', (data) => {
  console.log('Received:', JSON.parse(data.toString()));
});
EOF
```

### Testing with curl

```bash
# Health check
curl http://localhost:3002/health

# Get web UI
curl http://localhost:3002/
```

## Integration with Other Channels

The web dialog channel works alongside other channels (WhatsApp, Telegram, Slack, etc.). Each channel owns its JID namespace:

- WhatsApp: `*@g.us`, `*@s.whatsapp.net`
- Telegram: `tg:*`
- Slack: `slack:*`
- Discord: `dc:*`
- **Web Dialog**: `web:*`

Messages are automatically routed to the correct channel based on JID prefix.

## Security Considerations

### Production Deployment

If deploying the web dialog channel to production, consider:

1. **Authentication**: Add user authentication to prevent unauthorized access
2. **Rate Limiting**: Implement rate limiting to prevent abuse
3. **HTTPS**: Use a reverse proxy (nginx, Caddy) with SSL/TLS
4. **Firewall**: Restrict access to known IP addresses if possible

### Example nginx Configuration

```nginx
server {
    listen 443 ssl;
    server_name nanoclaw.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Troubleshooting

### Web UI not loading

1. Check if NanoClaw is running: `ps aux | grep node`
2. Verify port is not in use: `lsof -i :3002`
3. Check logs for errors
4. Ensure build is up to date: `npm run build`

### WebSocket connection fails

1. Check firewall rules (allow incoming on port 3002)
2. Verify no reverse proxy is blocking WebSocket upgrades
3. Check browser console for errors (F12)
4. Test with different browser

### Messages not being processed

1. Check that agent container is built: `docker images | grep nanoclaw`
2. Verify database is accessible: `ls -la data/nanoclaw.db`
3. Check container runtime is running (Docker Desktop, Podman, etc.)
4. Review logs for container errors

### GitHub Actions test failing

1. Ensure `GITHUB_TOKEN` has correct permissions
2. Verify Docker is available in runner
3. Check if GitHub Models API is accessible from runner
4. Review workflow logs for specific errors

## Contributing

Contributions are welcome! Please ensure:

1. Code follows existing style (run `npm run format`)
2. TypeScript compiles without errors (`npm run typecheck`)
3. Tests pass (`npm test`)
4. Web UI works in modern browsers (Chrome, Firefox, Safari, Edge)

## License

Same as NanoClaw project license.

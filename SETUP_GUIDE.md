# 🚀 Interactive Setup Guide

The PR Automation service now includes an interactive setup wizard that simplifies the entire configuration process!

## Quick Start

### Option 1: Interactive Setup (Recommended)

Run the setup wizard and follow the prompts:

```bash
npm run setup
```

The wizard will guide you through:
- ✅ Prerequisites checking (Node.js, Docker, Claude CLI)
- 🤖 Claude authentication setup (session, API key, or GLM models)
- 🔧 Bitbucket configuration (token, username, and workspace)
- ⚙️ Server settings (port, webhooks, event filtering)
- 🐳 Docker services setup
- 📝 Configuration file generation

### Option 2: Manual Setup

If you prefer manual setup, follow the [original README instructions](./README.md#quick-start).

## Setup Wizard Features

### 🔐 Claude Authentication Methods

1. **Session-based (Recommended)**
   - Uses your existing Claude CLI login
   - Maintains your permissions and settings
   - Instructions: Run `claude auth login` first

2. **API Key Authentication**
   - Uses Anthropic API directly
   - Requires API key from https://console.anthropic.com/
   - Good for automated environments

3. **GLM Model Integration**
   - Alternative AI model (Chinese language focused)
   - Uses API key from https://open.bigmodel.cn/
   - Model options: glm-4.6, glm-4, glm-3-turbo

### 🔗 Bitbucket Configuration

**App Password Method:**
1. Go to Bitbucket → Personal Settings → App passwords
2. Create password with "Repositories: Read" and "Pull requests: Read" permissions
3. Use your username and the generated app password in the setup wizard

### ⚙️ Server Configuration

- **Port**: Default 3000 (customizable)
- **Event Filtering**: Process only PR creation vs all events
- **Webhook Security**: Optional signature validation with auto-generated secrets
- **Workspace**: Your Bitbucket workspace (default: xriopteam)

## Configuration Files Generated

The setup wizard creates:

### `.env` - Environment Configuration
```env
PORT=3000
CLAUDE_MODEL=sonnet
BITBUCKET_TOKEN=your-token
BITBUCKET_WEBHOOK_SECRET=your-secret
ALLOWED_WORKSPACE=your-workspace
PROCESS_ONLY_CREATED=false
```

### `claude-config/.claude.json` - Claude Configuration
Generated based on your chosen authentication method.

### `.mcp.json` - MCP Server Configuration
Bitbucket integration settings.

### `docker-compose.yml` - Docker Configuration
Service orchestration (created from example if needed).

## Docker Integration

The setup wizard includes full Docker support:

### Automated Docker Operations
- ✅ Checks Docker installation and daemon status
- 🐳 Builds Docker image automatically
- 🚀 Starts services with health checks
- 📊 Shows service status and recent logs
- 🔧 **Smart error handling with recovery options**

### Docker Build Failure Recovery
If Docker build fails, the setup wizard automatically offers:

1. **🔄 Rebuild without cache** - Clears Docker cache and retries
2. **💻 Local development** - Sets up local Node.js environment
3. **❌ Skip Docker** - Configure manually later
4. **🔧 Troubleshooting guide** - Step-by-step Docker fixes

### Manual Docker Commands
```bash
# View logs
docker-compose logs -f

# Check status
docker-compose ps

# Restart services
docker-compose restart

# Stop services
docker-compose down

# Rebuild image
docker-compose build --no-cache

# Execute shell in container
docker-compose exec pr-automation sh
```

## Troubleshooting

### Common Issues

**Docker Permission Denied:**
```bash
sudo usermod -aG docker $USER
newgrp docker
```

**Port Already in Use:**
- Stop other services on port 3000
- Or choose a different port during setup

**Claude CLI Not Found:**
```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```

**Docker Build Timeout:**
```bash
docker-compose build --no-cache
```

### Re-running Setup

You can re-run the setup wizard anytime:
```bash
npm run setup
```

The wizard will:
- Backup existing `.env` file to `.env.backup`
- Update only the configurations you change
- Preserve existing data where possible

## Validation Features

The setup wizard includes comprehensive validation:

### Pre-flight Checks
- ✅ Node.js version compatibility
- ✅ Docker installation and daemon status
- ✅ Claude CLI availability
- ✅ Project directory validation

### Configuration Validation
- ✅ Required fields presence
- ✅ Port range validation
- ✅ Authentication method compatibility
- ✅ API key format validation

### Service Health Checks
- ✅ Container startup verification
- ✅ Health endpoint testing
- ✅ Service connectivity validation

## Next Steps After Setup

1. **Configure Bitbucket Webhook:**
   - URL: `http://your-server:3000/webhook/bitbucket/pr`
   - Secret: Use the generated secret from setup
   - Events: PR Created, PR Updated

2. **Test the Service:**
   ```bash
   curl http://localhost:3000/health
   ```

3. **Monitor Logs:**
   ```bash
   docker-compose logs -f
   ```

## Support

For issues with the setup wizard:
1. Check the troubleshooting section above
2. Review the [main README](./README.md)
3. Check [Webhook Security Guide](./WEBHOOK_SECURITY.md)
4. Review [Prometheus Monitoring](./PROMETHEUS.md)

---

**🎉 Your PR automation service is ready to use!**
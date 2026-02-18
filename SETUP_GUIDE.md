# 🚀 Interactive Setup Guide

The PR Automation service now includes an interactive setup wizard that simplifies the entire configuration process!

## Quick Start

### Option 1: Interactive Setup (Recommended)

**Run the wizard from the project root** (where `package.json` lives):

```bash
npm run setup
```

**What the wizard does (in order):**
1. **Prerequisites** – Checks Node.js, Docker, and that you're in the project directory.
2. **Claude auth** – Asks how to authenticate (session, API key, or GLM).
3. **Bitbucket** – Token, user, workspace.
4. **Server** – Port, event filter, webhook secret, non-allowed users.
5. **Review** – Shows a summary and asks for confirmation.
6. **Generate files** – Writes `.env`, updates `claude-config/.claude.json`, then **creates or updates `src/config/config.json`** (from `config.json.example` if `config.json` is missing, or merges in new defaults if it exists). The path used is `./src/config/config.json` relative to your current working directory.
7. **Docker** – Optionally builds and starts containers.

**Note:** `src/config/config.json` is gitignored. After setup you should see a line like `✓ config.json created: /absolute/path/to/repo/src/config/config.json`. If you don't see it, run `npm run setup` from the repo root and check that path.

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
- **Workspace**: Your Bitbucket workspace (default: yourworkspace)

## Configuration Files Generated

The setup wizard creates:

### `.env` - Secrets and optional overrides
```env
BITBUCKET_TOKEN=your-token
BITBUCKET_USER=your-username
BITBUCKET_WEBHOOK_SECRET=your-secret
```
Other app settings (port, model, workspace, etc.) are in `src/config/config.json`. You can still override them via env (e.g. `PORT=3000`, `CLAUDE_MODEL=sonnet`) if needed.

### `claude-config/.claude.json` - Claude Configuration
Generated based on your chosen authentication method.

### `.mcp.json` - MCP Server Configuration
Bitbucket integration settings.

### Configuration: config.json and environment

**Single source of truth:** Non-secret app settings live in `src/config/config.json`. Environment variables override config.json (useful for Docker or per-environment overrides). Secrets are never stored in config.json and must be set via environment (e.g. `.env` or docker-compose).

**Secrets (env only):** `BITBUCKET_TOKEN`, `BITBUCKET_USER`, `BITBUCKET_WEBHOOK_SECRET`. Also `SHELL` and `NODE_ENV` are runtime/env-only.

**config.json** holds: server (port), claude (model, timeoutMinutes, maxDiffSizeKb), bitbucket (allowedWorkspace, nonAllowedUsers), eventFilter (processOnlyCreated), metrics (persistence), logging, circuitBreaker, promptLogs (enabled, path), plus defaultTemplate, repositories, prReview, releaseNote. Any of these can be overridden by the corresponding env var (e.g. `PORT`, `CLAUDE_MODEL`, `ALLOWED_WORKSPACE`). See README "Configuration" for the full list.

### `src/config/config.json` - App configuration (templates + branch rules)
Created or migrated by the setup wizard. Contains:
- **defaultTemplate** and **repositories**: which PR review template to use per repo.
- **prReview**: when to enqueue a PR review job (empty target patterns = all PRs).
- **releaseNote**: when to enqueue a release-note job (e.g. target branch `^release-`).
- **server**, **claude**, **bitbucket**, **eventFilter**, **metrics**, **logging**, **circuitBreaker**, **promptLogs**: app settings (see file for defaults).

Edit this file to customize branch rules or template mapping. Restart the service after changes.

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
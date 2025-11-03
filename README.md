# PR Automation with Claude CLI

A simple Docker-based automation service that receives Bitbucket pull request webhooks, clones/validates the repository, and processes them using **Claude CLI** (not the API).

## Features

- 🔗 Receives Bitbucket PR creation webhooks
- 🔒 Webhook signature validation & workspace restriction (xriopteam)
- 📦 Automatically clones repositories if not already present
- 🔄 Updates existing repositories before processing
- 🤖 Processes PR data with Claude CLI (`--dangerously-skip-permissions`)
- 🐳 Fully containerized with Docker
- ⚡ Express.js REST API
- 📝 Easy configuration with environment variables
- 📊 Prometheus metrics integration for monitoring

## Prerequisites

- Docker and Docker Compose installed
- Bitbucket repository with webhook access
- Bitbucket credentials (App Password or Personal Access Token)

**Note:** This uses Claude CLI (installed globally in Docker), **not** the Anthropic API, so you don't need an API key!

## Quick Start

**📖 For complete setup instructions, see [SETUP_GUIDE.md](./SETUP_GUIDE.md)**

### Quick Start Commands

```bash
# Interactive setup (recommended)
npm run setup

# Or start manually after configuration
docker-compose up -d
```

### What You Need

- ✅ Docker and Docker Compose installed
- ✅ Bitbucket repository with webhook access
- ✅ Claude CLI installed globally: `npm install -g @anthropic-ai/claude-code`

### Configure Bitbucket Webhook

1. Go to your Bitbucket repository settings
2. Navigate to **Webhooks** section
3. Click **Add webhook**
4. Configure:
   - **Title**: PR Automation
   - **URL**: `http://your-server:3000/webhook/bitbucket/pr`
   - **Status**: Active
   - **Triggers**: Select "Pull Request" → "Created"
5. Save the webhook

## How It Works

### Workflow

1. **Webhook Received**: Bitbucket sends a webhook when a PR is created
2. **Project Validation**: The system checks if the repository is cloned in `/app/projects`
   - If **not cloned**: Clones the repository from Bitbucket
   - If **already exists**: Updates the repository (git pull)
3. **Claude CLI Processing**: Executes `claude --dangerously-skip-permissions` with the prompt
   - Runs in the project directory with terminal access
   - Can execute git commands, read files, analyze code
   - Outputs text-based review
4. **Response**: Claude's analysis is logged (can be extended to post comments, etc.)

### Claude CLI vs API

This implementation uses **Claude CLI** instead of the Anthropic API:

| Feature | Claude CLI | Anthropic API |
|---------|------------|---------------|
| Authentication | Uses CLI session (no API key needed) | Requires `ANTHROPIC_API_KEY` |
| Capabilities | Full terminal access, can run commands | Text-only, no command execution |
| Installation | `npm install -g @anthropic-ai/claude-code` | `npm install @anthropic-ai/sdk` |
| Automation | Uses `--dangerously-skip-permissions` | Direct API calls |
| Cost | Free (uses Claude CLI session) | Pay per token |

### Project Structure

```
@pr-automation/
├── src/
│   ├── index.js          # Express server and webhook handler
│   ├── claude.js         # Claude CLI integration with validation
│   ├── git.js            # Git operations (clone, update, validate)
│   ├── metrics.js        # Prometheus metrics collection
│   ├── logger.js         # Logging configuration
│   └── template-manager.js # Template management for PR reviews
├── tests/                # Unit tests directory
│   ├── claude.test.js    # Tests for Claude.js functionality
│   ├── git.test.js       # Tests for Git operations
│   └── metrics.test.js   # Tests for metrics collection
├── projects/             # Cloned repositories (volume mounted)
├── Dockerfile            # Docker image with Claude CLI installed
├── docker-compose.yml    # Docker Compose setup
├── jest.config.json      # Jest testing configuration
├── package.json          # Node.js dependencies and scripts
├── .env.example          # Environment variables template
└── README.md             # This file
```

## API Endpoints

### Health Check
```
GET /health
```
Returns the service status.

**Response:**
```json
{
  "status": "ok",
  "message": "PR Automation service is running"
}
```

### Bitbucket PR Webhook
```
POST /webhook/bitbucket/pr
```
Receives Bitbucket pull request creation webhooks.

**Expected Headers:**
- `x-event-key`: Should be `pullrequest:created`

**Response:**
```json
{
  "message": "Webhook received successfully",
  "prTitle": "Add new feature"
}
```

## Customizing PR Review Templates

The system supports modular templates for customizing review behavior without code changes.

### Quick Template Setup

**1. Create a custom template:**
```bash
touch src/templates/custom/my-review.md
```

**2. Write your template with variables:**
```markdown
**Role:** You are a security-focused code reviewer.
**Goal:** Review {{repository}} for vulnerabilities.
**PR:** `{{prUrl}}`

## Security Checklist
- Check for SQL injection
- Verify input validation
- Review authentication logic

## Final Step: Output Metrics
```json
{"isLgtm": true/false, "issueCount": 0}
```

**3. Map repository to template:**

```json
// src/config/template-config.json
{
  "defaultTemplate": "default",
  "repositories": {
    "payment-api": "my-review"
  }
}
```
**4. Restart service:**

```bash
docker-compose restart pr-automation
```

### Available Variables

Use these in your templates: `{{prUrl}}`, `{{title}}`, `{{author}}`, `{{repository}}`, `{{sourceBranch}}`, `{{destinationBranch}}`, `{{description}}`

### Built-in Example Templates

- **`security-focused`** - Security vulnerability analysis
- **`performance-review`** - Performance bottleneck detection  
- **`quick-review`** - Fast review for small changes

### Complete Documentation

📖 **See [TEMPLATE_GUIDE.md](./TEMPLATE_GUIDE.md)**.

## Testing

This project includes comprehensive unit tests to ensure code quality and reliability.

### Running Tests

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode (auto-reruns on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```
****
## Development

### Running without Docker

```bash
# Install Claude CLI globally
npm install -g @anthropic-ai/claude-code

# Install dependencies
npm install

# Run tests to verify setup
npm test

# Create projects directory
mkdir projects

# Start in development mode with auto-reload
npm run dev
```

### Running with Docker (Development)

The docker-compose.yml includes volume mounts for hot-reloading:

```bash
docker-compose up
```

## Claude CLI Command

The system executes Claude CLI like this:

```bash
claude --dangerously-skip-permissions \
  -p "$(cat prompt.txt)" \
  --model "sonnet" \
  --output-format text
```

### Flags Explained:
- `--dangerously-skip-permissions`: Skip interactive approval prompts (required for automation)
- `-p`: Provide prompt from file
- `--model`: Choose model (haiku, sonnet, opus)
- `--output-format text`: Get plain text output

## Git Operations

The system automatically handles git operations:

- **Clone**: If repository doesn't exist, clones from Bitbucket
- **Update**: If repository exists, pulls latest changes
- **Authentication**: Uses credentials from environment variables

### Supported Authentication Methods

1. **App Password/Token** (recommended):
   ```env
   BITBUCKET_TOKEN=your-token-here
   ```

2. **Username and Password**:
   ```env
   BITBUCKET_USER=your-username
   BITBUCKET_PASSWORD=your-password
   ```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLAUDE_MODEL` | No | `sonnet` | Claude model: `haiku`, `sonnet`, or `opus` |
| `BITBUCKET_TOKEN` | Yes* | - | Bitbucket App Password or Token |
| `BITBUCKET_USER` | Yes* | - | Bitbucket username (if not using token) |
| `BITBUCKET_PASSWORD` | Yes* | - | Bitbucket password (if not using token) |
| `BITBUCKET_WEBHOOK_SECRET` | Recommended | - | Webhook signature validation secret |
| `ALLOWED_WORKSPACE` | No | `xriopteam` | Bitbucket workspace/organization slug to accept webhooks from |
| `PROCESS_ONLY_CREATED` | No | `false` | Set to `true` to only process PR creation events (ignore updates) |
| `PORT` | No | `3000` | Server port |
| `METRICS_PERSISTENCE_ENABLED` | No | `false` | Enable metrics persistence to survive restarts/rebuilds |
| `METRICS_PERSISTENCE_TYPE` | No | `filesystem` | Storage type: `filesystem` or `sqlite` |
| `METRICS_PERSISTENCE_PATH` | No | `./metrics-storage` | Path to store metrics data |
| `METRICS_PERSISTENCE_SAVE_INTERVAL_MS` | No | `30000` | Save interval in milliseconds (30 seconds) |

\* Use either `BITBUCKET_TOKEN` or `BITBUCKET_USER` + `BITBUCKET_PASSWORD`

## Troubleshooting

### Check if service is running
```bash
curl http://localhost:3000/health
```

### View logs
```bash
docker-compose logs -f pr-automation
```

### Test Claude CLI in container
```bash
docker-compose exec pr-automation sh
claude --help
```

### Check cloned projects
```bash
docker-compose exec pr-automation ls -la /app/projects
```

### Test git clone manually
```bash
docker-compose exec pr-automation sh
cd /app/projects
git clone https://x-token-auth:YOUR_TOKEN@bitbucket.org/your-workspace/your-repo.git
```

### Restart service
```bash
docker-compose restart
```

### Rebuild after changes
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Stop service
```bash
docker-compose down
```

### Clear all projects (reset)
```bash
rm -rf projects/*
docker-compose restart
```

## Webhook Security

The webhook endpoint is secured with two layers of protection:

### 1. Signature Validation
All webhook requests must include a valid HMAC-SHA256 signature in the `X-Hub-Signature` header. This ensures requests actually come from Bitbucket.

### 2. Workspace Restriction
Only webhooks from the `xriopteam` Bitbucket workspace are accepted. This prevents unauthorized access from other organizations.

### Setup

1. **Generate a webhook secret:**
   ```bash
   openssl rand -hex 32
   ```

2. **Add to `.env` file:**
   ```env
   BITBUCKET_WEBHOOK_SECRET=your-generated-secret
   ALLOWED_WORKSPACE=xriopteam
   ```

3. **Configure in Bitbucket:**
   - Go to Repository Settings → Webhooks
   - Add webhook URL: `https://bitbucket.tintinwinata.online/webhook/bitbucket/pr`
   - Add the same secret in the "Secret" field
   - Select triggers: PR Created, PR Updated

4. **Restart service:**
   ```bash
   docker compose restart pr-automation
   ```

**📖 See [WEBHOOK_SECURITY.md](./WEBHOOK_SECURITY.md) for detailed configuration and troubleshooting.**

## Monitoring with Prometheus

The application exposes Prometheus metrics at `/metrics` endpoint for monitoring PR automation activities and Claude review performance.

### Available Metrics

- **PR Created**: `pr_created_total` - Number of PRs created
- **PR Updated**: `pr_updated_total` - Number of PRs updated  
- **LGTM Count**: `claude_lgtm_total` - Number of approvals from Claude
- **Issues Found**: `claude_issues_found_total` - Total count of all issues found (e.g., if 1 PR has 3 issues, adds 3 to counter)
- **Successful Reviews**: `claude_review_success_total` - PRs successfully reviewed
- **Failed Reviews**: `claude_review_failure_total` - Failed reviews (with error types)
- **Review Duration**: `claude_review_duration_seconds` - Histogram of review durations

### Access Metrics

```bash
curl http://localhost:3000/metrics
```

### Detailed Documentation

See [PROMETHEUS.md](./PROMETHEUS.md) for:
- Detailed metric descriptions
- Grafana dashboard examples
- Sample PromQL queries

**Note**: Prometheus is already configured in `/workspace/monitoring/prometheus.yml` to scrape metrics from `pr-automation:3000`.

### Metrics Persistence

By default, metrics are stored in memory and reset when the application restarts. You can enable metrics persistence to preserve metrics across restarts and container rebuilds.

#### Enable Metrics Persistence

Add these environment variables to your `.env` file:

```env
METRICS_PERSISTENCE_ENABLED=true
METRICS_PERSISTENCE_TYPE=filesystem
METRICS_PERSISTENCE_PATH=./metrics-storage
METRICS_PERSISTENCE_SAVE_INTERVAL_MS=30000
```

#### Storage Types

**Filesystem (Recommended for most use cases)**
- Stores metrics in a JSON file
- Simple and easy to inspect
- Works well for small to medium deployments
- Default storage type

**SQLite (Recommended for larger deployments)**
- Stores metrics in a SQLite database
- Better performance for high-volume metrics
- Requires `better-sqlite3` package (automatically installed)
- Falls back to filesystem if SQLite is unavailable

#### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `METRICS_PERSISTENCE_ENABLED` | Enable/disable persistence | `false` |
| `METRICS_PERSISTENCE_TYPE` | Storage type: `filesystem` or `sqlite` | `filesystem` |
| `METRICS_PERSISTENCE_PATH` | Path to store metrics (relative or absolute) | `./metrics-storage` |
| `METRICS_PERSISTENCE_SAVE_INTERVAL_MS` | How often to save metrics (milliseconds) | `30000` (30 seconds) |

#### Docker Setup

When using Docker, make sure to mount the metrics storage directory as a volume:

```yaml
volumes:
  - ./metrics-storage:/app/metrics-storage
```

This ensures metrics persist even when the container is rebuilt.

#### How It Works

1. **On Startup**: The application loads persisted metrics from storage and restores them to the Prometheus registry
2. **During Runtime**: Metrics are automatically saved every 30 seconds (configurable via `METRICS_PERSISTENCE_SAVE_INTERVAL_MS`)
3. **On Shutdown**: Metrics are saved one final time before the process exits

#### Backward Compatibility

- Metrics persistence is **opt-in** - disabled by default
- If persistence fails to initialize, the application continues without persistence (logs a warning)
- Existing deployments without persistence continue to work as before

#### Troubleshooting

**Metrics not persisting:**
- Check that `METRICS_PERSISTENCE_ENABLED=true` is set
- Verify the storage path is writable
- Check application logs for persistence-related errors

**Permission errors:**
- Ensure the storage directory exists and is writable
- In Docker, verify volume mounts are configured correctly

## Contributing

Feel free to contribute to this project! Whether you want to:

- 🐛 **Report bugs** or issues
- 💡 **Suggest new features** or improvements  
- 🔧 **Submit pull requests** with fixes or enhancements
- 📖 **Improve documentation** or examples
- 🧪 **Add tests** or improve existing ones

### Getting Started

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes** and test them thoroughly
4. **Commit your changes**: `git commit -m "Add your feature"`
5. **Push to your fork**: `git push origin feature/your-feature-name`
6. **Open a Pull Request**

### Questions or Discussion?

I'm always open to discussing issues, reviewing PRs, or just chatting about the project! 

**Feel free to DM me on LinkedIn** - I'd love to hear from you and help with any questions you might have.

[LinkedIn Profile](https://linkedin.com/in/tintinwinata)

---

**Happy coding! 🚀**

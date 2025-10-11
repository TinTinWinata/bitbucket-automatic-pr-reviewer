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

### 1. Clone and Setup

```bash
cd @pr-automation
```

### 2. Configure Environment

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` and add your credentials:

```env
# Claude Model (haiku, sonnet, or opus)
CLAUDE_MODEL=sonnet

# Security: Webhook Validation (REQUIRED)
BITBUCKET_WEBHOOK_SECRET=your-webhook-secret-here
ALLOWED_WORKSPACE=xriopteam

# Required: Bitbucket Authentication (choose one method)
# Option 1: Use App Password or Token (recommended)
BITBUCKET_TOKEN=your-bitbucket-app-password

# Option 2: Use Username and Password (alternative)
# BITBUCKET_USER=your-username
# BITBUCKET_PASSWORD=your-password

# Event Filtering (Optional)
# Set to 'true' to only process PR creation events (ignore updates)
# Set to 'false' to process all PR events (created + updated)
PROCESS_ONLY_CREATED=false

# Optional
PORT=3000
```

### 3. Configure Claude Authentication

To enable Claude CLI authentication and authorization, you need to copy your Claude configuration files to the `./claude-config` directory:

```bash
# Create the claude-config directory
mkdir -p ./claude-config

# Copy your Claude configuration files
cp ~/.claude.json ./claude-config/
cp -r ~/.claude ./claude-config/
```

**Purpose**: These files contain your Claude CLI authentication/authorization data, allowing the Docker container to access Claude without requiring interactive login.

**Note**: The Docker Compose configuration mounts these files into the container:
- `./claude-config/.claude.json` → `/home/node/.claude.json`
- `./claude-config/.claude` → `/home/node/.claude`

### 4. Create Bitbucket App Password

1. Go to Bitbucket → Personal Settings → App passwords
2. Click "Create app password"
3. Name: `PR Automation`
4. Permissions: Select `Repositories: Read` and `Pull requests: Read`
5. Copy the generated password and use it as `BITBUCKET_TOKEN`

### 5. Build and Run with Docker

```bash
# Build the Docker image (includes Claude CLI installation)
docker-compose build

# Start the service
docker-compose up -d

# View logs
docker-compose logs -f
```

The service will be available at `http://localhost:3000`

### 6. Configure Bitbucket Webhook

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
│   ├── index.js      # Express server and webhook handler
│   ├── claude.js     # Claude CLI integration with validation
│   └── git.js        # Git operations (clone, update, validate)
├── projects/         # Cloned repositories (volume mounted)
├── Dockerfile        # Docker image with Claude CLI installed
├── docker-compose.yml # Docker Compose setup
├── package.json      # Node.js dependencies
├── .env.example      # Environment variables template
└── README.md         # This file
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

## Customizing the Claude Prompt

Edit `src/claude.js` and modify the `prompt` variable in the `processPullRequest` function (around line 42):

```javascript
const prompt = `**Role:**  
You are an autonomous code reviewer with terminal access.

**Goal:**  
Review the pull request changes and provide a comprehensive code review.

**PR Details:**
- Title: ${prData.title}
- Description: ${prData.description}
- Author: ${prData.author}
- Source Branch: ${prData.sourceBranch}
- Destination Branch: ${prData.destinationBranch}
- Repository: ${prData.repository}
- PR URL: ${prData.prUrl}
- Project Path: ${projectResult.path}

---

[Add your custom instructions here]

## Instructions:
1. Navigate to the project directory
2. Review the changes between branches
3. Identify any issues, bugs, or improvements
4. Provide a summary of your findings

Please provide your code review.`;
```


## Development

### Running without Docker

```bash
# Install Claude CLI globally
npm install -g @anthropic-ai/claude-code

# Install dependencies
npm install

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

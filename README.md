# PR Automation with Claude CLI

A simple Docker-based automation service that receives Bitbucket pull request webhooks, clones/validates the repository, and processes them using **Claude CLI** (not the API).

## Features

- 🔗 Receives Bitbucket PR creation webhooks
- 📦 Automatically clones repositories if not already present
- 🔄 Updates existing repositories before processing
- 🤖 Processes PR data with Claude CLI (`--dangerously-skip-permissions`)
- 🐳 Fully containerized with Docker
- ⚡ Express.js REST API
- 📝 Easy configuration with environment variables

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

# Required: Bitbucket Authentication (choose one method)
# Option 1: Use App Password or Token (recommended)
BITBUCKET_TOKEN=your-bitbucket-app-password

# Option 2: Use Username and Password (alternative)
# BITBUCKET_USER=your-username
# BITBUCKET_PASSWORD=your-password

# Optional
PORT=3000
```

### 3. Create Bitbucket App Password

1. Go to Bitbucket → Personal Settings → App passwords
2. Click "Create app password"
3. Name: `PR Automation`
4. Permissions: Select `Repositories: Read` and `Pull requests: Read`
5. Copy the generated password and use it as `BITBUCKET_TOKEN`

### 4. Build and Run with Docker

```bash
# Build the Docker image (includes Claude CLI installation)
docker-compose build

# Start the service
docker-compose up -d

# View logs
docker-compose logs -f
```

The service will be available at `http://localhost:3000`

### 5. Configure Bitbucket Webhook

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

### Example: Jenkins-Style Prompt

You can use a prompt similar to your Jenkins pipeline:

```javascript
const prompt = `**Role:**  
You are an autonomous code reviewer with terminal access.

**Goal:**  
Fetch PR details, safely switch to the PR branch, review changes, and provide analysis.

**PR:**  
${prData.prUrl}

---

## Operating Rules
- Use terminal for safe git operations: stash, checkout branch, restore previous state.
- Be idempotent: always restore original branch and pop stash if needed.

## Step-by-Step Plan

### 1. Safe Local Checkout
\`\`\`bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
git stash push -u -m "pr-auto-stash"  # only if dirty
git fetch --all --prune
git checkout -B ${prData.sourceBranch} origin/${prData.sourceBranch}
\`\`\`

### 2. Review Changes
- Read through all changed files
- Identify logic errors, security concerns, performance issues
- Check for missing edge case handling and tests

### 3. Restore Original State
\`\`\`bash
git checkout - || true
git stash pop || true
\`\`\`

### 4. Provide Summary

Use this template:

# PR Review Summary

## Status: [✅ LGTM | 🚨 Issues Found]

*<1-2 sentences about what the PR changes>*

[Your analysis here]
`;
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

## Common Issues

### "claude: command not found" Error

**Cause**: Claude CLI not installed in Docker image

**Solution**:
1. Verify Dockerfile has: `RUN npm install -g @anthropic-ai/claude-code`
2. Rebuild: `docker-compose build --no-cache`

### "Failed to clone repository" Error

**Cause**: Invalid Bitbucket credentials or repository access

**Solution**:
1. Verify your `BITBUCKET_TOKEN` is correct
2. Ensure the token has `Repositories: Read` permission
3. Check that the repository exists and you have access

### "Project path not found" Error

**Cause**: Volume mount issue or permissions

**Solution**:
1. Check that `./projects` directory exists
2. Verify docker-compose.yml has the volume mount: `- ./projects:/app/projects`
3. Restart Docker service

### Webhook not triggering

**Cause**: Bitbucket webhook misconfiguration

**Solution**:
1. Check webhook URL is correct and accessible
2. Verify webhook is Active in Bitbucket settings
3. Test with Bitbucket's "Test connection" feature
4. Check logs: `docker-compose logs -f`

### Claude CLI timeout or slow response

**Cause**: Complex prompt or large codebase

**Solution**:
1. Simplify your prompt
2. Switch to `haiku` model for faster responses
3. Increase timeout in `claude.js`: `maxBuffer: 1024 * 1024 * 50`

## Comparison with Jenkins Pipeline

Your Jenkins pipeline and this solution are very similar:

| Feature | Jenkins Pipeline | This Solution |
|---------|------------------|---------------|
| Trigger | Manual (parameters) | Automatic (webhook) |
| Git Operations | Manual checkout | Auto clone/update |
| Claude Execution | `claude` CLI | `claude` CLI |
| Permissions Flag | `--dangerously-skip-permissions` | `--dangerously-skip-permissions` |
| Model Selection | Choice parameter | Environment variable |
| Output | Archived artifact | Console logs + TODO: post to PR |

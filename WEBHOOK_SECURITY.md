# Webhook Security Configuration

This document explains how to secure your PR automation webhook endpoint with signature validation and workspace restrictions.

## Security Features

✅ **Webhook Signature Validation** - Verify requests are from Bitbucket using HMAC-SHA256  
✅ **Workspace Restriction** - Only accept webhooks from authorized Bitbucket workspace (xriopteam)  
✅ **Sequential Processing** - Queue system prevents race conditions and branch conflicts  
✅ **Bitbucket MCP Integration** - Direct integration with Bitbucket for secure PR operations

## Quick Setup

### 1. Generate a Webhook Secret

Generate a strong random secret for your webhook:

```bash
openssl rand -hex 32
```

**Example output:**
```
a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

### 2. Configure Bitbucket Webhook

1. Go to your Bitbucket repository settings
2. Navigate to **Webhooks** section
3. Click **Add webhook**
4. Configure:
   - **Title**: PR Automation
   - **URL**: `https://bitbucket.tintinwinata.online/webhook/bitbucket/pr`
   - **Status**: Active
   - **Triggers**: Select "Pull Request" → "Created" and "Updated"
   - **Secret**: Paste your generated webhook secret
5. Save the webhook

### 3. Configure Your Application

Add the webhook secret to your `.env` file:

```env
# Webhook Security
BITBUCKET_WEBHOOK_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
ALLOWED_WORKSPACE=xriopteam

# Existing configuration...
CLAUDE_MODEL=sonnet
BITBUCKET_TOKEN=your-token
```

### 4. Configure MCP Integration (Optional)

If you want to use Bitbucket MCP tools for direct PR operations:

```bash
# Copy MCP configuration
cp .mcp.json.example .mcp.json

# Edit MCP configuration with your Bitbucket credentials
nano .mcp.json
```

### 5. Restart the Service

```bash
docker compose restart pr-automation
```

### 6. Test the Webhook

Create or update a PR in your Bitbucket repository to trigger the webhook.

**Check logs:**
```bash
docker compose logs -f pr-automation
```

**Expected output:**
```
✅ Webhook signature verified
✅ Workspace verified: xriopteam
Received Bitbucket PR webhook
```

## Configuration Options

| Variable | Required | Description |
|----------|----------|-------------|
| `BITBUCKET_WEBHOOK_SECRET` | **Yes** | Secret key for webhook signature validation |
| `ALLOWED_WORKSPACE` | No | Bitbucket workspace slug (default: `xriopteam`) |

## Current Implementation Features

### Sequential Processing Queue
The application uses a queue system to process PRs sequentially:
- **Prevents Branch Conflicts**: Multiple PRs won't interfere with each other's git operations
- **Resource Management**: Prevents overwhelming the system with concurrent reviews
- **Reliable Processing**: Ensures each PR gets proper attention without timeouts

### Bitbucket MCP Integration
The current implementation uses Bitbucket MCP (Model Context Protocol) tools:
- **Direct API Access**: Claude can fetch PR details and file diffs directly from Bitbucket
- **Secure Comment Posting**: Reviews are posted back to PRs using authenticated MCP tools
- **No Manual Git Operations**: Reduces the need for complex git checkout/restore operations

### Configuration Files
The system uses several configuration files:
- **`.env`**: Environment variables and secrets
- **`.mcp.json`**: MCP server configuration for Bitbucket integration
- **`claude-config/`**: Claude CLI authentication files (`.claude.json` and `.claude/`)


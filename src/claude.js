const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { ensureProjectExists } = require('./git');

const execAsync = promisify(exec);

/**
 * Process pull request with Claude
 * @param {Object} prData - Pull request data from Bitbucket webhook
 */
async function processPullRequest(prData) {
  try {
    console.log('Processing PR with Claude...');
    console.log(`PR Title: ${prData.title}`);
    console.log(`Author: ${prData.author}`);
    console.log(`Repository: ${prData.repository}`);

    // STEP 1: Validate and ensure project is cloned
    console.log('\n=== Step 1: Validating Project ===');
    const repoData = {
      name: prData.repository,
      cloneUrl: prData.repoCloneUrl
    };

    const projectResult = await ensureProjectExists(repoData);
    console.log(`Project validation result:`, projectResult);
    
    if (!projectResult.success) {
      throw new Error('Failed to ensure project exists');
    }

    console.log(`Project path: ${projectResult.path}`);
    console.log(`Was cloned: ${projectResult.wasCloned ? 'Yes' : 'No (already existed)'}`);
    console.log('================================\n');

    // STEP 2: Process with Claude CLI
    console.log('=== Step 2: Processing with Claude CLI ===');

    const prompt = `**Role:**  
You are an autonomous code reviewer with terminal access and the Bitbucket MCP connected.
**Goal:**  
Fetch PR details + file diffs from the given Bitbucket URL, safely switch to the PR branch, review changes, and post a **single PR summary comment**.

**PR:**  
\`${prData.prUrl}\`

---

## Operating Rules
- Use Bitbucket MCP tools for PR data and posting a **single summary comment** only.
- Use the terminal for safe git operations: stash, checkout branch, restore previous state.
- Be idempotent: always restore original branch and pop stash if needed.
- **IMPORTANT**: Use MCP tools directly, not as shell commands. Do not run commands like "mcp__bitbucket__list_tools" in bash.

---

## Step-by-Step Plan

### 1. Resolve PR Metadata
- Use Bitbucket MCP tools to fetch repository, PR ID, source & target branches, author, title, description, and changed files.
- Get full PR diff for context using MCP tools (not shell commands).

### 2. Safe Local Checkout
\`\`\`bash
git rev-parse --abbrev-ref HEAD
git status --porcelain
git stash push -u -m "pr-auto-stash-${prData.repository}"  # only if dirty
git fetch --all --prune
git checkout -B ${prData.sourceBranch} origin/${prData.sourceBranch} || git checkout ${prData.sourceBranch}
\`\`\`

After review:
\`\`\`bash
git checkout <ORIGINAL_BRANCH> || true
git stash list | grep "pr-auto-stash-${prData.repository}" && git stash pop || true
\`\`\`

### 3. Review Changes
- Read through all changed files.
- Identify logic errors, security concerns, performance bottlenecks, missing edge case handling, and lack of tests.

### 4. Post Single PR Summary Comment
- Use Bitbucket MCP tools to post the summary comment to the PR.

Use this template for the summary if the PR needs to be changed:

\`\`\`
# PR Review Summary

---

## Status: 🚨 Possibility Issue

*<1–2 sentences about what the PR changes>*

## Issues:

### 1) <title>

*<explanation>*

**Existing Code**:

<current issue snippet>

**Fix Implementation**:

<example fixed implementation>

---

2) ...

---

3) ...

\`\`\`

Use this template for the summary if the PR is good and no issues were found:

\`\`\`
# PR Review Summary

## Status: ✅ LGTM — No issues found.

*<1–2 sentences about what the PR changes>*

The implementation follows best practices, and the changes are ready to be merged.

\`\`\`

No need to show any others things other then the given template (e.g. \`Key improvements\` or \`Technical details\`)`;

    // Write prompt to temporary file
    const promptFile = path.join('/tmp', `pr-review-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, prompt);

    try {
      console.log('Executing Claude CLI...');
      const startTime = Date.now();
      
      // Copy .mcp.json to project directory so Claude CLI can use MCP servers
      const mcpSourcePath = path.join('/app', '.mcp.json');
      const mcpDestPath = path.join(projectResult.path, '.mcp.json');
      
      if (fs.existsSync(mcpSourcePath)) {
        fs.copyFileSync(mcpSourcePath, mcpDestPath);
        console.log(`✓ Copied .mcp.json to ${mcpDestPath}`);
      } else {
        console.warn('⚠ Warning: .mcp.json not found at /app/.mcp.json - Bitbucket MCP will not be available');
      }
      
      // Get model from env or default to sonnet
      const model = process.env.CLAUDE_MODEL || 'sonnet';
      
      console.log(`Starting Claude analysis with ${model} model (timeout: 5 minutes)...`);
      
      // Execute Claude CLI with the prompt (with 5 minute timeout)
      const { stdout, stderr } = await execAsync(
        `claude --dangerously-skip-permissions -p "$(cat ${promptFile})" --model "${model}" --output-format text`,
        {
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer
          cwd: projectResult.path, // Run in project directory
          timeout: 5 * 60 * 1000, // 5 minutes timeout
          killSignal: 'SIGTERM'
        }
      );

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✓ Claude analysis completed in ${duration}s`);

      if (stderr) {
        console.warn('Claude CLI warnings:', stderr);
      }

      console.log('\nClaude CLI Response:');
      console.log(stdout);
      console.log('======================================\n');

      fs.unlinkSync(promptFile);

      return {
        success: true,
        response: stdout,
        duration: duration
      };

    } catch (error) {
      // Clean up prompt file on error
      if (fs.existsSync(promptFile)) {
        fs.unlinkSync(promptFile);
      }
      
      // Check if it's a timeout error
      if (error.killed || error.signal === 'SIGTERM') {
        console.error('❌ Claude CLI timed out after 5 minutes');
        throw new Error('Claude analysis timed out after 5 minutes. The PR might be too large or complex.');
      }
      
      throw error;
    }

  } catch (error) {
    console.error('Error executing Claude CLI:', error);
    throw error;
  }
}

module.exports = {
  processPullRequest
};


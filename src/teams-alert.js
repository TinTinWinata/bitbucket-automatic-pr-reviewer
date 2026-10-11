const logger = require('./logger').default;

const CLAUDE_UNUSABLE =
  /Failed to authenticate|OAuth (access )?token|Invalid API key|Please run \/login|Login expired|spawn claude ENOENT/i;
const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;

let downSince = null;
let lastAlertAt = null;

async function postCard(title, text) {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return;

  const card = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'TextBlock', text, wrap: true },
    ],
  };
  if (process.env.STATUS_PAGE_URL) {
    card.actions = [
      { type: 'Action.OpenUrl', title: 'Open status page', url: process.env.STATUS_PAGE_URL },
    ];
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [
          {
            contentType: 'application/vnd.microsoft.card.adaptive',
            contentUrl: null,
            content: card,
          },
        ],
      }),
    });
    if (!res.ok) logger.warn(`Teams alert failed: HTTP ${res.status}`);
  } catch (error) {
    logger.warn(`Teams alert failed: ${error.message}`);
  }
}

function isClaudeUnusable(error) {
  return CLAUDE_UNUSABLE.test(String(error?.message || error || ''));
}

function fixHint(error) {
  const message = String(error.message || error);
  if (/ENOENT/.test(message)) {
    return 'The claude binary is missing from the container. Recreate it: docker compose up -d --force-recreate pr-automation';
  }
  if (!isClaudeUnusable(error)) {
    return 'Reviews keep failing and the circuit breaker is open. Check docker logs pr-automation.';
  }
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return 'The long-lived token was rejected. Run claude setup-token, put the new token in CLAUDE_CODE_OAUTH_TOKEN in .env, then docker compose up -d --force-recreate pr-automation';
  }
  return 'The /login session expired. Run docker exec -it pr-automation claude and then /login (as the node user, never root).';
}

function onJobFailure(error, circuitOpen, prData) {
  if (!isClaudeUnusable(error) && !circuitOpen) return;

  const now = Date.now();
  downSince = downSince || now;
  if (lastAlertAt && now - lastAlertAt < REMIND_AFTER_MS) return;
  lastAlertAt = now;

  const reason =
    String(error.message || error)
      .split('\n')
      .find(line => line.trim()) || 'unknown error';
  const text = [
    `**Error**\n\n${reason.slice(0, 300)}`,
    `**Down since**\n\n${new Date(downSince).toISOString()}`,
    `**Last PR it failed on**\n\n[${prData.title}](${prData.prUrl})`,
    `**Fix**\n\n${fixHint(error)}`,
  ].join('\n\n');

  logger.error('Sending Teams alert: PR reviewer is down');
  postCard('PR reviewer is down ❌', text);
}

function onJobSuccess() {
  if (!downSince) return;
  const text = `Reviews are running again. It was down since ${new Date(downSince).toISOString()}.`;
  downSince = null;
  lastAlertAt = null;
  logger.info('Sending Teams alert: PR reviewer recovered');
  postCard('PR reviewer recovered ✅', text);
}

module.exports = { onJobFailure, onJobSuccess, isClaudeUnusable };

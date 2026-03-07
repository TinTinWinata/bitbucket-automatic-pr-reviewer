const dotenv = require('dotenv');
dotenv.config();

const { getConfig } = require('./config/loader');
const config = getConfig();
const { createLogger } = require('./logger');
createLogger(config.logging);
const logger = require('./logger').default;

const express = require('express');
const crypto = require('crypto');
const { processPullRequest } = require('./claude');
const { register, metrics } = require('./metrics');
const { BitbucketPayloadSchema, BitbucketCommentPayloadSchema } = require('./schemas');
const CircuitBreaker = require('./circuit-breaker');
const { shouldRunReview, shouldCreateReleaseNote } = require('./branch-matcher');
const {
  parseManualReviewTrigger,
  getCommentText,
  getCommentAuthor,
  getCommentId,
} = require('./manual-trigger');

const app = express();
const PORT = config.server.port;
const claudeCircuitBreaker = new CircuitBreaker(
  config.circuitBreaker.failureThreshold,
  config.circuitBreaker.resetTimeoutMs,
);

const BITBUCKET_WEBHOOK_SECRET = config.secrets.webhookSecret;
const ALLOWED_WORKSPACE = config.bitbucket.allowedWorkspace;
const NON_ALLOWED_USERS = config.bitbucket.nonAllowedUsers;
const PROCESS_ONLY_CREATED = config.eventFilter.processOnlyCreated;
const MANUAL_TRIGGER = config.manualTrigger || {};

// Queue System for Processing PRs (prevents branch conflicts)
const reviewQueue = [];
let isProcessing = false;
const processedCommentTriggerIds = new Set();

function getNonAllowedUsersList() {
  if (!NON_ALLOWED_USERS) return [];
  return NON_ALLOWED_USERS.split(',')
    .map(u => u.trim())
    .filter(Boolean);
}

function extractRepoCloneUrl(payload) {
  return (
    payload.repository.links.clone?.find(link => link.name === 'https')?.href ||
    payload.repository.links.html.href
  );
}

function buildPrData(payload, extra = {}) {
  return {
    title: payload.pullrequest.title,
    description: payload.pullrequest.description || 'No description',
    author: payload.pullrequest.author.display_name,
    sourceBranch: payload.pullrequest.source.branch.name,
    destinationBranch: payload.pullrequest.destination.branch.name,
    prUrl: payload.pullrequest.links.html.href,
    repository: payload.repository.name,
    repoCloneUrl: extractRepoCloneUrl(payload),
    ...extra,
  };
}

function shouldSkipUser(displayName) {
  const nonAllowedUsersList = getNonAllowedUsersList();
  return nonAllowedUsersList.length > 0 && nonAllowedUsersList.includes(displayName);
}

function enqueueAutoJobs(prData) {
  const enqueued = [];
  if (shouldRunReview(prData)) {
    reviewQueue.push({ prData, type: 'review' });
    enqueued.push('review');
  }
  if (shouldCreateReleaseNote(prData)) {
    reviewQueue.push({ prData, type: 'create-release-note' });
    enqueued.push('create-release-note');
  }
  return enqueued;
}

function enqueueManualReview(prData) {
  reviewQueue.push({ prData, type: 'review' });
  return ['review'];
}

/**
 * Process PR review queue sequentially to prevent branch conflicts
 */
async function processQueue() {
  if (isProcessing || reviewQueue.length === 0) {
    return; // Already processing or queue is empty
  }

  isProcessing = true;
  const queueItem = reviewQueue.shift(); // { prData, type: 'review' | 'create-release-note' }

  logger.info(
    `📋 Processing queue item: ${queueItem.prData.title} [${queueItem.type}] (${reviewQueue.length} remaining)`,
  );

  try {
    if (!claudeCircuitBreaker.canAttempt()) {
      logger.error('🚫 Circuit breaker is OPEN. Skipping to avoid system overload.');
      return;
    }

    await processPullRequest(queueItem);

    logger.info(`✅ Claude ${queueItem.type} succeeded`);
    claudeCircuitBreaker.recordSuccess();
  } catch (error) {
    logger.error(`Error processing PR with Claude: ${error.message}`);
    claudeCircuitBreaker.recordFailure();
  }

  isProcessing = false;
  processQueue(); // Process next item in queue (if any)
}

// Middleware to parse JSON (but keep raw body for signature verification)
app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      // Store raw body for signature verification
      req.rawBody = buf.toString(encoding || 'utf8');
    },
  }),
);

/**
 * Verify Bitbucket webhook signature
 * @param {string} signature - Signature from X-Hub-Signature header
 * @param {string} payload - Raw request body
 * @param {string} secret - Webhook secret
 * @returns {boolean} - True if signature is valid
 */
function verifyBitbucketSignature(signature, payload, secret) {
  if (!signature || !secret) {
    return false;
  }

  // Bitbucket uses SHA256 HMAC
  // Format: "sha256=<hash>"
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  const expectedSignature = 'sha256=' + hmac.digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

function validateBitbucketWebhook(req, res, next) {
  // 1. Verify webhook signature (if secret is configured)
  if (BITBUCKET_WEBHOOK_SECRET) {
    const signature = req.headers['x-hub-signature'];

    if (!signature) {
      logger.warn('⚠️  Webhook rejected: Missing X-Hub-Signature header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing webhook signature',
      });
    }

    if (!verifyBitbucketSignature(signature, req.rawBody, BITBUCKET_WEBHOOK_SECRET)) {
      logger.warn('⚠️  Webhook rejected: Invalid signature');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid webhook signature',
      });
    }

    logger.info('✅ Webhook signature verified');
  } else {
    logger.warn('BITBUCKET_WEBHOOK_SECRET not configured - signature validation disabled');
  }

  // 2. Verify workspace (organization)
  const workspace = req.body.repository?.workspace?.slug || req.body.repository?.owner?.username;

  if (workspace && workspace !== ALLOWED_WORKSPACE) {
    logger.warn(
      `⚠️  Webhook rejected: Unauthorized workspace "${workspace}" (expected "${ALLOWED_WORKSPACE}")`,
    );
    return res.status(403).json({
      error: 'Forbidden',
      message: `Webhooks only accepted from ${ALLOWED_WORKSPACE} workspace`,
    });
  }

  logger.info(`✅ Workspace verified: ${workspace || 'unknown'}`);
  next();
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'PR Automation service is running' });
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metricsData = await register.metrics();
    res.end(metricsData);
  } catch (error) {
    logger.error(`Error collecting metrics: ${error.message}`);
    res.status(500).end(error.message);
  }
});

// Bitbucket webhook endpoint for PR creation (with security validation)
app.post('/webhook/bitbucket/pr', validateBitbucketWebhook, async (req, res) => {
  let payload;
  const eventKey = req.headers['x-event-key'];

  try {
    if (eventKey === 'pullrequest:comment_created') {
      payload = BitbucketCommentPayloadSchema.parse(req.body);
    } else {
      payload = BitbucketPayloadSchema.parse(req.body);
    }
    logger.info('✅ Webhook payload validated successfully');
  } catch (error) {
    // 2. REJECT IF INVALID
    // Log the validation error and send a 400 Bad Request
    logger.warn(`🚫 Invalid webhook payload: ${error.message}`);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid payload structure',
      details: error.errors,
    });
  }

  // 3. PROCESS THE VALIDATED DATA
  try {
    logger.info('Received Bitbucket PR webhook');
    logger.info(`Event: ${eventKey}`);

    const repository = payload.repository.name;
    let prData = buildPrData(payload);
    let enqueued = [];

    if (eventKey === 'pullrequest:comment_created') {
      if (MANUAL_TRIGGER.enabled === false) {
        logger.info('⏭️  Manual review trigger is disabled');
        return res.status(200).json({
          message: 'Manual review trigger is disabled',
          event: eventKey,
        });
      }

      const commentAuthor = getCommentAuthor(payload);
      const commentText = getCommentText(payload);
      const commentId = getCommentId(payload);

      logger.info(`👤 Comment author: ${commentAuthor || 'unknown'}`);

      if (shouldSkipUser(commentAuthor)) {
        logger.info(`⏭️  Skipping comment from user "${commentAuthor}" (in NON_ALLOWED_USERS)`);
        return res.status(200).json({
          message: `Skipping comment from user "${commentAuthor}"`,
          author: commentAuthor,
        });
      }

      const triggerResult = parseManualReviewTrigger(commentText, MANUAL_TRIGGER);
      if (!triggerResult.shouldTrigger) {
        logger.info(`⏭️  Comment ignored: ${triggerResult.reason}`);
        return res.status(200).json({
          message: 'Comment ignored (no matching manual trigger command)',
          reason: triggerResult.reason,
        });
      }

      if (commentId && processedCommentTriggerIds.has(commentId)) {
        logger.info(`⏭️  Duplicate manual trigger ignored (comment id: ${commentId})`);
        return res.status(200).json({
          message: 'Duplicate manual trigger ignored',
          commentId,
        });
      }

      if (commentId) {
        processedCommentTriggerIds.add(commentId);
      }

      prData = buildPrData(payload, {
        triggerType: 'manual-comment',
        triggeredBy: commentAuthor,
        triggerComment: commentText,
      });

      enqueued = enqueueManualReview(prData);
      logger.info(
        `✅ Manual review triggered for PR: ${prData.title} (queue size: ${reviewQueue.length})`,
      );
    } else {
      // User filtering for automatic PR events
      const authorDisplayName = payload.pullrequest.author.display_name;
      logger.info(`👤 PR Author: ${authorDisplayName}`);

      if (shouldSkipUser(authorDisplayName)) {
        logger.info(`⏭️  Skipping PR from user "${authorDisplayName}" (in NON_ALLOWED_USERS)`);
        return res.status(200).json({
          message: `Skipping PR from user "${authorDisplayName}"`,
          author: authorDisplayName,
        });
      }

      if (PROCESS_ONLY_CREATED && eventKey !== 'pullrequest:created') {
        logger.info(`⏭️  Event ignored (only processing PR creation): ${eventKey}`);
        return res.status(200).json({
          message: 'Event ignored (only processing PR creation)',
          event: eventKey,
        });
      }

      if (eventKey === 'pullrequest:created') {
        metrics.prCreatedCounter.inc({ repository });
        logger.debug(`Metrics: Incremented PR created counter for ${repository}`);
      } else if (eventKey === 'pullrequest:updated') {
        metrics.prUpdatedCounter.inc({ repository });
        logger.debug(`Metrics: Incremented PR updated counter for ${repository}`);
      }

      enqueued = enqueueAutoJobs(prData);
    }

    if (!prData.repoCloneUrl) {
      logger.warn('🚫 Could not find a valid HTTPS clone URL in the payload.');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Could not find HTTPS clone URL in payload',
      });
    }

    logger.debug(`PR Data: ${JSON.stringify(prData)}`);

    if (enqueued.length === 0) {
      logger.info(
        `⏭️  PR did not match any branch rules: ${prData.title} (source: ${prData.sourceBranch}, target: ${prData.destinationBranch})`,
      );
    } else {
      logger.info(
        `✅ PR enqueued: ${prData.title} [${enqueued.join(', ')}] (queue size: ${reviewQueue.length})`,
      );
    }

    res.status(200).json({
      message: 'Webhook received successfully',
      prTitle: prData.title,
      enqueued,
      queuePosition: reviewQueue.length,
    });

    processQueue();
  } catch (error) {
    logger.error(`Error handling webhook: ${error.message}`);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
});

// Start server
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`PR Automation server listening on port ${PORT}`);
    logger.info(`Webhook endpoint: http://localhost:${PORT}/webhook/bitbucket/pr`);
    logger.info(
      `Event filtering: ${PROCESS_ONLY_CREATED ? 'Only PR creation events' : 'All PR events (created + updated)'}`,
    );
  });
}

module.exports = {
  app,
  verifyBitbucketSignature,
  processQueue,
  _internal: {
    buildPrData,
    enqueueAutoJobs,
    enqueueManualReview,
    shouldSkipUser,
    processedCommentTriggerIds,
  },
};

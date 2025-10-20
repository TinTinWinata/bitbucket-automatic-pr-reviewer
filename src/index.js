const express = require('express');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { processPullRequest } = require('./claude');
const { register, metrics } = require('./metrics');
const logger = require('./logger').default;
const { BitbucketPayloadSchema } = require('./schemas');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security Configuration
const BITBUCKET_WEBHOOK_SECRET = process.env.BITBUCKET_WEBHOOK_SECRET;
const ALLOWED_WORKSPACE = process.env.ALLOWED_WORKSPACE || 'xriopteam'; // Default to xriopteam

// Event Filtering Configuration
// Set to 'true' to only process PR creation events (ignore updates)
// Set to 'false' to process all PR events (created + updated)
const PROCESS_ONLY_CREATED = process.env.PROCESS_ONLY_CREATED === 'true';

// Queue System for Processing PRs (prevents branch conflicts)
const reviewQueue = [];
let isProcessing = false;

/**
 * Process PR review queue sequentially to prevent branch conflicts
 */
async function processQueue() {
  if (isProcessing || reviewQueue.length === 0) {
    return; // Already processing or queue is empty
  }

  isProcessing = true;
  const prData = reviewQueue.shift(); // Get first item from queue

  logger.info(`📋 Processing PR from queue: ${prData.title} (${reviewQueue.length} remaining)`);

  try {
    await processPullRequest(prData);
  } catch (error) {
    logger.error(`Error processing PR with Claude: ${error.message}`);
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
  try {
    // 1. VALIDATE THE PAYLOAD
    // If req.body doesn't match the schema, Zod throws an error
    payload = BitbucketPayloadSchema.parse(req.body);

    // If we get here, the data is safe and matches our schema
    logger.info('✅ Webhook payload validated successfully');
  } catch (error) {
    // 2. REJECT IF INVALID
    // Log the validation error and send a 400 Bad Request
    logger.warn(`🚫 Invalid webhook payload: ${error.message}`);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid payload structure',
      details: error.errors, // Send Zod's error details back
    });
  }

  // 3. PROCESS THE VALIDATED DATA
  // All code from here on uses the "payload" variable, which we know is safe.
  try {
    logger.info('Received Bitbucket PR webhook');
    logger.info(`Event: ${req.headers['x-event-key']}`);

    const eventKey = req.headers['x-event-key'];

    if (PROCESS_ONLY_CREATED && eventKey !== 'pullrequest:created') {
      logger.info(`⏭️  Event ignored (only processing PR creation): ${eventKey}`);
      return res.status(200).json({
        message: 'Event ignored (only processing PR creation)',
        event: eventKey,
      });
    }

    const repository = payload.repository.name;

    // Extract relevant PR information from the SAFE "payload" object
    const prData = {
      title: payload.pullrequest.title,
      description: payload.pullrequest.description || 'No description',
      author: payload.pullrequest.author.display_name,
      sourceBranch: payload.pullrequest.source.branch.name,
      destinationBranch: payload.pullrequest.destination.branch.name,
      prUrl: payload.pullrequest.links.html.href,
      repository: payload.repository.name,
      // We can safely search this array because Zod confirmed it only contains valid URLs
      repoCloneUrl:
        payload.repository.links.clone.find(link => link.name === 'https')?.href ||
        payload.repository.links.html.href, // Fallback to HTML URL
    };

    // This check is important in case the 'https' clone link wasn't found
    if (!prData.repoCloneUrl) {
      logger.warn('🚫 Could not find a valid HTTPS clone URL in the payload.');
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Could not find HTTPS clone URL in payload',
      });
    }

    logger.debug(`PR Data: ${JSON.stringify(prData)}`);

    if (eventKey === 'pullrequest:created') {
      metrics.prCreatedCounter.inc({ repository });
      logger.debug(`Metrics: Incremented PR created counter for ${repository}`);
    } else if (eventKey === 'pullrequest:updated') {
      metrics.prUpdatedCounter.inc({ repository });
      logger.debug(`Metrics: Incremented PR updated counter for ${repository}`);
    }

    res.status(200).json({
      message: 'Webhook received successfully',
      prTitle: prData.title,
      queuePosition: reviewQueue.length + 1,
    });

    reviewQueue.push(prData);
    logger.info(`✅ PR added to queue: ${prData.title} (queue size: ${reviewQueue.length})`);
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
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`PR Automation server listening on port ${PORT}`);
  logger.info(`Webhook endpoint: http://localhost:${PORT}/webhook/bitbucket/pr`);
  logger.info(
    `Event filtering: ${PROCESS_ONLY_CREATED ? 'Only PR creation events' : 'All PR events (created + updated)'}`,
  );
});

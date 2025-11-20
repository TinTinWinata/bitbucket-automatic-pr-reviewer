const client = require('prom-client');
const MetricsPersistence = require('./metrics-persistence');
const logger = require('./logger').default;

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (memory, CPU, etc.)
client.collectDefaultMetrics({ register });

// Initialize metrics persistence
const persistenceEnabled = process.env.METRICS_PERSISTENCE_ENABLED === 'true';
const persistenceType = process.env.METRICS_PERSISTENCE_TYPE || 'filesystem';
const persistencePath = process.env.METRICS_PERSISTENCE_PATH;

const persistence = new MetricsPersistence({
  enabled: persistenceEnabled,
  type: persistenceType,
  storagePath: persistencePath,
});

// Define custom metrics for PR automation

/**
 * Counter for total PRs created
 */
const prCreatedCounter = new client.Counter({
  name: 'pr_created_total',
  help: 'Total number of PRs created',
  labelNames: ['repository'],
  registers: [register],
});

/**
 * Counter for total PRs updated
 */
const prUpdatedCounter = new client.Counter({
  name: 'pr_updated_total',
  help: 'Total number of PRs updated',
  labelNames: ['repository'],
  registers: [register],
});

/**
 * Counter for LGTMs from Claude (no issues found)
 */
const claudeLgtmCounter = new client.Counter({
  name: 'claude_lgtm_total',
  help: 'Total number of LGTMs (approvals) from Claude integration',
  labelNames: ['repository'],
  registers: [register],
});

/**
 * Counter for issues found by Claude
 */
const claudeIssuesCounter = new client.Counter({
  name: 'claude_issues_found_total',
  help: 'Total number of issues found by Claude integration',
  labelNames: ['repository'],
  registers: [register],
});

/**
 * Counter for successful Claude reviews
 */
const claudeReviewSuccessCounter = new client.Counter({
  name: 'claude_review_success_total',
  help: 'Total number of PRs successfully reviewed by Claude',
  labelNames: ['repository'],
  registers: [register],
});

/**
 * Counter for failed Claude reviews
 */
const claudeReviewFailureCounter = new client.Counter({
  name: 'claude_review_failure_total',
  help: 'Total number of failed Claude reviews',
  labelNames: ['repository', 'error_type'],
  registers: [register],
});

/**
 * Histogram for Claude review duration
 */
const claudeReviewDurationHistogram = new client.Histogram({
  name: 'claude_review_duration_seconds',
  help: 'Duration of Claude reviews in seconds',
  labelNames: ['repository', 'status'],
  buckets: [5, 10, 30, 60, 120, 180, 300], // 5s, 10s, 30s, 1min, 2min, 3min, 5min
  registers: [register],
});

// Initialize metrics with 0 to make them visible in /metrics endpoint
// even before any events occur. This helps with Grafana dashboard setup.
// Note: Metrics will still show 0 until actual events increment them.
function initializeMetrics() {
  // Initialize with a dummy label to make metrics visible
  // These will be automatically replaced with real labels when events occur
  const dummyRepo = '_uninitialized';

  prCreatedCounter.inc({ repository: dummyRepo }, 0);
  prUpdatedCounter.inc({ repository: dummyRepo }, 0);
  claudeLgtmCounter.inc({ repository: dummyRepo }, 0);
  claudeIssuesCounter.inc({ repository: dummyRepo }, 0);
  claudeReviewSuccessCounter.inc({ repository: dummyRepo }, 0);
  claudeReviewFailureCounter.inc({ repository: dummyRepo, error_type: 'none' }, 0);
  claudeReviewDurationHistogram.observe({ repository: dummyRepo, status: 'none' }, 0);
}

// Initialize metrics on module load
initializeMetrics();

// Load persisted metrics if persistence is enabled
if (persistenceEnabled) {
  (async () => {
    try {
      const metricsData = persistence.load();
      if (
        Object.keys(metricsData.counters).length > 0 ||
        Object.keys(metricsData.histograms).length > 0
      ) {
        await persistence.restoreMetrics(register, metricsData, {
          prCreatedCounter,
          prUpdatedCounter,
          claudeLgtmCounter,
          claudeIssuesCounter,
          claudeReviewSuccessCounter,
          claudeReviewFailureCounter,
          claudeReviewDurationHistogram,
        });
        logger.info('✅ Loaded persisted metrics from storage');
      }
    } catch (error) {
      logger.error(`Failed to load persisted metrics: ${error.message}`);
    }
  })();
}

// Periodically save metrics (every 30 seconds)
let saveInterval = null;
if (persistenceEnabled) {
  const saveIntervalMs = parseInt(process.env.METRICS_PERSISTENCE_SAVE_INTERVAL_MS || '30000');
  saveInterval = setInterval(async () => {
    try {
      const metricsData = await persistence.extractMetricsData(register);
      persistence.save(metricsData);
      logger.debug('Metrics saved to persistence storage');
    } catch (error) {
      logger.error(`Failed to save metrics: ${error.message}`);
    }
  }, saveIntervalMs);

  // Save metrics on process exit
  const saveMetricsOnShutdown = async () => {
    if (saveInterval) {
      clearInterval(saveInterval);
      saveInterval = null;
    }
    try {
      const metricsData = await persistence.extractMetricsData(register);
      persistence.save(metricsData);
      persistence.close();
      logger.info('Metrics saved before shutdown');
    } catch (error) {
      logger.error(`Failed to save metrics on shutdown: ${error.message}`);
    }
    process.exit(0);
  };

  process.on('SIGTERM', saveMetricsOnShutdown);
  process.on('SIGINT', saveMetricsOnShutdown);
}

module.exports = {
  register,
  metrics: {
    prCreatedCounter,
    prUpdatedCounter,
    claudeLgtmCounter,
    claudeIssuesCounter,
    claudeReviewSuccessCounter,
    claudeReviewFailureCounter,
    claudeReviewDurationHistogram,
  },
  persistence,
};

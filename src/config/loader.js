'use strict';

const fs = require('fs');
const path = require('path');
const { default: logger } = require('../logger');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(__dirname, 'config.json.example');

const DEFAULT_CONFIG = {
  defaultTemplate: 'default',
  repositories: {},
  prReview: {
    enabled: true,
    targetBranchPatterns: [],
    sourceBranchPatterns: [],
  },
  releaseNote: {
    enabled: false,
    targetBranchPatterns: ['^release-'],
    sourceBranchPatterns: [],
  },
  server: { port: 3000 },
  claude: { model: 'sonnet', timeoutMinutes: 10, maxDiffSizeKb: 200 },
  bitbucket: { allowedWorkspace: 'yourworkspace', nonAllowedUsers: '' },
  eventFilter: { processOnlyCreated: false },
  manualTrigger: {
    enabled: true,
    prefixCommand: '/review',
    keywords: ['review'],
    botIds: [],
  },
  metrics: {
    persistence: {
      enabled: false,
      type: 'filesystem',
      path: '/app/metrics-storage',
      saveIntervalMs: 30000,
    },
  },
  logging: {
    level: 'info',
    fileRetentionDays: 30,
    maxFileSize: '20m',
    enableConsole: true,
    enableFile: true,
  },
  circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 30000 },
  promptLogs: { enabled: false, path: '/app/prompt-logs' },
};

let cachedConfig = null;

/**
 * Load config.json from disk. Returns default config if file missing or invalid.
 * Merges with DEFAULT_CONFIG so missing keys get defaults.
 * @returns {Object} Raw config object
 */
function loadRawConfig() {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const pathToLoad = fs.existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : fs.existsSync(CONFIG_EXAMPLE_PATH)
      ? CONFIG_EXAMPLE_PATH
      : null;
  if (pathToLoad) {
    try {
      const data = fs.readFileSync(pathToLoad, 'utf8');
      const loaded = JSON.parse(data);
      return deepMerge(defaults, loaded);
    } catch (err) {
      logger.error('[Load Raw Config] Error: ', err);
      // fall through to defaults
    }
  }
  return defaults;
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      out[key] = deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

/**
 * Deep merge: base object with overrides (env wins for leaf values).
 * Used to apply env overrides onto config.
 */
function applyEnvOverrides(config) {
  const e = process.env;
  const merged = JSON.parse(JSON.stringify(config));

  if (e.PORT !== undefined && e.PORT !== '') {
    merged.server = merged.server || {};
    merged.server.port = parseInt(e.PORT, 10) || config.server?.port || 3000;
  }
  if (e.CLAUDE_MODEL !== undefined && e.CLAUDE_MODEL !== '') {
    merged.claude = merged.claude || {};
    merged.claude.model = e.CLAUDE_MODEL;
  }
  if (e.CLAUDE_TIMEOUT_CONFIG !== undefined && e.CLAUDE_TIMEOUT_CONFIG !== '') {
    merged.claude = merged.claude || {};
    merged.claude.timeoutMinutes =
      parseInt(e.CLAUDE_TIMEOUT_CONFIG, 10) || config.claude?.timeoutMinutes || 10;
  }
  if (e.MAX_DIFF_SIZE_KB !== undefined && e.MAX_DIFF_SIZE_KB !== '') {
    merged.claude = merged.claude || {};
    merged.claude.maxDiffSizeKb =
      parseInt(e.MAX_DIFF_SIZE_KB, 10) || config.claude?.maxDiffSizeKb || 200;
  }
  if (e.ALLOWED_WORKSPACE !== undefined && e.ALLOWED_WORKSPACE !== '') {
    merged.bitbucket = merged.bitbucket || {};
    merged.bitbucket.allowedWorkspace = e.ALLOWED_WORKSPACE;
  }
  if (e.NON_ALLOWED_USERS !== undefined) {
    merged.bitbucket = merged.bitbucket || {};
    merged.bitbucket.nonAllowedUsers = e.NON_ALLOWED_USERS;
  }
  if (e.PROCESS_ONLY_CREATED !== undefined && e.PROCESS_ONLY_CREATED !== '') {
    merged.eventFilter = merged.eventFilter || {};
    merged.eventFilter.processOnlyCreated = e.PROCESS_ONLY_CREATED === 'true';
  }
  if (e.METRICS_PERSISTENCE_ENABLED !== undefined && e.METRICS_PERSISTENCE_ENABLED !== '') {
    merged.metrics = merged.metrics || {};
    merged.metrics.persistence = merged.metrics.persistence || {};
    merged.metrics.persistence.enabled = e.METRICS_PERSISTENCE_ENABLED === 'true';
  }
  if (e.METRICS_PERSISTENCE_TYPE !== undefined && e.METRICS_PERSISTENCE_TYPE !== '') {
    merged.metrics = merged.metrics || {};
    merged.metrics.persistence = merged.metrics.persistence || {};
    merged.metrics.persistence.type = e.METRICS_PERSISTENCE_TYPE;
  }
  if (e.METRICS_PERSISTENCE_PATH !== undefined && e.METRICS_PERSISTENCE_PATH !== '') {
    merged.metrics = merged.metrics || {};
    merged.metrics.persistence = merged.metrics.persistence || {};
    merged.metrics.persistence.path = e.METRICS_PERSISTENCE_PATH;
  }
  if (
    e.METRICS_PERSISTENCE_SAVE_INTERVAL_MS !== undefined &&
    e.METRICS_PERSISTENCE_SAVE_INTERVAL_MS !== ''
  ) {
    merged.metrics = merged.metrics || {};
    merged.metrics.persistence = merged.metrics.persistence || {};
    merged.metrics.persistence.saveIntervalMs =
      parseInt(e.METRICS_PERSISTENCE_SAVE_INTERVAL_MS, 10) ||
      config.metrics?.persistence?.saveIntervalMs ||
      30000;
  }
  if (e.LOG_LEVEL !== undefined && e.LOG_LEVEL !== '') {
    merged.logging = merged.logging || {};
    merged.logging.level = e.LOG_LEVEL;
  }
  if (e.LOG_FILE_RETENTION_DAYS !== undefined && e.LOG_FILE_RETENTION_DAYS !== '') {
    merged.logging = merged.logging || {};
    merged.logging.fileRetentionDays = e.LOG_FILE_RETENTION_DAYS;
  }
  if (e.LOG_MAX_FILE_SIZE !== undefined && e.LOG_MAX_FILE_SIZE !== '') {
    merged.logging = merged.logging || {};
    merged.logging.maxFileSize = e.LOG_MAX_FILE_SIZE;
  }
  if (e.LOG_ENABLE_CONSOLE !== undefined && e.LOG_ENABLE_CONSOLE !== '') {
    merged.logging = merged.logging || {};
    merged.logging.enableConsole = e.LOG_ENABLE_CONSOLE !== 'false';
  }
  if (e.LOG_ENABLE_FILE !== undefined && e.LOG_ENABLE_FILE !== '') {
    merged.logging = merged.logging || {};
    merged.logging.enableFile = e.LOG_ENABLE_FILE !== 'false';
  }
  if (e.CB_FAILURE_THRESHOLD !== undefined && e.CB_FAILURE_THRESHOLD !== '') {
    merged.circuitBreaker = merged.circuitBreaker || {};
    merged.circuitBreaker.failureThreshold =
      parseInt(e.CB_FAILURE_THRESHOLD, 10) || config.circuitBreaker?.failureThreshold || 3;
  }
  if (e.CB_RESET_TIMEOUT_MS !== undefined && e.CB_RESET_TIMEOUT_MS !== '') {
    merged.circuitBreaker = merged.circuitBreaker || {};
    merged.circuitBreaker.resetTimeoutMs =
      parseInt(e.CB_RESET_TIMEOUT_MS, 10) || config.circuitBreaker?.resetTimeoutMs || 30000;
  }
  if (e.PROMPT_LOGS_ENABLED !== undefined && e.PROMPT_LOGS_ENABLED !== '') {
    merged.promptLogs = merged.promptLogs || {};
    merged.promptLogs.enabled = e.PROMPT_LOGS_ENABLED === 'true';
  }
  if (e.PROMPT_LOGS_PATH !== undefined && e.PROMPT_LOGS_PATH !== '') {
    merged.promptLogs = merged.promptLogs || {};
    merged.promptLogs.path = e.PROMPT_LOGS_PATH;
  }

  return merged;
}

/**
 * Get merged configuration (config.json + env overrides). Cached after first call.
 * Secrets are read from env and attached under config.secrets (never from config.json).
 * @returns {Object} Full config with server, claude, bitbucket, eventFilter, metrics, logging, circuitBreaker, promptLogs, prReview, releaseNote, defaultTemplate, repositories, secrets
 */
function getConfig() {
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  const raw = loadRawConfig();
  const merged = applyEnvOverrides(raw);
  merged.secrets = {
    bitbucketToken: process.env.BITBUCKET_TOKEN,
    bitbucketUser: process.env.BITBUCKET_USER,
    webhookSecret: process.env.BITBUCKET_WEBHOOK_SECRET,
  };
  merged.manualTrigger = merged.manualTrigger || {};
  if (!merged.manualTrigger.prefixCommand) {
    merged.manualTrigger.prefixCommand = '/review';
  }
  if (!Array.isArray(merged.manualTrigger.keywords) || merged.manualTrigger.keywords.length === 0) {
    merged.manualTrigger.keywords = ['review'];
  }
  if (!Array.isArray(merged.manualTrigger.botIds)) {
    merged.manualTrigger.botIds = [];
  }
  if (process.env.BITBUCKET_BOT_IDS) {
    merged.manualTrigger.botIds = process.env.BITBUCKET_BOT_IDS.split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  cachedConfig = merged;
  return cachedConfig;
}

module.exports = {
  getConfig,
  loadRawConfig,
  DEFAULT_CONFIG,
};

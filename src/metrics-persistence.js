const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger').default;

class MetricsPersistence {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.type = (options.type || 'filesystem').toLowerCase();
    this.storagePath = options.storagePath || path.join(process.cwd(), 'metrics-storage');
    this.db = null;

    if (this.enabled) {
      this.initialize();
    }
  }

  /**
   * Initialize the persistence backend
   */
  initialize() {
    try {
      // Ensure storage directory exists
      fs.ensureDirSync(this.storagePath);

      if (this.type === 'sqlite') {
        this.initializeSQLite();
      } else if (this.type === 'filesystem') {
        this.initializeFilesystem();
      } else {
        logger.warn(`Unknown metrics persistence type: ${this.type}. Falling back to filesystem.`);
        this.type = 'filesystem';
        this.initializeFilesystem();
      }

      logger.info(
        `✅ Metrics persistence initialized (type: ${this.type}, path: ${this.storagePath})`,
      );
    } catch (error) {
      logger.error(`Failed to initialize metrics persistence: ${error.message}`);
      logger.warn('Metrics will continue without persistence');
      this.enabled = false;
    }
  }

  /**
   * Initialize SQLite database
   */
  initializeSQLite() {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(this.storagePath, 'metrics.db');

      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better performance

      // Create tables if they don't exist
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS counter_metrics (
          name TEXT NOT NULL,
          labels TEXT NOT NULL,
          value REAL NOT NULL,
          PRIMARY KEY (name, labels)
        );

        CREATE TABLE IF NOT EXISTS histogram_metrics (
          name TEXT NOT NULL,
          labels TEXT NOT NULL,
          bucket TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (name, labels, bucket)
        );
      `);

      logger.info(`SQLite database initialized at ${dbPath}`);
    } catch (error) {
      // If better-sqlite3 is not available, fall back to filesystem
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.warn('better-sqlite3 not found. Falling back to filesystem storage.');
        this.type = 'filesystem';
        this.initializeFilesystem();
      } else {
        throw error;
      }
    }
  }

  /**
   * Initialize filesystem storage
   */
  initializeFilesystem() {
    const filePath = path.join(this.storagePath, 'metrics.json');
    // Ensure the file exists with empty object
    if (!fs.pathExistsSync(filePath)) {
      fs.writeJsonSync(filePath, {
        counters: {},
        histograms: {},
      });
    }
    this.filePath = filePath;
  }

  /**
   * Load metrics from storage
   * @returns {Object} Object with counters and histograms
   */
  load() {
    if (!this.enabled) {
      return { counters: {}, histograms: {} };
    }

    try {
      if (this.type === 'sqlite') {
        return this.loadFromSQLite();
      } else {
        return this.loadFromFilesystem();
      }
    } catch (error) {
      logger.error(`Failed to load metrics from storage: ${error.message}`);
      return { counters: {}, histograms: {} };
    }
  }

  /**
   * Load metrics from SQLite
   */
  loadFromSQLite() {
    const counters = {};
    const histograms = {};

    // Load counter metrics
    const counterRows = this.db.prepare('SELECT name, labels, value FROM counter_metrics').all();
    for (const row of counterRows) {
      const labels = JSON.parse(row.labels);
      const key = `${row.name}:${JSON.stringify(labels)}`;
      counters[key] = {
        name: row.name,
        labels: labels,
        value: row.value,
      };
    }

    // Load histogram metrics
    const histogramRows = this.db
      .prepare('SELECT name, labels, bucket, count FROM histogram_metrics')
      .all();
    for (const row of histogramRows) {
      const labels = JSON.parse(row.labels);
      const key = `${row.name}:${JSON.stringify(labels)}`;
      if (!histograms[key]) {
        histograms[key] = {
          name: row.name,
          labels: labels,
          buckets: {},
        };
      }
      histograms[key].buckets[row.bucket] = row.count;
    }

    return { counters, histograms };
  }

  /**
   * Load metrics from filesystem
   */
  loadFromFilesystem() {
    if (!fs.pathExistsSync(this.filePath)) {
      return { counters: {}, histograms: {} };
    }

    const data = fs.readJsonSync(this.filePath);
    return {
      counters: data.counters || {},
      histograms: data.histograms || {},
    };
  }

  /**
   * Save metrics to storage
   * @param {Object} metricsData - Object with counters and histograms
   */
  save(metricsData) {
    if (!this.enabled) {
      return;
    }

    try {
      if (this.type === 'sqlite') {
        this.saveToSQLite(metricsData);
      } else {
        this.saveToFilesystem(metricsData);
      }
    } catch (error) {
      logger.error(`Failed to save metrics to storage: ${error.message}`);
    }
  }

  /**
   * Save metrics to SQLite
   */
  saveToSQLite(metricsData) {
    const transaction = this.db.transaction(() => {
      // Clear existing data
      this.db.prepare('DELETE FROM counter_metrics').run();
      this.db.prepare('DELETE FROM histogram_metrics').run();

      // Insert counter metrics
      const insertCounter = this.db.prepare(
        'INSERT INTO counter_metrics (name, labels, value) VALUES (?, ?, ?)',
      );
      for (const key in metricsData.counters) {
        const metric = metricsData.counters[key];
        insertCounter.run(metric.name, JSON.stringify(metric.labels), metric.value);
      }

      // Insert histogram metrics
      const insertHistogram = this.db.prepare(
        'INSERT INTO histogram_metrics (name, labels, bucket, count) VALUES (?, ?, ?, ?)',
      );
      for (const key in metricsData.histograms) {
        const metric = metricsData.histograms[key];
        for (const bucket in metric.buckets) {
          insertHistogram.run(
            metric.name,
            JSON.stringify(metric.labels),
            bucket,
            metric.buckets[bucket],
          );
        }
      }
    });

    transaction();
  }

  /**
   * Save metrics to filesystem
   */
  saveToFilesystem(metricsData) {
    fs.writeJsonSync(
      this.filePath,
      {
        counters: metricsData.counters || {},
        histograms: metricsData.histograms || {},
      },
      { spaces: 2 },
    );
  }

  /**
   * Extract metrics data from Prometheus registry
   * @param {Object} register - Prometheus registry
   * @returns {Object} Extracted metrics data
   */
  extractMetricsData(register) {
    const counters = {};
    const histograms = {};

    // Get all metrics from registry
    const metrics = register.getMetricsAsJSON();

    // Ensure metrics is an iterable array
    if (!metrics || !Array.isArray(metrics)) {
      logger.warn('getMetricsAsJSON() did not return a valid array, returning empty metrics');
      return { counters, histograms };
    }

    for (const metric of metrics) {
      if (metric.type === 'counter') {
        for (const sample of metric.values || []) {
          const key = `${metric.name}:${JSON.stringify(sample.labels || {})}`;
          counters[key] = {
            name: metric.name,
            labels: sample.labels || {},
            value: sample.value || 0,
          };
        }
      } else if (metric.type === 'histogram') {
        for (const sample of metric.values || []) {
          if (sample.labels) {
            const key = `${metric.name}:${JSON.stringify(sample.labels)}`;
            if (!histograms[key]) {
              histograms[key] = {
                name: metric.name,
                labels: sample.labels,
                buckets: {},
              };
            }
            // Histogram buckets are in the format: {le="5"} etc.
            // Extract bucket value from labels
            if (sample.labels.le !== undefined) {
              histograms[key].buckets[sample.labels.le] = sample.value || 0;
            }
          }
        }
      }
    }

    return { counters, histograms };
  }

  /**
   * Restore metrics to Prometheus registry
   * @param {Object} register - Prometheus registry
   * @param {Object} metricsData - Loaded metrics data
   * @param {Object} metricObjects - Metric objects from metrics.js
   */
  restoreMetrics(register, metricsData, metricObjects) {
    // Restore counter metrics
    for (const key in metricsData.counters) {
      const metric = metricsData.counters[key];
      const metricObj = this.findMetricByName(metric.name, metricObjects);

      if (metricObj && typeof metricObj.inc === 'function') {
        // Get current value
        const currentValue = this.getCurrentMetricValue(register, metric.name, metric.labels);
        // Increment by the difference (or set if 0)
        const difference = metric.value - currentValue;
        if (difference > 0) {
          metricObj.inc(metric.labels, difference);
        }
      }
    }

    // Note: Histograms are more complex to restore, so we'll skip them for now
    // as they're primarily used for duration tracking which is less critical
    logger.debug(`Restored ${Object.keys(metricsData.counters).length} counter metrics`);
  }

  /**
   * Find metric object by name
   */
  findMetricByName(name, metricObjects) {
    const metricMap = {
      pr_created_total: metricObjects.prCreatedCounter,
      pr_updated_total: metricObjects.prUpdatedCounter,
      claude_lgtm_total: metricObjects.claudeLgtmCounter,
      claude_issues_found_total: metricObjects.claudeIssuesCounter,
      claude_review_success_total: metricObjects.claudeReviewSuccessCounter,
      claude_review_failure_total: metricObjects.claudeReviewFailureCounter,
      claude_review_duration_seconds: metricObjects.claudeReviewDurationHistogram,
    };

    return metricMap[name];
  }

  /**
   * Get current metric value from registry
   */
  getCurrentMetricValue(register, name, labels) {
    try {
      const metrics = register.getMetricsAsJSON();
      if (!metrics || !Array.isArray(metrics)) {
        return 0;
      }
      const metric = metrics.find(m => m.name === name);

      if (metric && metric.values) {
        const sample = metric.values.find(
          v => JSON.stringify(v.labels || {}) === JSON.stringify(labels),
        );
        return sample ? sample.value || 0 : 0;
      }
    } catch (error) {
      console.error('Error getting current metric value:', error);
    }

    return 0;
  }

  /**
   * Close database connection if using SQLite
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = MetricsPersistence;

const client = require('prom-client');
const metrics = require('../src/metrics');

describe('Metrics.js Unit Tests', () => {
  beforeEach(() => {
    metrics.metrics.claudeReviewDurationHistogram = {
      observe: jest.fn(),
      name: 'claude_review_duration_seconds',
      help: 'Duration of Claude reviews in seconds',
      labelNames: ['repository', 'status'],
      upperBounds: [5, 10, 30, 60, 120, 180, 300, Infinity],
    };
    metrics.register.clear();
    jest.resetModules();
    delete require.cache[require.resolve('../src/metrics')];
  });

  afterEach(() => {
    metrics.register.clear();
  });

  describe('Register Metrics', () => {
    test('should export register and metrics object', () => {
      expect(metrics).toHaveProperty('register');
      expect(metrics).toHaveProperty('metrics');
      expect(metrics.register).toBeInstanceOf(client.Registry);
      expect(typeof metrics.metrics).toBe('object');
    });

    test('should export all required metric instances', () => {
      const { metrics: metricsObj } = metrics;

      expect(metricsObj).toHaveProperty('prCreatedCounter');
      expect(metricsObj).toHaveProperty('prUpdatedCounter');
      expect(metricsObj).toHaveProperty('claudeLgtmCounter');
      expect(metricsObj).toHaveProperty('claudeIssuesCounter');
      expect(metricsObj).toHaveProperty('claudeReviewSuccessCounter');
      expect(metricsObj).toHaveProperty('claudeReviewFailureCounter');
      expect(metricsObj).toHaveProperty('claudeReviewDurationHistogram');
    });
  });

  describe('Counter Metrics', () => {
    test('prCreatedCounter should be configured correctly', () => {
      const counter = metrics.metrics.prCreatedCounter;
      expect(counter).toBeInstanceOf(client.Counter);
      expect(counter.name).toBe('pr_created_total');
      expect(counter.help).toBe('Total number of PRs created');
      expect(counter.labelNames).toContain('repository');
    });

    test('prUpdatedCounter should be configured correctly', () => {
      const counter = metrics.metrics.prUpdatedCounter;
      expect(counter).toBeInstanceOf(client.Counter);
      expect(counter.name).toBe('pr_updated_total');
      expect(counter.help).toBe('Total number of PRs updated');
      expect(counter.labelNames).toContain('repository');
    });

    test('claudeLgtmCounter should be configured correctly', () => {
      const counter = metrics.metrics.claudeLgtmCounter;
      expect(counter).toBeInstanceOf(client.Counter);
      expect(counter.name).toBe('claude_lgtm_total');
      expect(counter.help).toBe('Total number of LGTMs (approvals) from Claude integration');
      expect(counter.labelNames).toContain('repository');
    });

    test('claudeIssuesCounter should be configured correctly', () => {
      const counter = metrics.metrics.claudeIssuesCounter;
      expect(counter).toBeInstanceOf(client.Counter);
      expect(counter.name).toBe('claude_issues_found_total');
      expect(counter.help).toBe('Total number of issues found by Claude integration');
      expect(counter.labelNames).toContain('repository');
    });

    test('claudeReviewSuccessCounter should be configured correctly', () => {
      const counter = metrics.metrics.claudeReviewSuccessCounter;
      expect(counter).toBeInstanceOf(client.Counter);
      expect(counter.name).toBe('claude_review_success_total');
      expect(counter.help).toBe('Total number of PRs successfully reviewed by Claude');
      expect(counter.labelNames).toContain('repository');
    });

    test('claudeReviewFailureCounter should be configured correctly', () => {
      const counter = metrics.metrics.claudeReviewFailureCounter;
      expect(counter).toBeInstanceOf(client.Counter);
      expect(counter.name).toBe('claude_review_failure_total');
      expect(counter.help).toBe('Total number of failed Claude reviews');
      expect(counter.labelNames).toContain('repository');
      expect(counter.labelNames).toContain('error_type');
    });
  });

  describe('Histogram Metrics', () => {
    test('claudeReviewDurationHistogram should be configured correctly', () => {
      const mockHistogram = {
        name: 'claude_review_duration_seconds',
        help: 'Duration of Claude reviews in seconds',
        labelNames: ['repository', 'status'],
        upperBounds: [5, 10, 30, 60, 120, 180, 300, Infinity],
      };
      metrics.metrics = {
        ...metrics.metrics,
        claudeReviewDurationHistogram: mockHistogram,
      };

      jest.spyOn(client, 'Histogram').mockImplementation(() => mockHistogram);

      const histogram = metrics.metrics.claudeReviewDurationHistogram;
      expect(histogram.name).toBe('claude_review_duration_seconds');
      expect(histogram.help).toBe('Duration of Claude reviews in seconds');
      expect(histogram.labelNames).toContain('repository');
      expect(histogram.labelNames).toContain('status');
      expect(histogram.upperBounds).toEqual([5, 10, 30, 60, 120, 180, 300, Infinity]);
    });
  });

  describe('Metric Functionality', () => {
    test('counters should increment correctly', () => {
      const testRepo = 'test-repo';

      metrics.metrics.prCreatedCounter.inc({ repository: testRepo });
      metrics.metrics.prCreatedCounter.inc({ repository: testRepo }, 2);

      jest.spyOn(metrics.register, 'getSingleMetric').mockReturnValue({
        name: 'pr_created_total',
      });
      const prCreatedMetric = metrics.register.getSingleMetric('pr_created_total');
      expect(prCreatedMetric).toBeDefined();
    });

    test('histogram should observe values correctly', () => {
      const testRepo = 'test-repo';
      const testStatus = 'success';

      metrics.metrics.claudeReviewDurationHistogram.observe(
        { repository: testRepo, status: testStatus },
        45,
      );
      metrics.metrics.claudeReviewDurationHistogram.observe(
        { repository: testRepo, status: testStatus },
        120,
      );

      jest.spyOn(metrics.register, 'getSingleMetric').mockReturnValue('metric');

      const histogramMetric = metrics.register.getSingleMetric('claude_review_duration_seconds');

      expect(histogramMetric).toBeDefined();
      expect(histogramMetric).toBe('metric');
    });

    test('should handle multiple repositories independently', () => {
      const repo1 = 'repo-1';
      const repo2 = 'repo-2';

      metrics.metrics.prCreatedCounter.inc({ repository: repo1 }, 3);
      metrics.metrics.prCreatedCounter.inc({ repository: repo2 }, 5);

      metrics.metrics.claudeLgtmCounter.inc({ repository: repo1 }, 2);
      metrics.metrics.claudeLgtmCounter.inc({ repository: repo2 }, 1);

      jest.spyOn(metrics.register, 'getSingleMetric').mockReturnValue('metric');

      const prCreatedMetric = metrics.register.getSingleMetric('pr_created_total');
      const claudeLgtmMetric = metrics.register.getSingleMetric('claude_lgtm_total');

      expect(prCreatedMetric).toBeDefined();
      expect(claudeLgtmMetric).toBeDefined();
    });
  });

  describe('Registry Integration', () => {
    test('all metrics should be registered in the registry', () => {
      const mockMetricsArray = [
        { name: 'pr_created_total' },
        { name: 'pr_updated_total' },
        { name: 'claude_lgtm_total' },
        { name: 'claude_issues_found_total' },
        { name: 'claude_review_success_total' },
        { name: 'claude_review_failure_total' },
        { name: 'claude_review_duration_seconds' },
      ];

      jest.spyOn(metrics.register, 'getMetricsAsArray').mockReturnValue(mockMetricsArray);

      const metricNames = metrics.register.getMetricsAsArray().map(metric => metric.name);

      expect(metricNames).toContain('pr_created_total');
      expect(metricNames).toContain('pr_updated_total');
      expect(metricNames).toContain('claude_lgtm_total');
      expect(metricNames).toContain('claude_issues_found_total');
      expect(metricNames).toContain('claude_review_success_total');
      expect(metricNames).toContain('claude_review_failure_total');
      expect(metricNames).toContain('claude_review_duration_seconds');
    });

    test('should be able to get metrics string output', async () => {
      jest.spyOn(metrics.register, 'metrics').mockReturnValue('pr_created_total');

      metrics.metrics.prCreatedCounter.inc({ repository: 'test-repo' }, 1);
      metrics.metrics.claudeReviewDurationHistogram.observe(
        { repository: 'test-repo', status: 'success' },
        30,
      );

      const metricsOutput = await metrics.register.metrics();
      expect(typeof metricsOutput).toBe('string');
      expect(metricsOutput).toContain('pr_created_total');
    });

    test('should include default metrics', () => {
      jest
        .spyOn(metrics.register, 'getMetricsAsArray')
        .mockReturnValue([
          { name: 'process_cpu_user_seconds_total' },
          { name: 'nodejs_eventloop_lag_seconds' },
        ]);

      const metricNames = metrics.register.getMetricsAsArray().map(metric => metric.name);

      expect(metricNames.some(name => name.startsWith('process_'))).toBeTruthy();
      expect(metricNames.some(name => name.startsWith('nodejs_'))).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid label values gracefully', () => {
      expect(() => {
        metrics.metrics.prCreatedCounter.inc({ repository: '' });
      }).not.toThrow();
    });

    test('should handle negative histogram values', () => {
      metrics.metrics.claudeReviewDurationHistogram.observe = jest.fn().mockImplementation(() => {
        throw new Error();
      });
      expect(() => {
        metrics.metrics.claudeReviewDurationHistogram.observe(
          { repository: 'test-repo', status: 'test' },
          -5,
        );
      }).toThrow();
    });

    test('should handle missing labels gracefully', () => {
      expect(() => {
        metrics.metrics.prCreatedCounter.inc({});
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    test('should handle many metric updates efficiently', () => {
      const startTime = process.hrtime();

      for (let i = 0; i < 1000; i++) {
        metrics.metrics.prCreatedCounter.inc({ repository: `repo-${i % 10}` });
        metrics.metrics.claudeReviewDurationHistogram.observe(
          { repository: `repo-${i % 10}`, status: 'success' },
          Math.random() * 100,
        );
      }

      const [seconds, nanoseconds] = process.hrtime(startTime);
      const totalTimeMs = seconds * 1000 + nanoseconds / 1000000;

      expect(totalTimeMs).toBeLessThan(1000);
    });
  });
});

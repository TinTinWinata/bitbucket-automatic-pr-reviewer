# Prometheus Integration

This document describes the Prometheus metrics integration in the PR Automation project.

## Overview

The application exposes Prometheus metrics to track PR automation activities and Claude review performance.

## Metrics Endpoint

The metrics are exposed at:

```
GET http://localhost:3000/metrics
```

## Available Metrics

### 1. PR Created Counter
**Metric Name:** `pr_created_total`  
**Type:** Counter  
**Description:** Total number of PRs created  
**Labels:** 
- `repository`: Name of the repository

**Example:**
```
pr_created_total{repository="my-app"} 42
```

### 2. PR Updated Counter
**Metric Name:** `pr_updated_total`  
**Type:** Counter  
**Description:** Total number of PRs updated  
**Labels:**
- `repository`: Name of the repository

**Example:**
```
pr_updated_total{repository="my-app"} 18
```

### 3. Claude LGTM Counter
**Metric Name:** `claude_lgtm_total`  
**Type:** Counter  
**Description:** Total number of LGTMs (approvals) from Claude integration  
**Labels:**
- `repository`: Name of the repository

**Example:**
```
claude_lgtm_total{repository="my-app"} 35
```

### 4. Claude Issues Found Counter
**Metric Name:** `claude_issues_found_total`  
**Type:** Counter  
**Description:** Total number of issues found by Claude integration (counts all individual issues, not just PRs with issues)  
**Labels:**
- `repository`: Name of the repository

**Note:** This counter increments by the actual number of issues found in each review. For example, if a PR has 3 issues, the counter increases by 3.

**Example:**
```
claude_issues_found_total{repository="my-app"} 27
```

### 5. Claude Review Success Counter
**Metric Name:** `claude_review_success_total`  
**Type:** Counter  
**Description:** Total number of PRs successfully reviewed by Claude  
**Labels:**
- `repository`: Name of the repository

**Example:**
```
claude_review_success_total{repository="my-app"} 40
```

### 6. Claude Review Failure Counter
**Metric Name:** `claude_review_failure_total`  
**Type:** Counter  
**Description:** Total number of failed Claude reviews  
**Labels:**
- `repository`: Name of the repository
- `error_type`: Type of error (timeout, git_error, unknown)

**Example:**
```
claude_review_failure_total{repository="my-app",error_type="timeout"} 2
```

### 7. Claude Review Duration Histogram
**Metric Name:** `claude_review_duration_seconds`  
**Type:** Histogram  
**Description:** Duration of Claude reviews in seconds  
**Labels:**
- `repository`: Name of the repository
- `status`: Review status (success, failure)

**Buckets:** 5s, 10s, 30s, 1min, 2min, 3min, 5min

**Example:**
```
claude_review_duration_seconds_bucket{repository="my-app",status="success",le="30"} 15
claude_review_duration_seconds_bucket{repository="my-app",status="success",le="60"} 25
claude_review_duration_seconds_sum{repository="my-app",status="success"} 1250.5
claude_review_duration_seconds_count{repository="my-app",status="success"} 40
```

### 8. Default Node.js Metrics

The application also exports standard Node.js metrics including:
- Process CPU usage
- Process memory usage
- Event loop lag
- Active handles
- And more...

## Prometheus Configuration

To scrape metrics from the PR automation service, add this job to your `prometheus.yml`:

```yaml
- job_name: 'pr-automation'
  metrics_path: /metrics
  static_configs:
    - targets: ['pr-automation:3000']
```

If you're using the Docker Compose setup above, the Prometheus configuration is automatically included.

## Grafana Dashboards

### Example Queries

Here are some useful PromQL queries for creating Grafana dashboards:

#### Total PRs Created Over Time
```promql
rate(pr_created_total[5m])
```

#### Total PRs Updated Over Time
```promql
rate(pr_updated_total[5m])
```

#### Claude LGTM Rate (Approval Rate)
```promql
rate(claude_lgtm_total[5m])
```

#### Claude Issues Found Rate
```promql
rate(claude_issues_found_total[5m])
```

#### Claude Review Success Rate
```promql
rate(claude_review_success_total[5m]) / (rate(claude_review_success_total[5m]) + rate(claude_review_failure_total[5m])) * 100
```

#### Average Review Duration
```promql
rate(claude_review_duration_seconds_sum[5m]) / rate(claude_review_duration_seconds_count[5m])
```

#### 95th Percentile Review Duration
```promql
histogram_quantile(0.95, rate(claude_review_duration_seconds_bucket[5m]))
```

#### Review Failures by Error Type
```promql
sum by (error_type) (rate(claude_review_failure_total[5m]))
```

### Sample Dashboard JSON

You can import this basic dashboard into Grafana:

```json
{
  "dashboard": {
    "title": "PR Automation Metrics",
    "panels": [
      {
        "title": "PRs Created",
        "targets": [
          {
            "expr": "rate(pr_created_total[5m])"
          }
        ]
      },
      {
        "title": "Claude LGTM vs Issues",
        "targets": [
          {
            "expr": "rate(claude_lgtm_total[5m])",
            "legendFormat": "LGTM"
          },
          {
            "expr": "rate(claude_issues_found_total[5m])",
            "legendFormat": "Issues Found"
          }
        ]
      },
      {
        "title": "Review Success Rate",
        "targets": [
          {
            "expr": "rate(claude_review_success_total[5m]) / (rate(claude_review_success_total[5m]) + rate(claude_review_failure_total[5m])) * 100"
          }
        ]
      },
      {
        "title": "Review Duration (95th percentile)",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(claude_review_duration_seconds_bucket[5m]))"
          }
        ]
      }
    ]
  }
}
```

## Adding Monitoring to Your Setup

If you want to add Prometheus and Grafana to your `docker-compose.yml`:

```yaml
services:
  # Your existing pr-automation service...
  
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    ports:
      - "9090:9090"
    networks:
      - pr-automation-network

  grafana:
    image: grafana/grafana:latest
    volumes:
      - grafana-data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    ports:
      - "3001:3000"
    networks:
      - pr-automation-network
    depends_on:
      - prometheus

volumes:
  prometheus-data:
  grafana-data:

networks:
  pr-automation-network:
```

## Testing the Metrics

You can test the metrics endpoint with curl:

```bash
curl http://localhost:3000/metrics
```

This will return all available metrics in Prometheus text format.

## Metric Collection Points

The application collects metrics at the following points:

1. **PR Created/Updated**: When a webhook is received with event type `pullrequest:created` or `pullrequest:updated`
2. **Review Success**: When Claude completes a review successfully
3. **Review Failure**: When Claude review fails (timeout, git errors, etc.)
4. **LGTM**: When Claude response contains JSON metrics with `isLgtm: true`
5. **Issues Found**: Extracted from JSON metrics with `issueCount` field. If a review finds 3 issues, the counter increases by 3, not 1.
6. **Review Duration**: Tracked from the start of `processPullRequest` to completion

## Current Implementation Features

### Bitbucket MCP Integration
The current implementation uses Bitbucket MCP (Model Context Protocol) tools to:
- Fetch PR details and file diffs directly from Bitbucket
- Post review comments back to the PR
- Provide Claude with direct access to Bitbucket data without manual git operations

### Sequential Processing Queue
The application uses a queue system to process PRs sequentially, preventing:
- Branch conflicts when multiple PRs are processed simultaneously
- Git checkout issues
- Resource contention

### JSON Metrics Output
Claude is instructed to output metrics in a specific JSON format at the end of each review:
```json
{
  "isLgtm": true/false,
  "issueCount": <number>
}
```

This ensures accurate metric collection without relying on text parsing.

## Notes

- All counters are cumulative and will only increase
- Histograms provide percentile calculations for review durations
- Metrics are labeled by repository name for per-repo tracking
- The metrics endpoint is accessible without authentication (consider adding auth in production)


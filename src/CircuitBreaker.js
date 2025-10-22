class CircuitBreaker {
  constructor(failureThreshold = 5, resetTimeout = 10000) {
    this.failureCount = 0;
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }

  canAttempt() {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.lastFailureTime = Date.now();
      console.warn(`🔌 Circuit breaker tripped after ${this.failureCount} failures`);
    } else {
      console.warn(`🔌 Failure recorded (${this.failureCount}/${this.failureThreshold})`);
    }
  }
}

module.exports = CircuitBreaker;

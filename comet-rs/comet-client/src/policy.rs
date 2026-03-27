use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TimeoutPolicy {
    pub request_timeout: Duration,
    pub connect_timeout: Duration,
}

impl TimeoutPolicy {
    pub fn new(request_timeout: Duration, connect_timeout: Duration) -> Self {
        Self {
            request_timeout,
            connect_timeout,
        }
    }
}

impl Default for TimeoutPolicy {
    fn default() -> Self {
        Self {
            request_timeout: Duration::from_secs(60),
            connect_timeout: Duration::from_secs(10),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    pub max_attempts: u32,
    pub backoff: Duration,
}

impl RetryPolicy {
    pub fn disabled() -> Self {
        Self {
            max_attempts: 1,
            backoff: Duration::from_millis(0),
        }
    }

    pub fn allows_retry(&self, attempt: u32) -> bool {
        attempt < self.max_attempts
    }
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: 1,
            backoff: Duration::from_millis(0),
        }
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use std::time::Duration;

    #[test]
    fn timeout_policy_defaults_are_bounded() {
        let policy = super::TimeoutPolicy::default();
        assert_eq!(policy.request_timeout, Duration::from_secs(60));
        assert_eq!(policy.connect_timeout, Duration::from_secs(10));
    }

    #[test]
    fn retry_policy_disabled_uses_single_attempt() {
        let policy = super::RetryPolicy::disabled();
        assert_eq!(policy.max_attempts, 1);
        assert_eq!(policy.backoff, Duration::from_millis(0));
        assert_eq!(policy.allows_retry(1), false);
    }

    #[test]
    fn retry_policy_allows_attempts_before_limit() {
        let policy = super::RetryPolicy {
            max_attempts: 3,
            backoff: Duration::from_millis(25),
        };
        assert_eq!(policy.allows_retry(1), true);
        assert_eq!(policy.allows_retry(2), true);
        assert_eq!(policy.allows_retry(3), false);
    }
}

use super::TransportError;
use crate::RetryPolicy;
use crate::TimeoutPolicy;
use reqwest::header::HeaderMap;
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct AsyncHttpClient {
    inner: reqwest::Client,
    retry_policy: RetryPolicy,
}

impl AsyncHttpClient {
    pub fn new() -> Self {
        Self::with_policies(TimeoutPolicy::default(), RetryPolicy::default())
    }

    pub fn with_policies(timeout_policy: TimeoutPolicy, retry_policy: RetryPolicy) -> Self {
        Self {
            inner: reqwest::Client::builder()
                .timeout(timeout_policy.request_timeout)
                .connect_timeout(timeout_policy.connect_timeout)
                .build()
                .expect("async reqwest client builds"),
            retry_policy,
        }
    }

    pub async fn post_json_with_bearer_env<T: Serialize>(
        &self,
        url: &str,
        api_key_env: &str,
        body: &T,
    ) -> Result<reqwest::Response, TransportError> {
        let headers = super::auth::bearer_env_headers(api_key_env)?;
        self.post_json(url, headers, body).await
    }

    pub async fn post_json<T: Serialize>(
        &self,
        url: &str,
        headers: HeaderMap,
        body: &T,
    ) -> Result<reqwest::Response, TransportError> {
        let mut last_error: Option<TransportError> = None;

        for attempt in 1..=self.retry_policy.max_attempts {
            let request = self.inner.post(url).headers(headers.clone()).json(body);
            match request.send().await {
                Ok(response) => return map_http_response(response).await,
                Err(error) => {
                    let transport_error = if error.is_timeout() {
                        TransportError::Timeout {
                            message: error.to_string(),
                        }
                    } else {
                        TransportError::RequestFailed {
                            message: error.to_string(),
                        }
                    };
                    last_error = Some(transport_error);
                }
            }

            if self.retry_policy.allows_retry(attempt) {
                tokio::time::sleep(self.retry_policy.backoff).await;
                continue;
            }
        }

        let last_error = last_error.expect("retry loop records last error");
        Err(TransportError::RetryExhausted {
            attempts: self.retry_policy.max_attempts,
            last_error: format!("{last_error:?}"),
        })
    }
}

impl Default for AsyncHttpClient {
    fn default() -> Self {
        Self::new()
    }
}

async fn map_http_response(response: reqwest::Response) -> Result<reqwest::Response, TransportError> {
    let status = response.status();
    if !status.is_success() {
        let status = status.as_u16();
        let body = response
            .text()
            .await
            .map_err(|error| TransportError::ResponseBodyReadFailed {
                status,
                message: error.to_string(),
            })?;
        return Err(TransportError::HttpStatus { status, body });
    }

    Ok(response)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use std::time::Duration;

    #[test]
    fn async_client_can_be_built_with_custom_policies() {
        let client = super::AsyncHttpClient::with_policies(
            crate::TimeoutPolicy::new(Duration::from_secs(5), Duration::from_secs(2)),
            crate::RetryPolicy {
                max_attempts: 2,
                backoff: Duration::from_millis(1),
            },
        );

        let debug = format!("{client:?}");
        assert_eq!(debug.contains("AsyncHttpClient"), true);
    }
}

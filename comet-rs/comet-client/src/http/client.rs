use super::TransportError;
use crate::RetryPolicy;
use crate::TimeoutPolicy;
use reqwest::blocking::Client;
use reqwest::blocking::Response;
use reqwest::header::HeaderMap;
use serde::Serialize;
use std::thread::sleep;

#[derive(Debug, Clone)]
pub struct BlockingHttpClient {
    inner: Client,
    retry_policy: RetryPolicy,
}

impl BlockingHttpClient {
    pub fn new() -> Self {
        Self::with_policies(TimeoutPolicy::default(), RetryPolicy::default())
    }

    pub fn with_policies(timeout_policy: TimeoutPolicy, retry_policy: RetryPolicy) -> Self {
        Self {
            inner: Client::builder()
                .timeout(timeout_policy.request_timeout)
                .connect_timeout(timeout_policy.connect_timeout)
                .build()
                .expect("blocking reqwest client builds"),
            retry_policy,
        }
    }

    pub fn post_json_with_bearer_env<T: Serialize>(
        &self,
        url: &str,
        api_key_env: &str,
        body: &T,
    ) -> Result<Response, TransportError> {
        let headers = super::auth::bearer_env_headers(api_key_env)?;
        self.post_json(url, headers, body)
    }

    pub fn post_json<T: Serialize>(
        &self,
        url: &str,
        headers: HeaderMap,
        body: &T,
    ) -> Result<Response, TransportError> {
        let mut last_error: Option<TransportError> = None;

        for attempt in 1..=self.retry_policy.max_attempts {
            let request = self.inner.post(url).headers(headers.clone()).json(body);
            match request.send() {
                Ok(response) => return map_http_response(response),
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
                sleep(self.retry_policy.backoff);
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

impl Default for BlockingHttpClient {
    fn default() -> Self {
        Self::new()
    }
}

fn map_http_response(response: Response) -> Result<Response, TransportError> {
    let status = response.status();
    if !status.is_success() {
        let status = status.as_u16();
        let body = response
            .text()
            .map_err(|error| TransportError::ResponseBodyReadFailed {
                status,
                message: error.to_string(),
            })?;
        return Err(TransportError::HttpStatus { status, body });
    }

    Ok(response)
}

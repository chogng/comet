use super::TransportError;
use reqwest::header::AUTHORIZATION;
use reqwest::header::CONTENT_TYPE;
use reqwest::header::HeaderMap;
use reqwest::header::HeaderValue;

pub fn bearer_env_headers(api_key_env: &str) -> Result<HeaderMap, TransportError> {
    let api_key = std::env::var(api_key_env).map_err(|_| TransportError::EnvVarMissing {
        var_name: api_key_env.to_string(),
    })?;

    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|error| {
            TransportError::InvalidHeader {
                message: error.to_string(),
            }
        })?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(headers)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use reqwest::header::AUTHORIZATION;
    use reqwest::header::CONTENT_TYPE;

    #[test]
    fn missing_env_var_returns_transport_error() {
        let result = super::bearer_env_headers("COMET_CLIENT_TEST_MISSING_KEY");
        assert_eq!(
            result.expect_err("missing env should fail"),
            super::TransportError::EnvVarMissing {
                var_name: "COMET_CLIENT_TEST_MISSING_KEY".to_string(),
            }
        );
    }

    #[test]
    fn builds_bearer_headers_from_env() {
        let var_name = "COMET_CLIENT_TEST_OPENAI_KEY";
        // SAFETY: unit test process controls this temporary env mutation.
        unsafe { std::env::set_var(var_name, "test-secret") };

        let headers = super::bearer_env_headers(var_name).expect("headers");

        assert_eq!(
            headers
                .get(AUTHORIZATION)
                .and_then(|value| value.to_str().ok()),
            Some("Bearer test-secret")
        );
        assert_eq!(
            headers
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/json")
        );

        // SAFETY: unit test process controls this temporary env mutation.
        unsafe { std::env::remove_var(var_name) };
    }
}

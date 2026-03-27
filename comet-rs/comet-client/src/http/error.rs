#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransportError {
    EnvVarMissing { var_name: String },
    InvalidHeader { message: String },
    RequestFailed { message: String },
    Timeout { message: String },
    RetryExhausted { attempts: u32, last_error: String },
    ResponseBodyReadFailed { status: u16, message: String },
    HttpStatus { status: u16, body: String },
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    #[test]
    fn transport_error_equality_is_stable_for_status_failures() {
        assert_eq!(
            super::TransportError::HttpStatus {
                status: 429,
                body: "{\"error\":{\"message\":\"rate limit\"}}".to_string(),
            },
            super::TransportError::HttpStatus {
                status: 429,
                body: "{\"error\":{\"message\":\"rate limit\"}}".to_string(),
            }
        );
    }
}

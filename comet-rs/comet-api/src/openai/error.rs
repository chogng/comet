pub fn auth_env_missing(var_name: &str) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_auth_error".to_string(),
        message: format!("missing OpenAI API key in env var {var_name}"),
        retryable: false,
    }
}

pub fn map_unsupported_provider(kind: protocol::ProviderKind) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_invalid_request".to_string(),
        message: format!("OpenAI adapter cannot handle provider kind {:?}", kind),
        retryable: false,
    }
}

pub fn auth_header_invalid(error: impl std::fmt::Display) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_auth_error".to_string(),
        message: format!("invalid OpenAI API key header: {error}"),
        retryable: false,
    }
}

pub fn request_failed(error: impl std::fmt::Display) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_unavailable".to_string(),
        message: format!("failed to call OpenAI Responses API: {error}"),
        retryable: true,
    }
}

pub fn error_body_decode_failed(error: impl std::fmt::Display) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_invalid_response".to_string(),
        message: format!("failed to decode OpenAI error JSON: {error}"),
        retryable: true,
    }
}

pub fn non_success_status(status: u16, message: String) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: map_status_code(status).to_string(),
        message,
        retryable: (500..=599).contains(&status) || status == 429,
    }
}

pub fn sse_read_failed(error: impl std::fmt::Display) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_stream_failed".to_string(),
        message: format!("failed reading SSE stream: {error}"),
        retryable: true,
    }
}

pub fn sse_json_failed(error: impl std::fmt::Display) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_stream_failed".to_string(),
        message: format!("failed parsing SSE event JSON: {error}"),
        retryable: true,
    }
}

pub fn sse_event_error(message: String) -> protocol::ProviderError {
    protocol::RuntimeError {
        code: "provider_stream_failed".to_string(),
        message,
        retryable: false,
    }
}

fn map_status_code(status: u16) -> &'static str {
    match status {
        400 => "provider_invalid_request",
        401 | 403 => "provider_auth_error",
        429 => "provider_rate_limited",
        500..=599 => "provider_unavailable",
        _ => "provider_unavailable",
    }
}

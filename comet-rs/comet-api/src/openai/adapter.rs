use super::error::auth_env_missing;
use super::error::auth_header_invalid;
use super::error::error_body_decode_failed;
use super::error::map_unsupported_provider;
use super::error::non_success_status;
use super::error::request_failed;
use super::request_builder::OpenAiResponseCreateRequest;
use super::request_builder::OpenAiTurnRequestBuilder;
use super::response_stream::OpenAiResponse;
use super::response_stream::normalize_response;
use super::sse::collect_response_from_sse;
use reqwest::blocking::Client;
use reqwest::header::AUTHORIZATION;
use reqwest::header::CONTENT_TYPE;
use reqwest::header::HeaderMap;
use reqwest::header::HeaderValue;

#[derive(Debug, Clone)]
pub struct OpenAiAdapterConfig {
    pub model_mapping: comet_config::OpenAiModelMapping,
    pub api_base: String,
    pub api_key_env: String,
}

impl From<comet_config::AppConfig> for OpenAiAdapterConfig {
    fn from(config: comet_config::AppConfig) -> Self {
        let provider = config.openai_provider_profile(Some("default"));
        Self {
            model_mapping: config.openai_model_mapping(),
            api_base: provider.api_base,
            api_key_env: provider.api_key_env,
        }
    }
}

impl Default for OpenAiAdapterConfig {
    fn default() -> Self {
        comet_config::AppConfig::default().into()
    }
}

#[derive(Debug, Clone)]
pub struct OpenAiAdapter {
    config: OpenAiAdapterConfig,
}

impl OpenAiAdapter {
    pub fn new(config: OpenAiAdapterConfig) -> Self {
        Self { config }
    }

    fn build_request(
        &self,
        request: &protocol::ProviderTurnRequest,
    ) -> Result<OpenAiResponseCreateRequest, protocol::ProviderError> {
        if request.session.provider.kind != protocol::ProviderKind::OpenAi {
            return Err(map_unsupported_provider(request.session.provider.kind));
        }

        OpenAiTurnRequestBuilder::new(&self.config.model_mapping).build(request)
    }

    fn invoke_responses_api(
        &self,
        built_request: &OpenAiResponseCreateRequest,
    ) -> Result<OpenAiResponse, protocol::ProviderError> {
        let api_key = std::env::var(&self.config.api_key_env)
            .map_err(|_| auth_env_missing(&self.config.api_key_env))?;

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(auth_header_invalid)?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let response = Client::new()
            .post(format!(
                "{}/responses",
                self.config.api_base.trim_end_matches('/')
            ))
            .headers(headers)
            .json(built_request)
            .send()
            .map_err(request_failed)?;

        let status = response.status();
        if !status.is_success() {
            let body: serde_json::Value = response.json().map_err(error_body_decode_failed)?;
            let message = body
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("OpenAI request failed");
            return Err(non_success_status(status.as_u16(), message.to_string()));
        }

        collect_response_from_sse(response)
    }
}

impl Default for OpenAiAdapter {
    fn default() -> Self {
        Self::new(OpenAiAdapterConfig::default())
    }
}

impl comet_core::ProviderRuntime for OpenAiAdapter {
    fn call_turn(
        &self,
        request: &protocol::ProviderTurnRequest,
        sink: &mut dyn comet_core::ProviderEventSink,
    ) -> Result<(), protocol::ProviderError> {
        let built_request = self.build_request(request)?;
        let response = self.invoke_responses_api(&built_request)?;
        for event in normalize_response(&response, request)? {
            sink.push(event)?;
        }
        Ok(())
    }
}

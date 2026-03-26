#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiFunctionCallItem {
    pub id: String,
    pub call_id: String,
    pub name: String,
    pub arguments: String,
}

pub fn response_item_to_tool_call(
    item: &OpenAiFunctionCallItem,
    request: &protocol::ProviderTurnRequest,
) -> Result<protocol::ToolRequest, protocol::ProviderError> {
    let input = serde_json::from_str(&item.arguments).map_err(|error| protocol::RuntimeError {
        code: "provider_invalid_request".to_string(),
        message: format!(
            "failed to parse tool arguments for `{}`: {error}",
            item.name
        ),
        retryable: false,
    })?;

    let requires_approval = request
        .tool_permissions
        .approval_required_tools
        .iter()
        .any(|tool| tool == &item.name);

    Ok(protocol::ToolRequest {
        tool_call_id: item.call_id.clone(),
        tool_name: item.name.clone(),
        input,
        source: protocol::ToolCallSource::Model,
        risk: protocol::RiskLevel::High,
        requires_approval,
        model_call_id: Some(item.id.clone()),
        tool_index: Some(0),
        timeout_ms: Some(30_000),
        is_streaming: false,
        is_last_message: false,
        raw_args: Some(item.arguments.clone()),
    })
}

pub fn tool_response_to_function_output(
    response: &protocol::ToolResponse,
) -> super::request_builder::OpenAiResponseInputItem {
    super::request_builder::OpenAiResponseInputItem::FunctionCallOutput(
        super::request_builder::OpenAiFunctionCallOutputItem {
            item_type: "function_call_output",
            call_id: response.tool_call_id.clone(),
            output: response.output.to_string(),
        },
    )
}

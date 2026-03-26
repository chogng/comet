use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiResponseOutputText {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiResponseMessage {
    pub id: String,
    pub content: Vec<OpenAiResponseOutputText>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiReasoningItem {
    pub id: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenAiResponseOutputItem {
    Message(OpenAiResponseMessage),
    FunctionCall(super::tool_mapping::OpenAiFunctionCallItem),
    Reasoning(OpenAiReasoningItem),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenAiResponse {
    pub id: String,
    pub output: Vec<OpenAiResponseOutputItem>,
}

impl OpenAiResponse {
    pub fn from_api_value(value: Value) -> Result<Self, protocol::ProviderError> {
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| protocol::RuntimeError {
                code: "provider_invalid_response".to_string(),
                message: "OpenAI response is missing `id`".to_string(),
                retryable: true,
            })?
            .to_string();

        let output = value
            .get("output")
            .and_then(Value::as_array)
            .ok_or_else(|| protocol::RuntimeError {
                code: "provider_invalid_response".to_string(),
                message: "OpenAI response is missing `output`".to_string(),
                retryable: true,
            })?
            .iter()
            .filter_map(parse_output_item)
            .collect();

        Ok(Self { id, output })
    }
}

pub fn normalize_response(
    response: &OpenAiResponse,
    request: &protocol::ProviderTurnRequest,
) -> Result<Vec<protocol::ProviderStreamEvent>, protocol::ProviderError> {
    let mut events = vec![protocol::ProviderStreamEvent::Status {
        turn_id: request.turn.turn_id.clone(),
        status: protocol::StatusUpdate {
            phase: "provider_response_received".to_string(),
            message: format!("Received OpenAI response {}", response.id),
        },
    }];

    for item in &response.output {
        match item {
            OpenAiResponseOutputItem::Reasoning(reasoning) => {
                events.push(protocol::ProviderStreamEvent::ThinkingDelta {
                    turn_id: request.turn.turn_id.clone(),
                    text: reasoning.summary.clone(),
                    is_last_chunk: true,
                });
            }
            OpenAiResponseOutputItem::FunctionCall(function_call) => {
                events.push(protocol::ProviderStreamEvent::ToolCallRequested {
                    request: super::tool_mapping::response_item_to_tool_call(
                        function_call,
                        request,
                    )?,
                });
            }
            OpenAiResponseOutputItem::Message(message) => {
                let text = message
                    .content
                    .iter()
                    .map(|item| item.text.as_str())
                    .collect::<Vec<_>>()
                    .join("");
                if !text.is_empty() {
                    events.push(protocol::ProviderStreamEvent::TextDelta {
                        turn_id: request.turn.turn_id.clone(),
                        text: text.clone(),
                        chunk_id: Some(format!("chunk_{}_0", request.turn.turn_id)),
                    });
                }
                events.push(protocol::ProviderStreamEvent::MessageCompleted {
                    turn_id: request.turn.turn_id.clone(),
                    message_id: message.id.clone(),
                    text,
                });
            }
        }
    }

    events.push(protocol::ProviderStreamEvent::Completed);
    Ok(events)
}

fn parse_output_item(item: &Value) -> Option<OpenAiResponseOutputItem> {
    match item.get("type").and_then(Value::as_str) {
        Some("message") => parse_message(item).map(OpenAiResponseOutputItem::Message),
        Some("function_call") => {
            parse_function_call(item).map(OpenAiResponseOutputItem::FunctionCall)
        }
        Some("reasoning") => parse_reasoning(item).map(OpenAiResponseOutputItem::Reasoning),
        _ => None,
    }
}

fn parse_message(item: &Value) -> Option<OpenAiResponseMessage> {
    let id = item.get("id")?.as_str()?.to_string();
    let content = item
        .get("content")?
        .as_array()?
        .iter()
        .filter_map(|part| {
            let item_type = part.get("type").and_then(Value::as_str)?;
            if item_type != "output_text" {
                return None;
            }
            Some(OpenAiResponseOutputText {
                text: part.get("text")?.as_str()?.to_string(),
            })
        })
        .collect();

    Some(OpenAiResponseMessage { id, content })
}

fn parse_function_call(item: &Value) -> Option<super::tool_mapping::OpenAiFunctionCallItem> {
    Some(super::tool_mapping::OpenAiFunctionCallItem {
        id: item.get("id")?.as_str()?.to_string(),
        call_id: item.get("call_id")?.as_str()?.to_string(),
        name: item.get("name")?.as_str()?.to_string(),
        arguments: item.get("arguments")?.as_str()?.to_string(),
    })
}

fn parse_reasoning(item: &Value) -> Option<OpenAiReasoningItem> {
    let summary = item
        .get("summary")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "Model reasoning available".to_string());

    Some(OpenAiReasoningItem {
        id: item
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("reasoning")
            .to_string(),
        summary,
    })
}

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenAiMessageRole {
    System,
    User,
    Assistant,
}

impl OpenAiMessageRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OpenAiInputContentItem {
    InputText { text: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenAiInputMessage {
    #[serde(rename = "type")]
    pub item_type: &'static str,
    pub role: OpenAiMessageRole,
    pub content: Vec<OpenAiInputContentItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenAiFunctionCallOutputItem {
    #[serde(rename = "type")]
    pub item_type: &'static str,
    pub call_id: String,
    pub output: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum OpenAiResponseInputItem {
    Message(OpenAiInputMessage),
    FunctionCallOutput(OpenAiFunctionCallOutputItem),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpenAiFunctionTool {
    #[serde(rename = "type")]
    pub tool_type: &'static str,
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
    pub strict: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpenAiResponseCreateRequest {
    pub model: String,
    pub input: Vec<OpenAiResponseInputItem>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tools: Vec<OpenAiFunctionTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_response_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub store: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,
    #[serde(skip)]
    pub turn_id: String,
    #[serde(skip)]
    pub call_id: String,
}

pub struct OpenAiTurnRequestBuilder<'a> {
    model_mapping: &'a comet_config::OpenAiModelMapping,
}

impl<'a> OpenAiTurnRequestBuilder<'a> {
    pub fn new(model_mapping: &'a comet_config::OpenAiModelMapping) -> Self {
        Self { model_mapping }
    }

    pub fn build(
        &self,
        request: &protocol::ProviderTurnRequest,
    ) -> Result<OpenAiResponseCreateRequest, protocol::ProviderError> {
        let user_text = request.turn.user_text.trim();
        if user_text.is_empty() {
            return Err(protocol::RuntimeError {
                code: "provider_invalid_request".to_string(),
                message: "provider turn request is missing user text".to_string(),
                retryable: false,
            });
        }

        let mut input = Vec::new();
        for instruction in &request.context.explicit_instructions {
            input.push(OpenAiResponseInputItem::Message(OpenAiInputMessage {
                item_type: "message",
                role: OpenAiMessageRole::System,
                content: vec![OpenAiInputContentItem::InputText {
                    text: instruction.clone(),
                }],
            }));
        }

        if let Some(summary) = &request.conversation_summary {
            input.push(OpenAiResponseInputItem::Message(OpenAiInputMessage {
                item_type: "message",
                role: OpenAiMessageRole::System,
                content: vec![OpenAiInputContentItem::InputText {
                    text: format!("Conversation summary:\n{}", summary.text),
                }],
            }));
        }

        for item in &request.conversation {
            input.push(map_conversation_item(item));
        }

        input.push(OpenAiResponseInputItem::Message(OpenAiInputMessage {
            item_type: "message",
            role: OpenAiMessageRole::User,
            content: vec![OpenAiInputContentItem::InputText {
                text: user_text.to_string(),
            }],
        }));

        let tools = request
            .tool_permissions
            .supported_tools
            .iter()
            .map(|tool_name| OpenAiFunctionTool {
                tool_type: "function",
                name: tool_name.clone(),
                description: format!("Invoke the Comet `{tool_name}` tool."),
                parameters: serde_json::json!({
                    "type": "object",
                    "additionalProperties": true
                }),
                strict: false,
            })
            .collect();

        Ok(OpenAiResponseCreateRequest {
            model: self
                .model_mapping
                .resolve(&request.session.model)
                .to_string(),
            turn_id: request.turn.turn_id.clone(),
            call_id: format!("openai_call_{}", request.turn.turn_id),
            input,
            tools,
            tool_choice: Some("auto".to_string()),
            previous_response_id: None,
            store: Some(false),
            stream: Some(true),
        })
    }
}

fn map_conversation_item(item: &protocol::ConversationItem) -> OpenAiResponseInputItem {
    match item {
        protocol::ConversationItem::User { text, .. } => {
            OpenAiResponseInputItem::Message(OpenAiInputMessage {
                item_type: "message",
                role: OpenAiMessageRole::User,
                content: vec![OpenAiInputContentItem::InputText { text: text.clone() }],
            })
        }
        protocol::ConversationItem::Assistant { text, .. } => {
            OpenAiResponseInputItem::Message(OpenAiInputMessage {
                item_type: "message",
                role: OpenAiMessageRole::Assistant,
                content: vec![OpenAiInputContentItem::InputText { text: text.clone() }],
            })
        }
        protocol::ConversationItem::Thinking { text, .. } => {
            OpenAiResponseInputItem::Message(OpenAiInputMessage {
                item_type: "message",
                role: OpenAiMessageRole::Assistant,
                content: vec![OpenAiInputContentItem::InputText {
                    text: format!("[thinking]\n{text}"),
                }],
            })
        }
        protocol::ConversationItem::ToolResult {
            tool_call_id,
            output,
            ..
        } => OpenAiResponseInputItem::FunctionCallOutput(OpenAiFunctionCallOutputItem {
            item_type: "function_call_output",
            call_id: tool_call_id.clone(),
            output: output.to_string(),
        }),
    }
}

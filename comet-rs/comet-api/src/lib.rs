mod openai;
mod stub;

pub use comet_config::OpenAiModelMapping;
pub use openai::OpenAiAdapter;
pub use openai::OpenAiAdapterConfig;
pub use openai::OpenAiFunctionCallItem;
pub use openai::OpenAiFunctionCallOutputItem;
pub use openai::OpenAiResponse;
pub use openai::OpenAiResponseCreateRequest;
pub use openai::OpenAiResponseInputItem;
pub use openai::OpenAiResponseMessage;
pub use openai::OpenAiResponseOutputItem;
pub use openai::OpenAiResponseOutputText;
pub use openai::OpenAiTurnRequestBuilder;
pub use openai::normalize_response;
pub use openai::tool_response_to_function_output;
pub use stub::StubProviderAdapter;

#[cfg(test)]
mod tests {
    use crate::OpenAiFunctionCallItem;
    use crate::OpenAiFunctionCallOutputItem;
    use crate::OpenAiModelMapping;
    use crate::OpenAiResponse;
    use crate::OpenAiResponseInputItem;
    use crate::OpenAiResponseMessage;
    use crate::OpenAiResponseOutputItem;
    use crate::OpenAiResponseOutputText;
    use crate::OpenAiTurnRequestBuilder;
    use crate::StubProviderAdapter;
    use crate::normalize_response;
    use crate::tool_response_to_function_output;
    use comet_core::ProviderRuntime;
    use pretty_assertions::assert_eq;
    use protocol::ApprovalMode;
    use protocol::PlanningContext;
    use protocol::ProviderKind;
    use protocol::ProviderRef;
    use protocol::ProviderTurnRequest;
    use protocol::SandboxMode;
    use protocol::SessionDescriptor;
    use protocol::SessionMode;
    use protocol::ThreadDescriptor;
    use protocol::ToolPermissionContext;
    use protocol::TurnDescriptor;
    use serde_json::json;

    #[derive(Default)]
    struct TestProviderSink {
        events: Vec<protocol::ProviderStreamEvent>,
    }

    impl comet_core::ProviderEventSink for TestProviderSink {
        fn push(
            &mut self,
            event: protocol::ProviderStreamEvent,
        ) -> Result<(), protocol::ProviderError> {
            self.events.push(event);
            Ok(())
        }
    }

    #[test]
    fn stub_provider_adapter_returns_basic_stream() {
        let adapter = StubProviderAdapter;
        let mut sink = TestProviderSink::default();
        adapter
            .call_turn(
                &ProviderTurnRequest {
                    thread: ThreadDescriptor {
                        thread_id: "thread_1".to_string(),
                    },
                    session: SessionDescriptor {
                        session_id: "session_1".to_string(),
                        cwd: "/tmp/project".to_string(),
                        mode: SessionMode::Agent,
                        model: "gpt-5.4".to_string(),
                        provider: ProviderRef {
                            kind: ProviderKind::OpenAi,
                            profile: Some("default".to_string()),
                        },
                        sandbox_mode: SandboxMode::WorkspaceWrite,
                        approval_mode: ApprovalMode::OnRequest,
                    },
                    turn: TurnDescriptor {
                        turn_id: "turn_1".to_string(),
                        user_text: "fix tests".to_string(),
                        attachments: Vec::new(),
                        reply_to_turn_id: None,
                        is_resume: false,
                        is_background: false,
                    },
                    conversation: Vec::new(),
                    conversation_summary: None,
                    context: protocol::ContextPackage::default(),
                    tool_permissions: ToolPermissionContext::default(),
                    planning: PlanningContext::default(),
                },
                &mut sink,
            )
            .expect("stub provider succeeds");

        assert_eq!(sink.events.len(), 4);
        assert_eq!(
            sink.events[1],
            protocol::ProviderStreamEvent::TextDelta {
                turn_id: "turn_1".to_string(),
                text: "Working through: fix tests".to_string(),
                chunk_id: Some("chunk_turn_1_0".to_string()),
            }
        );
    }

    #[test]
    fn openai_request_builder_uses_responses_api_shape() {
        let built = OpenAiTurnRequestBuilder::new(&OpenAiModelMapping::default())
            .build(&ProviderTurnRequest {
                thread: ThreadDescriptor {
                    thread_id: "thread_1".to_string(),
                },
                session: SessionDescriptor {
                    session_id: "session_1".to_string(),
                    cwd: "/tmp/project".to_string(),
                    mode: SessionMode::Agent,
                    model: "reasoning_default".to_string(),
                    provider: ProviderRef {
                        kind: ProviderKind::OpenAi,
                        profile: Some("default".to_string()),
                    },
                    sandbox_mode: SandboxMode::WorkspaceWrite,
                    approval_mode: ApprovalMode::OnRequest,
                },
                turn: TurnDescriptor {
                    turn_id: "turn_1".to_string(),
                    user_text: "fix tests".to_string(),
                    attachments: Vec::new(),
                    reply_to_turn_id: None,
                    is_resume: false,
                    is_background: false,
                },
                conversation: vec![protocol::ConversationItem::Assistant {
                    message_id: "msg_prev".to_string(),
                    text: "previous answer".to_string(),
                }],
                conversation_summary: None,
                context: protocol::ContextPackage {
                    explicit_instructions: vec!["stay concise".to_string()],
                    ..protocol::ContextPackage::default()
                },
                tool_permissions: ToolPermissionContext {
                    supported_tools: vec!["shell".to_string(), "read_file".to_string()],
                    approval_required_tools: vec!["shell".to_string()],
                    disable_tools: false,
                    mcp_tools: Vec::new(),
                },
                planning: PlanningContext::default(),
            })
            .expect("request build succeeds");

        assert_eq!(built.model, "gpt-5.4");
        assert_eq!(built.tool_choice, Some("auto".to_string()));
        assert_eq!(built.tools.len(), 2);
        assert!(matches!(
            &built.input[0],
            OpenAiResponseInputItem::Message(_)
        ));
        let serialized = serde_json::to_value(&built).expect("serialize responses request");
        assert_eq!(serialized["model"], "gpt-5.4");
        assert_eq!(serialized["input"][0]["type"], "message");
        assert_eq!(serialized["input"][0]["role"], "system");
        assert_eq!(serialized["tools"][0]["type"], "function");
        assert_eq!(serialized["tool_choice"], "auto");
        assert_eq!(serialized["store"], false);
        assert_eq!(serialized["stream"], true);
    }

    #[test]
    fn openai_response_normalizer_maps_message_and_tool_items() {
        let request = ProviderTurnRequest {
            thread: ThreadDescriptor {
                thread_id: "thread_1".to_string(),
            },
            session: SessionDescriptor {
                session_id: "session_1".to_string(),
                cwd: "/tmp/project".to_string(),
                mode: SessionMode::Agent,
                model: "gpt-5.4".to_string(),
                provider: ProviderRef {
                    kind: ProviderKind::OpenAi,
                    profile: Some("default".to_string()),
                },
                sandbox_mode: SandboxMode::WorkspaceWrite,
                approval_mode: ApprovalMode::OnRequest,
            },
            turn: TurnDescriptor {
                turn_id: "turn_1".to_string(),
                user_text: "inspect repo".to_string(),
                attachments: Vec::new(),
                reply_to_turn_id: None,
                is_resume: false,
                is_background: false,
            },
            conversation: Vec::new(),
            conversation_summary: None,
            context: protocol::ContextPackage::default(),
            tool_permissions: ToolPermissionContext {
                supported_tools: vec!["shell".to_string()],
                approval_required_tools: vec!["shell".to_string()],
                disable_tools: false,
                mcp_tools: Vec::new(),
            },
            planning: PlanningContext::default(),
        };

        let response = OpenAiResponse {
            id: "resp_1".to_string(),
            output: vec![
                OpenAiResponseOutputItem::FunctionCall(OpenAiFunctionCallItem {
                    id: "fc_1".to_string(),
                    call_id: "tool_call_1".to_string(),
                    name: "shell".to_string(),
                    arguments: "{\"command\":\"pwd\"}".to_string(),
                }),
                OpenAiResponseOutputItem::Message(OpenAiResponseMessage {
                    id: "msg_1".to_string(),
                    content: vec![OpenAiResponseOutputText {
                        text: "done".to_string(),
                    }],
                }),
            ],
        };

        let events = normalize_response(&response, &request).unwrap();

        assert_eq!(events.len(), 5);
        assert_eq!(
            events[1],
            protocol::ProviderStreamEvent::ToolCallRequested {
                request: protocol::ToolRequest {
                    tool_call_id: "tool_call_1".to_string(),
                    tool_name: "shell".to_string(),
                    input: json!({ "command": "pwd" }),
                    source: protocol::ToolCallSource::Model,
                    risk: protocol::RiskLevel::High,
                    requires_approval: true,
                    model_call_id: Some("fc_1".to_string()),
                    tool_index: Some(0),
                    timeout_ms: Some(30_000),
                    is_streaming: false,
                    is_last_message: false,
                    raw_args: Some("{\"command\":\"pwd\"}".to_string()),
                },
            }
        );
    }

    #[test]
    fn openai_response_parses_from_api_json() {
        let response = OpenAiResponse::from_api_value(json!({
            "id": "resp_123",
            "output": [
                {
                    "type": "reasoning",
                    "id": "rs_1",
                    "summary": [{ "text": "check repo state" }]
                },
                {
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "shell",
                    "arguments": "{\"command\":\"pwd\"}"
                },
                {
                    "type": "message",
                    "id": "msg_1",
                    "content": [
                        { "type": "output_text", "text": "done" }
                    ]
                }
            ]
        }))
        .expect("parse OpenAI response");

        assert_eq!(response.id, "resp_123");
        assert_eq!(response.output.len(), 3);
    }

    #[test]
    fn tool_response_maps_back_to_function_call_output_item() {
        let item = tool_response_to_function_output(&protocol::ToolResponse {
            tool_call_id: "tool_call_1".to_string(),
            tool_name: "shell".to_string(),
            output: json!({ "stdout": "ok" }),
            metadata: protocol::ToolResultMetadata::default(),
            model_call_id: Some("fc_1".to_string()),
            tool_index: Some(0),
            attachments: Vec::new(),
        });

        assert_eq!(
            item,
            OpenAiResponseInputItem::FunctionCallOutput(OpenAiFunctionCallOutputItem {
                item_type: "function_call_output",
                call_id: "tool_call_1".to_string(),
                output: "{\"stdout\":\"ok\"}".to_string(),
            })
        );
    }
}

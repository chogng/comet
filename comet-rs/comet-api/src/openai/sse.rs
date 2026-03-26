use reqwest::blocking::Response;
use std::io::BufRead;
use std::io::BufReader;

pub fn collect_response_from_sse(
    response: Response,
) -> Result<super::response_stream::OpenAiResponse, protocol::ProviderError> {
    parse_sse_reader(response)
}

fn parse_sse_reader<R: std::io::Read>(
    reader: R,
) -> Result<super::response_stream::OpenAiResponse, protocol::ProviderError> {
    let mut response_id: Option<String> = None;
    let mut reasoning_chunks: Vec<String> = Vec::new();
    let mut message_text = String::new();
    let mut message_id: Option<String> = None;
    let mut function_call: Option<super::tool_mapping::OpenAiFunctionCallItem> = None;
    let mut function_arguments_started = false;

    let reader = BufReader::new(reader);
    for line in reader.lines() {
        let line = line.map_err(super::error::sse_read_failed)?;

        if !line.starts_with("data: ") {
            continue;
        }

        let data = &line[6..];
        if data == "[DONE]" {
            break;
        }

        let event: serde_json::Value =
            serde_json::from_str(data).map_err(super::error::sse_json_failed)?;

        let event_type = event.get("type").and_then(serde_json::Value::as_str);
        match event_type {
            Some("error") => {
                let message = event
                    .get("error")
                    .and_then(|value| value.get("message"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("provider streaming error")
                    .to_string();
                return Err(super::error::sse_event_error(message));
            }
            Some("response.created") => {
                if let Some(id) = event
                    .get("response")
                    .and_then(|response| response.get("id"))
                    .and_then(serde_json::Value::as_str)
                {
                    response_id = Some(id.to_string());
                }
            }
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(serde_json::Value::as_str) {
                    message_text.push_str(delta);
                }
            }
            Some("response.output_item.added") => {
                let Some(item) = event.get("item") else {
                    continue;
                };
                let item_type = item.get("type").and_then(serde_json::Value::as_str);
                match item_type {
                    Some("message") => {
                        if let Some(id) = item.get("id").and_then(serde_json::Value::as_str) {
                            message_id = Some(id.to_string());
                        }
                    }
                    Some("function_call") => {
                        function_call = Some(super::tool_mapping::OpenAiFunctionCallItem {
                            id: item
                                .get("id")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or("function_call")
                                .to_string(),
                            call_id: item
                                .get("call_id")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or("call")
                                .to_string(),
                            name: item
                                .get("name")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or("tool")
                                .to_string(),
                            arguments: item
                                .get("arguments")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or("{}")
                                .to_string(),
                        });
                        function_arguments_started = false;
                    }
                    Some("reasoning") => {
                        if let Some(summary) =
                            item.get("summary").and_then(serde_json::Value::as_array)
                        {
                            for part in summary {
                                if let Some(text) =
                                    part.get("text").and_then(serde_json::Value::as_str)
                                {
                                    reasoning_chunks.push(text.to_string());
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
            Some("response.output_item.done") => {
                // Item-level completion marker, no extra state needed in this aggregator.
            }
            Some("response.function_call_arguments.delta") => {
                if let Some(delta) = event.get("delta").and_then(serde_json::Value::as_str) {
                    if let Some(function_call) = function_call.as_mut() {
                        if !function_arguments_started {
                            function_call.arguments.clear();
                            function_arguments_started = true;
                        }
                        function_call.arguments.push_str(delta);
                    }
                }
            }
            Some("response.function_call_arguments.done") => {
                if let Some(arguments) = event.get("arguments").and_then(serde_json::Value::as_str)
                {
                    if let Some(function_call) = function_call.as_mut() {
                        function_call.arguments = arguments.to_string();
                        function_arguments_started = true;
                    }
                }
            }
            Some("response.reasoning_summary_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(serde_json::Value::as_str) {
                    reasoning_chunks.push(delta.to_string());
                }
            }
            Some("response.completed") => {
                if response_id.is_none() {
                    response_id = event
                        .get("response")
                        .and_then(|response| response.get("id"))
                        .and_then(serde_json::Value::as_str)
                        .map(ToString::to_string);
                }
            }
            _ => {}
        }
    }

    let mut output = Vec::new();
    if !reasoning_chunks.is_empty() {
        output.push(super::response_stream::OpenAiResponseOutputItem::Reasoning(
            super::response_stream::OpenAiReasoningItem {
                id: "reasoning".to_string(),
                summary: reasoning_chunks.join(""),
            },
        ));
    }
    if let Some(function_call) = function_call {
        output.push(super::response_stream::OpenAiResponseOutputItem::FunctionCall(function_call));
    }
    if !message_text.is_empty() || message_id.is_some() {
        output.push(super::response_stream::OpenAiResponseOutputItem::Message(
            super::response_stream::OpenAiResponseMessage {
                id: message_id.unwrap_or_else(|| "message".to_string()),
                content: vec![super::response_stream::OpenAiResponseOutputText {
                    text: message_text,
                }],
            },
        ));
    }

    Ok(super::response_stream::OpenAiResponse {
        id: response_id.unwrap_or_else(|| "response".to_string()),
        output,
    })
}

#[cfg(test)]
mod tests {
    use super::super::response_stream::OpenAiResponseOutputItem;
    use pretty_assertions::assert_eq;

    #[test]
    fn parses_sse_style_events_into_response_shape() {
        let raw = concat!(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\"}}\n",
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"reasoning\",\"summary\":[{\"text\":\"plan\"}]}}\n",
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"shell\",\"arguments\":\"{\\\"command\\\":\\\"pwd\\\"}\"}}\n",
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"message\",\"id\":\"msg_1\"}}\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"done\"}\n",
            "data: [DONE]\n",
        );

        let response = super::parse_sse_reader(raw.as_bytes()).expect("parse sse");

        assert_eq!(response.id, "resp_1");
        assert_eq!(response.output.len(), 3);
        assert!(matches!(
            response.output[0],
            OpenAiResponseOutputItem::Reasoning(_)
        ));
    }

    #[test]
    fn function_call_arguments_done_overrides_collected_deltas() {
        let raw = concat!(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_2\"}}\n",
            "data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"shell\",\"arguments\":\"{}\"}}\n",
            "data: {\"type\":\"response.function_call_arguments.delta\",\"delta\":\"{\\\"command\\\":\\\"pw\"}\n",
            "data: {\"type\":\"response.function_call_arguments.done\",\"arguments\":\"{\\\"command\\\":\\\"pwd\\\"}\"}\n",
            "data: [DONE]\n",
        );

        let response = super::parse_sse_reader(raw.as_bytes()).expect("parse sse");
        match &response.output[0] {
            OpenAiResponseOutputItem::FunctionCall(call) => {
                assert_eq!(call.arguments, "{\"command\":\"pwd\"}");
            }
            _ => panic!("expected function call"),
        }
    }

    #[test]
    fn sse_error_event_returns_provider_error() {
        let raw = concat!(
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_3\"}}\n",
            "data: {\"type\":\"error\",\"error\":{\"message\":\"rate limit\"}}\n",
        );

        let error = super::parse_sse_reader(raw.as_bytes()).expect_err("expected parse failure");
        assert_eq!(error.code, "provider_stream_failed");
        assert_eq!(error.message, "rate limit");
        assert_eq!(error.retryable, false);
    }
}

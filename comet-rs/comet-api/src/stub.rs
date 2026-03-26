pub struct StubProviderAdapter;

impl comet_core::ProviderRuntime for StubProviderAdapter {
    fn call_turn(
        &self,
        request: &protocol::ProviderTurnRequest,
        sink: &mut dyn comet_core::ProviderEventSink,
    ) -> Result<(), protocol::ProviderError> {
        let turn_id = request.turn.turn_id.clone();
        let prefix = if request
            .context
            .explicit_instructions
            .iter()
            .any(|instruction| instruction.contains("web"))
        {
            "Researching and drafting"
        } else {
            "Working through"
        };

        sink.push(protocol::ProviderStreamEvent::Status {
            turn_id: turn_id.clone(),
            status: protocol::StatusUpdate {
                phase: "stub_provider".to_string(),
                message: "Using stub provider adapter".to_string(),
            },
        })?;
        sink.push(protocol::ProviderStreamEvent::TextDelta {
            turn_id: turn_id.clone(),
            text: format!("{prefix}: {}", request.turn.user_text),
            chunk_id: Some(format!("chunk_{turn_id}_0")),
        })?;
        sink.push(protocol::ProviderStreamEvent::MessageCompleted {
            turn_id: turn_id.clone(),
            message_id: format!("msg_{turn_id}_assistant"),
            text: format!("Stub response for '{}'.", request.turn.user_text),
        })?;
        sink.push(protocol::ProviderStreamEvent::Completed)?;
        Ok(())
    }
}

use reqwest::blocking::Response;
use std::io::BufRead;
use std::io::BufReader;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
    pub id: Option<String>,
}

pub struct SseEventReader<R> {
    reader: R,
    line: String,
    data_lines: Vec<String>,
    event_name: Option<String>,
    event_id: Option<String>,
    finished: bool,
}

impl<R: BufRead> SseEventReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            line: String::new(),
            data_lines: Vec::new(),
            event_name: None,
            event_id: None,
            finished: false,
        }
    }

    fn next_event(&mut self) -> Result<Option<SseEvent>, std::io::Error> {
        if self.finished {
            return Ok(None);
        }

        loop {
            self.line.clear();
            let bytes_read = self.reader.read_line(&mut self.line)?;
            if bytes_read == 0 {
                self.finished = true;
                return Ok(self.take_event());
            }

            trim_line_endings(&mut self.line);
            if self.line.is_empty() {
                if let Some(event) = self.take_event() {
                    return Ok(Some(event));
                }
                continue;
            }

            if self.line.starts_with(':') {
                continue;
            }

            let (field, value) = split_sse_field(&self.line);
            match field {
                "data" => self.data_lines.push(value.to_string()),
                "event" => self.event_name = Some(value.to_string()),
                "id" => self.event_id = Some(value.to_string()),
                _ => {}
            }
        }
    }

    fn take_event(&mut self) -> Option<SseEvent> {
        if self.data_lines.is_empty() {
            self.event_name = None;
            self.event_id = None;
            return None;
        }

        let event = SseEvent {
            event: self.event_name.take(),
            data: self.data_lines.join("\n"),
            id: self.event_id.take(),
        };
        self.data_lines.clear();
        Some(event)
    }
}

impl<R: BufRead> Iterator for SseEventReader<R> {
    type Item = Result<SseEvent, std::io::Error>;

    fn next(&mut self) -> Option<Self::Item> {
        match self.next_event() {
            Ok(Some(event)) => Some(Ok(event)),
            Ok(None) => None,
            Err(error) => {
                self.finished = true;
                Some(Err(error))
            }
        }
    }
}

pub fn sse_event_reader<R: std::io::Read>(reader: R) -> SseEventReader<BufReader<R>> {
    SseEventReader::new(BufReader::new(reader))
}

pub fn read_sse_events_from_response(
    response: Response,
) -> Result<Vec<SseEvent>, std::io::Error> {
    read_sse_events(response)
}

pub fn read_sse_events<R: std::io::Read>(reader: R) -> Result<Vec<SseEvent>, std::io::Error> {
    sse_event_reader(reader).collect()
}

fn trim_line_endings(line: &mut String) {
    while matches!(line.chars().last(), Some('\n' | '\r')) {
        line.pop();
    }
}

fn split_sse_field(line: &str) -> (&str, &str) {
    let Some((field, value)) = line.split_once(':') else {
        return (line, "");
    };
    (field, value.strip_prefix(' ').unwrap_or(value))
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    #[test]
    fn parses_basic_sse_stream() {
        let raw = concat!(
            "event: message\n",
            "data: {\"type\":\"response.created\"}\n",
            "\n",
            "data: [DONE]\n",
            "\n",
        );

        let events = super::read_sse_events(raw.as_bytes()).expect("read sse");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event.as_deref(), Some("message"));
        assert_eq!(events[0].data, "{\"type\":\"response.created\"}");
        assert_eq!(events[1].data, "[DONE]");
    }

    #[test]
    fn joins_multiline_data_payloads() {
        let raw = concat!(
            "id: evt_1\n",
            "data: line one\n",
            "data: line two\n",
            "\n",
        );

        let events = super::read_sse_events(raw.as_bytes()).expect("read sse");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id.as_deref(), Some("evt_1"));
        assert_eq!(events[0].data, "line one\nline two");
    }

    #[test]
    fn ignores_comment_lines() {
        let raw = concat!(
            ": keep-alive\n",
            "event: message\n",
            "data: ok\n",
            "\n",
        );

        let events = super::read_sse_events(raw.as_bytes()).expect("read sse");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event.as_deref(), Some("message"));
        assert_eq!(events[0].data, "ok");
    }

    #[test]
    fn flushes_last_event_at_eof_without_blank_line() {
        let raw = concat!("id: evt_2\n", "data: final payload\n");

        let events = super::read_sse_events(raw.as_bytes()).expect("read sse");
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id.as_deref(), Some("evt_2"));
        assert_eq!(events[0].data, "final payload");
    }

    #[test]
    fn incremental_reader_yields_events_one_by_one() {
        let raw = concat!(
            "data: first\n",
            "\n",
            "data: second\n",
            "\n",
        );

        let mut reader = super::sse_event_reader(raw.as_bytes());
        let first = reader
            .next()
            .expect("first event")
            .expect("first event payload");
        let second = reader
            .next()
            .expect("second event")
            .expect("second event payload");
        let done = reader.next();

        assert_eq!(first.data, "first");
        assert_eq!(second.data, "second");
        assert!(done.is_none());
    }
}

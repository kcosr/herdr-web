use crossterm::event::{KeyCode, KeyModifiers};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowsKeyRecord {
    pub key_down: bool,
    pub repeat_count: u16,
    pub virtual_key_code: u16,
    pub virtual_scan_code: u16,
    pub unicode: u16,
    pub control_key_state: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextCommit {
    text: String,
}

impl TextCommit {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into() }
    }

    pub fn as_str(&self) -> &str {
        &self.text
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum KeySource {
    Synthesized,
    Vt { bytes: Vec<u8> },
    WindowsConsole { record: WindowsKeyRecord },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalKey {
    pub code: KeyCode,
    pub modifiers: KeyModifiers,
    pub kind: crossterm::event::KeyEventKind,
    pub repeat_count: u16,
    pub shifted_codepoint: Option<u32>,
    pub generated_text: Option<String>,
    source: KeySource,
}

impl TerminalKey {
    pub fn new(code: KeyCode, modifiers: KeyModifiers) -> Self {
        Self {
            code,
            modifiers,
            kind: crossterm::event::KeyEventKind::Press,
            repeat_count: 1,
            shifted_codepoint: None,
            generated_text: None,
            source: KeySource::Synthesized,
        }
    }

    pub fn with_kind(mut self, kind: crossterm::event::KeyEventKind) -> Self {
        if kind == crossterm::event::KeyEventKind::Release {
            self.repeat_count = 1;
            self.generated_text = None;
        }
        self.kind = kind;
        self
    }

    pub fn with_repeat_count(mut self, repeat_count: u16) -> Self {
        self.repeat_count = if self.kind == crossterm::event::KeyEventKind::Release {
            1
        } else {
            repeat_count.max(1)
        };
        self
    }

    pub(crate) fn with_generated_text(mut self, text: Option<String>) -> Self {
        self.generated_text = if self.kind == crossterm::event::KeyEventKind::Release {
            None
        } else {
            text
        };
        self
    }

    pub(crate) fn with_vt_bytes(mut self, bytes: Vec<u8>) -> Self {
        self.source = KeySource::Vt { bytes };
        self
    }

    pub fn with_windows_record(mut self, record: WindowsKeyRecord) -> Self {
        self.repeat_count = if self.kind == crossterm::event::KeyEventKind::Release {
            1
        } else {
            record.repeat_count.max(1)
        };
        self.source = KeySource::WindowsConsole { record };
        self
    }

    #[cfg(any(windows, test))]
    pub(crate) fn vt_bytes(&self) -> Option<&[u8]> {
        match &self.source {
            KeySource::Vt { bytes } => Some(bytes),
            KeySource::Synthesized | KeySource::WindowsConsole { .. } => None,
        }
    }

    #[cfg(any(windows, test))]
    pub(crate) fn windows_record(&self) -> Option<WindowsKeyRecord> {
        match self.source {
            KeySource::WindowsConsole { record } => Some(record),
            KeySource::Synthesized | KeySource::Vt { .. } => None,
        }
    }
}

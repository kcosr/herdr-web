//! Minimal input-model shims required by the vendored `protocol::wire` module.
//!
//! Upstream Herdr defines these types across `src/input/model.rs` and the raw
//! input parser/encoder. `herdr-web` only needs the small subset that the
//! terminal-attach wire protocol references (`TerminalKey`, `WindowsKeyRecord`,
//! `TextCommit`), so the full input tree is intentionally not vendored. The
//! grouping/clamping semantics below are copied faithfully from upstream so the
//! exact-compared `wire.rs` body and its tests behave identically.

use crossterm::event::{KeyCode, KeyModifiers};
use serde::{Deserialize, Serialize};

/// Raw Windows console key record forwarded by platform clients that expose the
/// native `KEY_EVENT_RECORD` fields instead of decoded VT bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowsKeyRecord {
    pub key_down: bool,
    pub repeat_count: u16,
    pub virtual_key_code: u16,
    pub virtual_scan_code: u16,
    pub unicode: u16,
    pub control_key_state: u32,
}

/// Committed text produced by an IME or platform text-input client, forwarded as
/// a single unit rather than as individual synthesized key presses.
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

/// Origin of a decoded [`TerminalKey`], preserved so native/VT records survive a
/// wire round-trip without being flattened into a synthesized key.
#[derive(Debug, Clone, PartialEq, Eq)]
enum KeySource {
    Synthesized,
    Vt { bytes: Vec<u8> },
    WindowsConsole { record: WindowsKeyRecord },
}

/// A decoded terminal key together with the grouping metadata the wire protocol
/// carries (repeat count, generated text, and originating source).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalKey {
    pub code: KeyCode,
    pub modifiers: KeyModifiers,
    pub kind: crossterm::event::KeyEventKind,
    pub repeat_count: u16,
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
            generated_text: None,
            source: KeySource::Synthesized,
        }
    }

    /// Sets the key kind. A `Release` cannot carry a grouped repeat count or
    /// generated text, so both are cleared to match upstream semantics.
    pub fn with_kind(mut self, kind: crossterm::event::KeyEventKind) -> Self {
        if kind == crossterm::event::KeyEventKind::Release {
            self.repeat_count = 1;
            self.generated_text = None;
        }
        self.kind = kind;
        self
    }

    /// Applies a grouped repeat count. Releases are never grouped; presses and
    /// repeats clamp to a minimum of one.
    pub fn with_repeat_count(mut self, repeat_count: u16) -> Self {
        self.repeat_count = if self.kind == crossterm::event::KeyEventKind::Release {
            1
        } else {
            repeat_count.max(1)
        };
        self
    }

    /// Attaches client-provided committed text. Cleared for release events.
    pub fn with_generated_text(mut self, text: Option<String>) -> Self {
        self.generated_text = if self.kind == crossterm::event::KeyEventKind::Release {
            None
        } else {
            text
        };
        self
    }

    /// Records the originating VT byte sequence for this key.
    pub fn with_vt_bytes(mut self, bytes: Vec<u8>) -> Self {
        self.source = KeySource::Vt { bytes };
        self
    }

    /// Records the originating Windows console record and applies its repeat
    /// count using the same release-aware clamping as [`Self::with_repeat_count`].
    pub fn with_windows_record(mut self, record: WindowsKeyRecord) -> Self {
        self.repeat_count = if self.kind == crossterm::event::KeyEventKind::Release {
            1
        } else {
            record.repeat_count.max(1)
        };
        self.source = KeySource::WindowsConsole { record };
        self
    }

    /// Returns the originating Windows console record, if any.
    pub fn windows_record(&self) -> Option<WindowsKeyRecord> {
        match self.source {
            KeySource::WindowsConsole { record } => Some(record),
            KeySource::Synthesized | KeySource::Vt { .. } => None,
        }
    }
}

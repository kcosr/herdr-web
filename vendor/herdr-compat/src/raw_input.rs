//! Minimal raw-input event shim required by the vendored `protocol::wire`
//! module. Upstream Herdr's `RawInputEvent` carries additional host-reporting
//! variants (color scheme, palette, cell-size) that the bridge never produces;
//! only the variants referenced by `wire.rs` are vendored here.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawInputEvent {
    Key(crate::input::TerminalKey),
    Text(crate::input::TextCommit),
    Mouse(crossterm::event::MouseEvent),
    Paste(String),
    OuterFocusGained,
    OuterFocusLost,
}

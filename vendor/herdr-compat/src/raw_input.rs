#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawInputEvent {
    Key(crate::input::TerminalKey),
    Text(crate::input::TextCommit),
    Mouse(crossterm::event::MouseEvent),
    Paste(String),
    OuterFocusGained,
    OuterFocusLost,
    HostDefaultColor {
        kind: crate::terminal_theme::DefaultColorKind,
        color: crate::terminal_theme::RgbColor,
    },
}

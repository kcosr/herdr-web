mod wire;

pub use wire::*;

#[cfg(test)]
mod bridge_fixture_tests {
    use super::*;

    #[test]
    fn protocol_version_matches_reviewed_herdr_snapshot() {
        assert_eq!(PROTOCOL_VERSION, 19);
    }

    #[test]
    fn client_hello_wire_fixture_matches_reviewed_snapshot() {
        let msg = ClientMessage::Hello {
            version: PROTOCOL_VERSION,
            cols: 80,
            rows: 24,
            cell_width_px: 8,
            cell_height_px: 16,
            requested_encoding: RenderEncoding::SemanticFrame,
            keybindings: ClientKeybindings::Server,
            launch_mode: ClientLaunchMode::TerminalAttach,
        };
        let mut frame = Vec::new();
        write_message(&mut frame, &msg).unwrap();

        assert_eq!(frame, vec![9, 0, 0, 0, 0, 19, 80, 24, 8, 16, 0, 0, 1]);
        let decoded: ClientMessage = read_message(&mut frame.as_slice(), MAX_FRAME_SIZE).unwrap();
        assert_eq!(decoded, msg);
    }

    #[test]
    fn server_welcome_wire_fixture_matches_reviewed_snapshot() {
        let msg = ServerMessage::Welcome {
            version: PROTOCOL_VERSION,
            encoding: RenderEncoding::TerminalAnsi,
            error: None,
        };
        let mut frame = Vec::new();
        write_message(&mut frame, &msg).unwrap();

        assert_eq!(frame, vec![4, 0, 0, 0, 0, 19, 1, 0]);
        let decoded: ServerMessage = read_message(&mut frame.as_slice(), MAX_FRAME_SIZE).unwrap();
        assert_eq!(decoded, msg);
    }
}

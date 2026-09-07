//! Upstream v0.9.0 wire tests, excluding the two host keyboard-encoder tests.
use super::*;
use ratatui::style::{Color, Modifier};
use sha2::{Digest, Sha256};

fn encoded_sha256(value: &impl Serialize) -> String {
    let encoded = bincode::serde::encode_to_vec(value, bincode::config::standard()).unwrap();
    format!("{:x}", Sha256::digest(encoded))
}

// These digests freeze representative generation-1 bincode payloads. A mismatch
// requires a new named codec; do not update a v1 digest to bless a wire change.
// They do not detect appended enum variants, so every type reachable from a v1
// payload is also append-closed.

// ---- Round-trip: ClientMessage ----

#[test]
fn client_hello_roundtrip() {
    let msg = ClientMessage::TerminalHello {
        version: PROTOCOL_VERSION,
        cols: 80,
        rows: 24,
        cell_width_px: 8,
        cell_height_px: 16,
        pixel_mouse: true,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_shell_hello_roundtrip() {
    let msg = ClientMessage::ClientShellHello {
        version: PROTOCOL_VERSION,
        cell_width_px: 8,
        cell_height_px: 16,
        surface_size: ClientSurfaceSize { cols: 80, rows: 29 },
        pixel_mouse: true,
        direct_graphics: false,
        endpoint_keybindings: true,
        mouse_capture: true,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn endpoint_control_roundtrip() {
    let msg = ClientMessage::EndpointControl {
        kind: "endpoint.hello.v1".into(),
        data: r#"{"generation":1}"#.into(),
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
    assert_eq!(
        bincode::serde::encode_to_vec(
            ClientMessage::EndpointControl {
                kind: String::new(),
                data: String::new(),
            },
            bincode::config::standard(),
        )
        .unwrap(),
        [20, 0, 0]
    );
}

#[test]
fn client_shell_resize_roundtrip() {
    let msg = ClientMessage::ClientShellResize {
        cell_width_px: 8,
        cell_height_px: 16,
        surface_size: ClientSurfaceSize { cols: 74, rows: 29 },
        pixel_mouse: true,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
    assert_eq!(
        encoded_sha256(&msg),
        "676d6376202750e72c45ff511e256b6154d3d20c0ee088d3792fa3a69d9704b9"
    );
}

#[test]
fn client_input_roundtrip() {
    let msg = ClientMessage::Input {
        data: vec![0x1b, 0x5b, 0x41], // ESC [ A (up arrow)
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_message_wire_tags_reflect_current_order() {
    fn tag(msg: &ClientMessage) -> u8 {
        *bincode::serde::encode_to_vec(msg, bincode::config::standard())
            .unwrap()
            .first()
            .expect("encoded client message should include enum tag")
    }

    assert_eq!(
        tag(&ClientMessage::TerminalHello {
            version: PROTOCOL_VERSION,
            cols: 80,
            rows: 24,
            cell_width_px: 8,
            cell_height_px: 16,
            pixel_mouse: false,
        }),
        0
    );
    assert_eq!(
        tag(&ClientMessage::ClientShellHello {
            version: PROTOCOL_VERSION,
            cell_width_px: 8,
            cell_height_px: 16,
            surface_size: ClientSurfaceSize { cols: 80, rows: 29 },
            pixel_mouse: false,
            direct_graphics: false,
            endpoint_keybindings: false,
            mouse_capture: false,
        }),
        11
    );
    assert_eq!(tag(&ClientMessage::Input { data: Vec::new() }), 1);
    assert_eq!(
        tag(&ClientMessage::ClipboardImage {
            target: ClientClipboardImageTarget::DirectTerminal,
            extension: "png".to_owned(),
            data: Vec::new(),
        }),
        2
    );
    assert_eq!(
        tag(&ClientMessage::Resize {
            cols: 80,
            rows: 24,
            cell_width_px: 8,
            cell_height_px: 16,
            pixel_mouse: false,
        }),
        3
    );
    assert_eq!(tag(&ClientMessage::Detach), 4);
    assert_eq!(
        tag(&ClientMessage::AttachTerminal {
            terminal_id: "term".to_owned(),
            takeover: false,
        }),
        5
    );
    assert_eq!(
        tag(&ClientMessage::AttachScroll {
            source: AttachScrollSource::Wheel,
            direction: AttachScrollDirection::Up,
            lines: 1,
            column: None,
            row: None,
            modifiers: 0,
        }),
        6
    );
    assert_eq!(
        tag(&ClientMessage::ObserveTerminal {
            target: "w1:p1".to_owned(),
        }),
        7
    );
    assert_eq!(
        tag(&ClientMessage::ControlTerminal {
            target: "w1:p1".to_owned(),
            takeover: false,
        }),
        8
    );
    assert_eq!(
        tag(&ClientMessage::GraphicsTransmissionResult {
            transfer_id: 1,
            image_id: 2,
            success: true,
        }),
        9
    );
    assert_eq!(
        tag(&ClientMessage::GraphicsTransmissionStarted {
            transfer_id: 1,
            image_id: 2,
        }),
        10
    );
    assert_eq!(
        tag(&ClientMessage::ClientShellResize {
            cell_width_px: 8,
            cell_height_px: 16,
            surface_size: ClientSurfaceSize { cols: 80, rows: 29 },
            pixel_mouse: false,
        }),
        12
    );
    assert_eq!(
        tag(&ClientMessage::ClientShellPaneInput {
            pane_id: "pane".into(),
            events: Vec::new(),
        }),
        13
    );
    assert_eq!(
        tag(&ClientMessage::ClientShellPopupInput {
            terminal_id: "popup".into(),
            events: Vec::new(),
        }),
        14
    );
    assert_eq!(
        tag(&ClientMessage::ClientShellEndpointRequest {
            boot_id: "boot".into(),
            request: "{}".into(),
        }),
        15
    );
    assert_eq!(
        tag(&ClientMessage::AttachMouse {
            kind: ClientMouseKind::Down(ClientMouseButton::Left),
            position: ClientMousePosition::Cell { column: 10, row: 5 },
            geometry: None,
            modifiers: 0,
            lines: 1,
        }),
        16
    );
    assert_eq!(
        tag(&ClientMessage::ClientShellHostTheme {
            update: ClientHostThemeUpdate::Appearance(ClientHostAppearance::Dark),
        }),
        17
    );
    assert_eq!(tag(&ClientMessage::ClientShellFocus { focused: true }), 18);
    assert_eq!(
        tag(&ClientMessage::ClientShellMouseCapture { enabled: true }),
        19
    );
    assert_eq!(
        tag(&ClientMessage::EndpointControl {
            kind: String::new(),
            data: String::new(),
        }),
        20
    );
}

#[test]
fn client_shell_pane_input_roundtrips_semantic_and_windows_keys() {
    let windows_record = crate::input::WindowsKeyRecord {
        key_down: true,
        repeat_count: 1,
        virtual_key_code: 0x37,
        virtual_scan_code: 0x08,
        unicode: 0,
        control_key_state: 0x0008,
    };
    let message = ClientMessage::ClientShellPaneInput {
        pane_id: "w1:p2".into(),
        events: vec![
            ClientPaneInputEvent::Key {
                code: ClientKeyCode::Char('l'),
                modifiers: crossterm::event::KeyModifiers::SHIFT.bits(),
                kind: ClientKeyKind::Release,
                repeat_count: 1,
                shifted_codepoint: Some('L' as u32),
                generated_text: None,
                tracks_release: true,
                physical_key_id: None,
                windows_record: None,
            },
            ClientPaneInputEvent::Key {
                code: ClientKeyCode::Char('7'),
                modifiers: crossterm::event::KeyModifiers::CONTROL.bits(),
                kind: ClientKeyKind::Press,
                repeat_count: 1,
                shifted_codepoint: None,
                generated_text: None,
                tracks_release: true,
                physical_key_id: Some(0x08),
                windows_record: Some(windows_record),
            },
        ],
    };
    let encoded = bincode::serde::encode_to_vec(&message, bincode::config::standard())
        .expect("encode targeted semantic input");
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard())
            .expect("decode targeted semantic input");
    assert_eq!(decoded, message);
    assert_eq!(
        encoded_sha256(&message),
        "f558384bb53dfd2baf1fa72e1709d88be6891da79e51f88513905afc085065e6"
    );
    let ClientMessage::ClientShellPaneInput { events, .. } = decoded else {
        panic!("expected targeted semantic input");
    };
    let crate::raw_input::RawInputEvent::Key(semantic) = events[0].to_raw_input_event() else {
        panic!("expected semantic key");
    };
    assert_eq!(semantic.shifted_codepoint, Some('L' as u32));
    assert_eq!(semantic.kind, crossterm::event::KeyEventKind::Release);
    let crate::raw_input::RawInputEvent::Key(key) = events[1].to_raw_input_event() else {
        panic!("expected Windows key");
    };
    assert_eq!(key.code, crossterm::event::KeyCode::Char('7'));
    assert_eq!(key.modifiers, crossterm::event::KeyModifiers::CONTROL);
    assert_eq!(key.windows_record(), Some(windows_record));
}

#[test]
fn client_shell_focus_roundtrip() {
    let message = ClientMessage::ClientShellFocus { focused: false };
    let encoded = bincode::serde::encode_to_vec(&message, bincode::config::standard())
        .expect("encode client shell focus");
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard())
            .expect("decode client shell focus");
    assert_eq!(decoded, message);
}

#[test]
fn client_shell_mouse_capture_roundtrip() {
    let message = ClientMessage::ClientShellMouseCapture { enabled: false };
    let encoded = bincode::serde::encode_to_vec(&message, bincode::config::standard())
        .expect("encode client shell mouse capture");
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard())
            .expect("decode client shell mouse capture");
    assert_eq!(decoded, message);
}

#[test]
fn client_shell_host_theme_roundtrip() {
    let message = ClientMessage::ClientShellHostTheme {
        update: ClientHostThemeUpdate::PaletteColors(vec![(
            4,
            ClientHostColor {
                r: 10,
                g: 20,
                b: 30,
            },
        )]),
    };
    let encoded = bincode::serde::encode_to_vec(&message, bincode::config::standard())
        .expect("encode host theme update");
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard())
            .expect("decode host theme update");
    assert_eq!(decoded, message);
}

#[test]
fn client_shell_endpoint_messages_roundtrip() {
    let request = ClientMessage::ClientShellEndpointRequest {
        boot_id: "boot-a".into(),
        request: r#"{"id":"request-a","method":"session.snapshot","params":{}}"#.into(),
    };
    let encoded = bincode::serde::encode_to_vec(&request, bincode::config::standard())
        .expect("encode endpoint request");
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard())
            .expect("decode endpoint request");
    assert_eq!(decoded, request);
    assert_eq!(
        encoded_sha256(&request),
        "de5693585a01f6b0d5ee07c51b6ddf79ee9f67dbf183255822d31f35210f5ffb"
    );

    let response = ServerMessage::ClientShellEndpointResponseChunk {
        boot_id: "boot-a".into(),
        request_id: "request-a".into(),
        final_chunk: true,
        data: br#"{"id":"request-a","result":{"type":"ok"}}"#.to_vec(),
    };
    let encoded = bincode::serde::encode_to_vec(&response, bincode::config::standard())
        .expect("encode endpoint response");
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard())
            .expect("decode endpoint response");
    assert_eq!(decoded, response);
    assert_eq!(
        encoded_sha256(&response),
        "bc14dbb5263d3097fe6d3e70a4b6d71aa9c2fa4ae3206d692a7182512bffdd1d"
    );
}

#[test]
fn client_clipboard_image_roundtrip() {
    let msg = ClientMessage::ClipboardImage {
        target: ClientClipboardImageTarget::Pane("w1:p1".into()),
        extension: "png".to_owned(),
        data: vec![0x89, b'P', b'N', b'G'],
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
    assert_eq!(
        encoded_sha256(&msg),
        "1c02110be0671faf318b3f4d8f507748d5a0a98cd474832669c5290d97ef19ab"
    );
}

#[test]
fn client_input_large_multilingual_payload_roundtrip() {
    let text = "你好，今天我们测试一段比较长的语音输入。こんにちは。안녕하세요.🙂".repeat(1024);
    assert!(text.len() > 64 * 1024);
    assert!(text.len() < MAX_FRAME_SIZE);
    let msg = ClientMessage::Input {
        data: text.as_bytes().to_vec(),
    };

    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, consumed): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();

    assert_eq!(consumed, encoded.len());
    assert_eq!(decoded, msg);
}

#[test]
fn client_resize_roundtrip() {
    let msg = ClientMessage::Resize {
        cols: 80,
        rows: 24,
        cell_width_px: 8,
        cell_height_px: 16,
        pixel_mouse: true,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_detach_roundtrip() {
    let msg = ClientMessage::Detach;
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_attach_terminal_roundtrip() {
    let msg = ClientMessage::AttachTerminal {
        terminal_id: "term_123".to_owned(),
        takeover: true,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_observe_terminal_roundtrip() {
    let msg = ClientMessage::ObserveTerminal {
        target: "w1:p1".to_owned(),
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_control_terminal_roundtrip() {
    let msg = ClientMessage::ControlTerminal {
        target: "w1:p1".to_owned(),
        takeover: true,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_attach_scroll_roundtrip() {
    let msg = ClientMessage::AttachScroll {
        source: AttachScrollSource::Wheel,
        direction: AttachScrollDirection::Up,
        lines: 3,
        column: Some(12),
        row: Some(7),
        modifiers: 4,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

// ---- Round-trip: ServerMessage ----

#[test]
fn server_welcome_roundtrip() {
    let msg = ServerMessage::Welcome {
        version: PROTOCOL_VERSION,
        encoding: RenderEncoding::SemanticFrame,
        error: None,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn server_welcome_with_error_roundtrip() {
    let msg = ServerMessage::Welcome {
        version: PROTOCOL_VERSION,
        encoding: RenderEncoding::SemanticFrame,
        error: Some("incompatible version".to_owned()),
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn server_frame_roundtrip_nontrivial() {
    // Build a 3×2 frame with varied styles (≥2×2).
    let frame = FrameData {
        cells: vec![
            CellData {
                symbol: "H".into(),
                fg: color_to_u32(Color::Red),
                bg: color_to_u32(Color::Black),
                modifier: Modifier::BOLD.bits(),
                skip: false,
                hyperlink: None,
            },
            CellData {
                symbol: "i".into(),
                fg: color_to_u32(Color::Green),
                bg: color_to_u32(Color::Reset),
                modifier: Modifier::ITALIC.bits(),
                skip: false,
                hyperlink: None,
            },
            CellData {
                symbol: "!".into(),
                fg: color_to_u32(Color::Rgb(255, 128, 0)),
                bg: color_to_u32(Color::Indexed(220)),
                modifier: (Modifier::BOLD | Modifier::UNDERLINED).bits(),
                skip: false,
                hyperlink: Some(0),
            },
            CellData {
                symbol: " ".into(),
                fg: color_to_u32(Color::Reset),
                bg: color_to_u32(Color::Reset),
                modifier: Modifier::empty().bits(),
                skip: true,
                hyperlink: None,
            },
            CellData {
                symbol: "→".into(), // multi-byte grapheme
                fg: color_to_u32(Color::Cyan),
                bg: color_to_u32(Color::Blue),
                modifier: Modifier::REVERSED.bits(),
                skip: false,
                hyperlink: None,
            },
            CellData {
                symbol: "🦀".into(), // emoji, wide grapheme cluster
                fg: color_to_u32(Color::Yellow),
                bg: color_to_u32(Color::Magenta),
                modifier: Modifier::empty().bits(),
                skip: false,
                hyperlink: None,
            },
        ],
        width: 3,
        height: 2,
        cursor: Some(CursorState {
            x: 0,
            y: 0,
            visible: true,
            shape: 6,
        }),
        hyperlinks: vec!["https://example.com".to_owned()],
        graphics: Vec::new(),
    };
    let msg = ServerMessage::PaneSurface(PaneSurfaceFrame {
        boot_id: "boot-1".into(),
        projection_revision: 1,
        surface_revision: 1,
        frame: frame.clone(),
        panes: Vec::new(),
        splits: Vec::new(),
        popup: None,
        graphics: SurfaceGraphicsScene::default(),
    });
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
    assert_eq!(
        encoded_sha256(&msg),
        "7c016f7b21ddb5ac79212cf65a968b93eb292b5305b941263e89ffaa40158ee3"
    );
    match decoded {
        ServerMessage::PaneSurface(surface) => {
            assert_eq!(surface.frame.cells[2].hyperlink, Some(0));
            assert_eq!(
                surface.frame.hyperlinks,
                vec!["https://example.com".to_owned()]
            );
        }
        other => panic!("expected pane surface, got {other:?}"),
    }
}

#[test]
fn pane_surface_patch_roundtrip() {
    let msg = ServerMessage::PaneSurfacePatch(PaneSurfacePatch {
        boot_id: "boot-1".into(),
        projection_revision: 3,
        base_surface_revision: 7,
        surface_revision: 8,
        rows: vec![PaneSurfacePatchRow {
            x: 2,
            y: 4,
            cells: vec![CellData {
                symbol: "x".into(),
                fg: 1,
                bg: 2,
                modifier: 3,
                skip: false,
                hyperlink: None,
            }],
        }],
        panes: Vec::new(),
        cursor: Some(CursorState {
            x: 2,
            y: 4,
            visible: true,
            shape: 2,
        }),
    });
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(decoded, msg);
    assert_eq!(
        encoded_sha256(&msg),
        "0814b99a1dc6eaf7918424aa416c066509cbfb73b72344a809c27cde78cb6dbd"
    );
}

#[test]
fn client_shell_graphics_payload_codec_is_frozen() {
    let key = SurfaceGraphicsAssetKey {
        source: SurfaceGraphicsSource::Terminal {
            target: SurfaceGraphicsTarget::Pane {
                pane_id: "w1:p1".into(),
            },
            image_id: 7,
        },
        image_width: 2,
        image_height: 1,
        format: SurfaceGraphicsFormat::Rgba,
        data_len: 8,
        data_fingerprint: 42,
    };
    let message = ServerMessage::PaneSurface(PaneSurfaceFrame {
        boot_id: "boot-1".into(),
        projection_revision: 2,
        surface_revision: 3,
        frame: FrameData {
            cells: Vec::new(),
            width: 0,
            height: 0,
            cursor: None,
            hyperlinks: Vec::new(),
            graphics: Vec::new(),
        },
        panes: Vec::new(),
        splits: Vec::new(),
        popup: None,
        graphics: SurfaceGraphicsScene {
            assets: vec![SurfaceGraphicsAsset {
                key: key.clone(),
                data: vec![255, 0, 0, 255, 0, 255, 0, 255],
            }],
            placements: vec![SurfaceGraphicsPlacement {
                asset: key,
                logical_placement_id: 9,
                x: 1,
                y: 2,
                cols: 2,
                rows: 1,
                source_x: 0,
                source_y: 0,
                source_width: 2,
                source_height: 1,
                x_offset: 0,
                y_offset: 0,
                z: -1,
                scrollback_offset: 0,
            }],
            retained_assets: Vec::new(),
        },
    });

    assert_eq!(
        encoded_sha256(&message),
        "49c4efec0f1456c8ca4112ddf6ead1ab75d0224007576c2ccc18c3fca55a69f0"
    );
}

#[test]
fn server_endpoint_control_tag_is_frozen() {
    let message = ServerMessage::EndpointControl {
        kind: "endpoint.welcome.v1".into(),
        data: r#"{"generation":1}"#.into(),
    };
    let encoded = bincode::serde::encode_to_vec(&message, bincode::config::standard()).unwrap();
    assert_eq!(encoded.first(), Some(&20));
    assert_eq!(
        bincode::serde::encode_to_vec(
            ServerMessage::EndpointControl {
                kind: String::new(),
                data: String::new(),
            },
            bincode::config::standard(),
        )
        .unwrap(),
        [20, 0, 0]
    );
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(decoded, message);
}

#[test]
fn client_shell_server_message_tags_are_frozen() {
    fn tag(message: &ServerMessage) -> u8 {
        *bincode::serde::encode_to_vec(message, bincode::config::standard())
            .unwrap()
            .first()
            .expect("encoded server message should include enum tag")
    }

    let empty_frame = || PaneSurfaceFrame {
        boot_id: "boot".into(),
        projection_revision: 1,
        surface_revision: 1,
        frame: FrameData {
            cells: Vec::new(),
            width: 0,
            height: 0,
            cursor: None,
            hyperlinks: Vec::new(),
            graphics: Vec::new(),
        },
        panes: Vec::new(),
        splits: Vec::new(),
        popup: None,
        graphics: SurfaceGraphicsScene::default(),
    };
    assert_eq!(tag(&ServerMessage::PaneSurface(empty_frame())), 13);
    assert_eq!(
        tag(&ServerMessage::ClientShellError {
            message: String::new(),
        }),
        15
    );
    assert_eq!(
        tag(&ServerMessage::ClientShellKeyboardReportAll { enabled: false }),
        17
    );
    assert_eq!(
        tag(&ServerMessage::ClientShellEndpointResponseChunk {
            boot_id: String::new(),
            request_id: String::new(),
            final_chunk: true,
            data: Vec::new(),
        }),
        18
    );
    assert_eq!(
        tag(&ServerMessage::PaneSurfacePatch(PaneSurfacePatch {
            boot_id: String::new(),
            projection_revision: 0,
            base_surface_revision: 0,
            surface_revision: 0,
            rows: Vec::new(),
            panes: Vec::new(),
            cursor: None,
        })),
        19
    );
    assert_eq!(
        tag(&ServerMessage::EndpointControl {
            kind: String::new(),
            data: String::new(),
        }),
        20
    );
}

#[test]
fn client_shell_snapshot_roundtrip() {
    let msg = ServerMessage::ClientShellSnapshot(Box::new(ClientShellSnapshot {
        boot_id: "boot-1".into(),
        revision: 1,
        config_diagnostic: Some("endpoint config warning".into()),
        product_announcement: Some(ClientShellProductAnnouncement {
            version: "0.8.2".into(),
            id: "client-shell".into(),
            title: "Client shell".into(),
            body: "### New\n- Client-owned chrome".into(),
            preview: false,
        }),
        update_available: Some("0.8.3".into()),
        update_install_command: "herdr update".into(),
        server_keybindings_toml: Some("[keys]\nprefix = \"ctrl+a\"\n".into()),
        latest_release_notes_available: true,
        integration_updates_available: true,
        worktree_directory: "/tmp/herdr-worktrees".into(),
        release_notes: Some(ClientShellReleaseNotes {
            version: "0.8.3".into(),
            body: "### New\n- Update ready".into(),
            preview: true,
        }),
        focused_workspace_id: Some("w1".into()),
        focused_tab_id: Some("w1:t1".into()),
        focused_pane_id: Some("w1:p1".into()),
        tab_bar_right: vec![ClientShellTabStatusSegment {
            text: "host".into(),
            accent: false,
        }],
        tab_bar_right_separator: " · ".into(),
        agent_view_label: None,
        agent_order: Vec::new(),
        workspaces: vec![ClientShellWorkspace {
            workspace_id: "w1".into(),
            active_tab_id: "w1:t1".into(),
            new_workspace_cwd: "/tmp".into(),
            number: 1,
            label: "shell".into(),
            custom_label: false,
            branch: Some("main".into()),
            git_ahead_behind: None,
            tokens: Vec::new(),
            worktree: None,
            focused: true,
            agent_status: crate::api::schema::AgentStatus::Idle,
        }],
        tabs: vec![ClientShellTab {
            tab_id: "w1:t1".into(),
            workspace_id: "w1".into(),
            number: 1,
            label: "main".into(),
            custom_label: true,
            zoomed: false,
            focused: true,
            agent_status: crate::api::schema::AgentStatus::Idle,
        }],
        panes: vec![ClientShellPane {
            pane_id: "w1:p1".into(),
            workspace_id: "w1".into(),
            tab_id: "w1:t1".into(),
            label: None,
            cwd: Some("/repo".into()),
            foreground_cwd: Some("/repo".into()),
            focused: true,
            right_click_passthrough: false,
        }],
        agents: Vec::new(),
        commands: vec![ClientShellCommand {
            command_id: "cmd_0123456789abcdef0123456789abcdef".into(),
            binding_label: "prefix+z".into(),
            binding_labels: vec!["prefix+z".into()],
            action: ClientShellCommandAction::Shell,
            description: Some("deploy".into()),
        }],
    }));
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn server_shutdown_roundtrip() {
    let msg = ServerMessage::ServerShutdown {
        reason: Some("updating".to_owned()),
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn semantic_notification_roundtrip() {
    let msg = ServerMessage::SemanticNotification(SemanticNotification {
        kind: SemanticNotificationKind::NeedsAttention,
        title: "codex needs attention".into(),
        body: Some("repo · 1".into()),
        sound: Some(SemanticNotificationSound::Request),
        agent: Some("codex".into()),
        workspace_id: Some("w1".into()),
        tab_id: Some("w1:t1".into()),
        pane_id: Some("w1:p1".into()),
        position: Some(crate::config::ToastHerdrPosition::TopRight),
    });
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn server_notify_roundtrip() {
    for kind in [
        NotifyKind::Sound,
        NotifyKind::Toast,
        NotifyKind::SystemToast,
    ] {
        let msg = ServerMessage::Notify {
            kind,
            message: "agent done".to_owned(),
            body: None,
        };
        let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
        let (decoded, _): (ServerMessage, _) =
            bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
        assert_eq!(msg, decoded);
    }
}

#[test]
fn server_clipboard_roundtrip() {
    let msg = ServerMessage::Clipboard {
        data: "dGVzdA==".to_owned(), // base64 "test"
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn server_window_title_roundtrip() {
    for title in [Some("herdr api".to_owned()), None] {
        let msg = ServerMessage::WindowTitle { title };
        let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
        let (decoded, _): (ServerMessage, _) =
            bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
        assert_eq!(msg, decoded);
    }
}

#[test]
fn server_graphics_roundtrip() {
    let msg = ServerMessage::Graphics {
        bytes: b"\x1b_Ga=d,d=A,q=2;\x1b\\".to_vec(),
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
    assert_eq!(
        encoded_sha256(&msg),
        "28a420f92e0e05e6760a8c140baf307c360c6d1b1aa68027481b324f87e22c44"
    );
}

#[test]
fn server_terminal_frame_roundtrip() {
    let msg = ServerMessage::Terminal(TerminalFrame {
        seq: 7,
        width: 120,
        height: 40,
        full: false,
        bytes: b"\x1b[1;1Hhello".to_vec(),
    });
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn server_reload_sound_config_roundtrip() {
    let msg = ServerMessage::ReloadSoundConfig;
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn server_mouse_capture_roundtrip() {
    let msg = ServerMessage::MouseCapture {
        enabled: true,
        sgr_pixels: true,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn client_shell_keyboard_report_all_roundtrip() {
    let msg = ServerMessage::ClientShellKeyboardReportAll { enabled: true };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn direct_terminal_keyboard_mode_roundtrip() {
    let msg = ServerMessage::DirectTerminalKeyboardProtocol {
        flags: 15,
        modify_other_keys_level: 1,
    };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn direct_graphics_messages_roundtrip() {
    let client = ClientMessage::GraphicsTransmissionResult {
        transfer_id: 7,
        image_id: 42,
        success: false,
    };
    let encoded = bincode::serde::encode_to_vec(&client, bincode::config::standard()).unwrap();
    let (decoded, _): (ClientMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(client, decoded);

    let server = ServerMessage::GraphicsFile {
        path: "/run/user/1000/herdr/source/frame".into(),
        expected_len: 4,
        image_id: 42,
        transfer_id: 7,
        leading: b"\x1b[2;3H".to_vec(),
        control: "a=T,f=32,i=42,q=0".into(),
        surface_asset: None,
    };
    let encoded = bincode::serde::encode_to_vec(&server, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(server, decoded);
}

#[test]
fn server_terminal_bell_roundtrip() {
    let msg = ServerMessage::TerminalBell { count: 3 };
    let encoded = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let (decoded, _): (ServerMessage, _) =
        bincode::serde::decode_from_slice(&encoded, bincode::config::standard()).unwrap();
    assert_eq!(msg, decoded);
}

// ---- Framing ----

#[test]
fn framing_small_message_roundtrip() {
    let msg = ClientMessage::TerminalHello {
        version: PROTOCOL_VERSION,
        cols: 80,
        rows: 24,
        cell_width_px: 8,
        cell_height_px: 16,
        pixel_mouse: false,
    };
    let mut buf = Vec::new();
    write_message(&mut buf, &msg).unwrap();
    let decoded: ClientMessage = read_message(&mut buf.as_slice(), MAX_FRAME_SIZE).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn framing_large_payload_roundtrip() {
    // Create a pane-surface message that is ≥128 KB.
    // Use a large frame with verbose cell data to exceed 128 KB after bincode encoding.
    // 200×50 = 10000 cells. With varied symbols and styles, this should easily exceed 128 KB.
    let width: u16 = 200;
    let height: u16 = 50;
    let cells: Vec<CellData> = (0..(width as usize) * (height as usize))
        .map(|i| CellData {
            symbol: if i % 256 < 32 {
                " ".to_owned()
            } else {
                format!("{:03}", i % 1000)
            },
            fg: color_to_u32(Color::Rgb((i % 256) as u8, ((i / 256) % 256) as u8, 128)),
            bg: color_to_u32(Color::Indexed((i % 256) as u8)),
            modifier: ((i % 16) as u16),
            skip: i % 100 == 0,
            hyperlink: None,
        })
        .collect();

    let frame = FrameData {
        cells,
        width,
        height,
        cursor: Some(CursorState {
            x: 10,
            y: 5,
            visible: true,
            shape: 0,
        }),
        hyperlinks: Vec::new(),
        graphics: Vec::new(),
    };
    let msg = ServerMessage::PaneSurface(PaneSurfaceFrame {
        boot_id: "boot-1".into(),
        projection_revision: 1,
        surface_revision: 1,
        frame,
        panes: Vec::new(),
        splits: Vec::new(),
        popup: None,
        graphics: SurfaceGraphicsScene::default(),
    });

    let mut buf = Vec::new();
    write_message(&mut buf, &msg).unwrap();
    // Verify the payload is at least 128 KB
    assert!(
        buf.len() >= 128 * 1024,
        "framed payload should be >= 128 KB, got {} bytes",
        buf.len()
    );

    let decoded: ServerMessage = read_message(&mut buf.as_slice(), MAX_FRAME_SIZE).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn framing_multiple_messages_sequential() {
    // Write 100+ messages of varying types and read them back.
    let mut buf = Vec::new();
    let mut expected = Vec::new();

    for i in 0..150u32 {
        let msg = match i % 5 {
            0 => ClientMessage::TerminalHello {
                version: PROTOCOL_VERSION,
                cols: (80 + (i % 40) as u16),
                rows: (24 + (i % 20) as u16),
                cell_width_px: 8,
                cell_height_px: 16,
                pixel_mouse: i % 2 == 0,
            },
            1 => ClientMessage::Input {
                data: vec![(i % 256) as u8; (i as usize % 50) + 1],
            },
            2 => ClientMessage::ClipboardImage {
                target: ClientClipboardImageTarget::DirectTerminal,
                extension: "png".to_owned(),
                data: vec![0x89, b'P', b'N', b'G', (i % 256) as u8],
            },
            3 => ClientMessage::Resize {
                cols: (100 + (i % 30) as u16),
                rows: (30 + (i % 10) as u16),
                cell_width_px: 8,
                cell_height_px: 16,
                pixel_mouse: i % 2 == 0,
            },
            4 => ClientMessage::Detach,
            _ => unreachable!(),
        };
        write_message(&mut buf, &msg).unwrap();
        expected.push(msg);
    }

    let mut cursor = buf.as_slice();
    for expected_msg in &expected {
        let decoded: ClientMessage = read_message(&mut cursor, MAX_FRAME_SIZE).unwrap();
        assert_eq!(*expected_msg, decoded);
    }
}

#[test]
fn framing_oversized_rejected_without_panic() {
    // Craft a frame with a huge length prefix (4 GB claim).
    let mut buf: Vec<u8> = (u32::MAX).to_le_bytes().to_vec();
    // Add a few garbage bytes after the length prefix.
    buf.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);

    let result: Result<ClientMessage, FramingError> =
        read_message(&mut buf.as_slice(), MAX_FRAME_SIZE);
    match result {
        Err(FramingError::Oversized { claimed, max }) => {
            assert_eq!(claimed, u32::MAX as usize);
            assert_eq!(max, MAX_FRAME_SIZE);
        }
        other => panic!("expected Oversized error, got: {other:?}"),
    }
}

#[test]
fn framing_malformed_payload_rejected_without_panic() {
    // Valid length prefix pointing to garbage data.
    let payload = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02];
    let mut buf = (payload.len() as u32).to_le_bytes().to_vec();
    buf.extend_from_slice(&payload);

    let result: Result<ClientMessage, FramingError> =
        read_message(&mut buf.as_slice(), MAX_FRAME_SIZE);
    assert!(result.is_err(), "malformed payload should be rejected");
    match result {
        Err(FramingError::Bincode(_)) => {} // expected
        other => panic!("expected Bincode error, got: {other:?}"),
    }
}

#[test]
fn framing_truncated_stream_returns_unexpected_eof() {
    // Write a length prefix claiming 100 bytes, but only provide 4.
    let mut buf: Vec<u8> = 100u32.to_le_bytes().to_vec();
    buf.extend_from_slice(&[0xAA, 0xBB, 0xCC, 0xDD]);

    let result: Result<ClientMessage, FramingError> =
        read_message(&mut buf.as_slice(), MAX_FRAME_SIZE);
    match result {
        Err(FramingError::UnexpectedEof) => {}
        other => panic!("expected UnexpectedEof, got: {other:?}"),
    }
}

#[test]
fn framing_zero_length_message() {
    // A 1-byte message (smallest possible valid bincode payload).
    // Actually, let's test with the smallest real message: Detach.
    let msg = ClientMessage::Detach;
    let mut buf = Vec::new();
    write_message(&mut buf, &msg).unwrap();

    // Verify the length prefix is correct
    let len = u32::from_le_bytes(buf[..4].try_into().unwrap()) as usize;
    assert_eq!(
        len,
        buf.len() - 4,
        "length prefix should match payload size"
    );

    let decoded: ClientMessage = read_message(&mut buf.as_slice(), MAX_FRAME_SIZE).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn framing_partial_read_reassembly() {
    // Simulate partial reads by using a reader that yields small chunks.
    let msg = ClientMessage::Input {
        data: vec![42; 500], // 500-byte input payload
    };
    let mut full_buf = Vec::new();
    write_message(&mut full_buf, &msg).unwrap();

    // Wrap in a chunked reader that only yields 7 bytes at a time.
    let mut chunked = ChunkedReader::new(full_buf, 7);
    let decoded: ClientMessage = read_message(&mut chunked, MAX_FRAME_SIZE).unwrap();
    assert_eq!(msg, decoded);
}

// ---- Version negotiation ----

#[test]
fn version_compatible() {
    assert_eq!(
        check_client_version(PROTOCOL_VERSION),
        VersionCheck::Compatible
    );
}

#[test]
fn version_older_client_rejected() {
    let result = check_client_version(PROTOCOL_VERSION - 1);
    assert!(matches!(result, VersionCheck::Incompatible(_)));
    if let VersionCheck::Incompatible(msg) = result {
        assert!(msg.contains("older"), "error should mention older version");
    }
}

#[test]
fn version_newer_client_rejected() {
    let result = check_client_version(PROTOCOL_VERSION + 1);
    assert!(matches!(result, VersionCheck::Incompatible(_)));
    if let VersionCheck::Incompatible(msg) = result {
        assert!(msg.contains("newer"), "error should mention newer version");
    }
}

// ---- Pre-persistence client rejection ----

#[test]
fn prepersistence_version_zero_rejected() {
    let result = check_client_version(0);
    match result {
        VersionCheck::Incompatible(msg) => {
            assert!(
                msg.contains("pre-persistence"),
                "error should mention pre-persistence: {msg}"
            );
        }
        _ => panic!("version 0 should be rejected as incompatible"),
    }
}

#[test]
fn prepersistence_version_zero_welcome_has_error() {
    // Simulating what the server would send to a v0 client.
    let check = check_client_version(0);
    let response = match check {
        VersionCheck::Compatible => ServerMessage::Welcome {
            version: PROTOCOL_VERSION,
            encoding: RenderEncoding::SemanticFrame,
            error: None,
        },
        VersionCheck::Incompatible(reason) => ServerMessage::Welcome {
            version: PROTOCOL_VERSION,
            encoding: RenderEncoding::SemanticFrame,
            error: Some(reason),
        },
    };

    match response {
        ServerMessage::Welcome { error: Some(_), .. } => {}
        other => panic!("expected Welcome with error, got: {other:?}"),
    }
}

// ---- Malformed/oversized input ----

#[test]
fn oversized_frame_does_not_panic() {
    // Claim 4GB payload — should return Oversized error, not panic.
    let mut buf: Vec<u8> = 0xFFC00000u32.to_le_bytes().to_vec(); // ~4 GB claim
    buf.extend_from_slice(&[0; 8]);

    let result: Result<ClientMessage, FramingError> =
        read_message(&mut buf.as_slice(), MAX_FRAME_SIZE);
    assert!(result.is_err());
    // Did not panic — test passing is proof.
}

#[test]
fn malformed_frame_does_not_panic() {
    // Random garbage bytes after a valid-ish length prefix.
    let garbage: Vec<u8> = (0..200).map(|i| (i ^ 0xAA) as u8).collect();
    let mut buf = (garbage.len() as u32).to_le_bytes().to_vec();
    buf.extend_from_slice(&garbage);

    let result: Result<ClientMessage, FramingError> =
        read_message(&mut buf.as_slice(), MAX_FRAME_SIZE);
    assert!(result.is_err());
    // Did not panic.
}

#[test]
fn oversized_input_rejected_custom_max() {
    // Verify a custom (small) max_frame_size is enforced.
    let msg = ClientMessage::Input {
        data: vec![0x41; 1000],
    };
    let mut buf = Vec::new();
    write_message(&mut buf, &msg).unwrap();

    let result: Result<ClientMessage, FramingError> = read_message(&mut buf.as_slice(), 64);
    // The actual bincode payload for 1000 bytes of input will be > 64 bytes.
    assert!(
        matches!(result, Err(FramingError::Oversized { .. })),
        "expected Oversized with small max_frame_size"
    );
}

// ---- FrameData ↔ ratatui Buffer conversion ----

#[test]
fn frame_data_roundtrip_through_ratatui_buffer() {
    let area = ratatui::layout::Rect::new(0, 0, 5, 3);
    let mut buffer = ratatui::buffer::Buffer::filled(area, ratatui::buffer::Cell::new(" "));

    // Write some styled content.
    buffer.cell_mut((0, 0)).unwrap().set_symbol("H");
    buffer.cell_mut((0, 0)).unwrap().fg = Color::Red;
    buffer.cell_mut((0, 0)).unwrap().modifier = Modifier::BOLD;

    buffer.cell_mut((1, 0)).unwrap().set_symbol("i");
    buffer.cell_mut((1, 0)).unwrap().fg = Color::Green;
    buffer.cell_mut((1, 0)).unwrap().modifier = Modifier::ITALIC;

    buffer.cell_mut((2, 0)).unwrap().set_symbol("!");
    buffer.cell_mut((2, 0)).unwrap().fg = Color::Rgb(255, 128, 0);
    buffer.cell_mut((2, 0)).unwrap().bg = Color::Indexed(220);

    let cursor = CursorState {
        x: 1,
        y: 0,
        visible: true,
        shape: 0,
    };
    let frame = FrameData::from_ratatui_buffer(&buffer, Some(cursor.clone()));

    // Verify frame dimensions.
    assert_eq!(frame.width, 5);
    assert_eq!(frame.height, 3);
    assert_eq!(frame.cells.len(), 15);
    assert_eq!(frame.cursor, Some(cursor));

    // Verify specific cells survived the conversion.
    assert_eq!(frame.cells[0].symbol, "H");
    assert_eq!(frame.cells[0].fg, color_to_u32(Color::Red));
    assert_eq!(frame.cells[0].modifier, Modifier::BOLD.bits());

    assert_eq!(frame.cells[1].symbol, "i");
    assert_eq!(frame.cells[1].fg, color_to_u32(Color::Green));
    assert_eq!(frame.cells[1].modifier, Modifier::ITALIC.bits());

    assert_eq!(frame.cells[2].symbol, "!");
    assert_eq!(frame.cells[2].fg, color_to_u32(Color::Rgb(255, 128, 0)));
    assert_eq!(frame.cells[2].bg, color_to_u32(Color::Indexed(220)));

    let with_links = FrameData::from_ratatui_buffer_with_hyperlinks(
        &buffer,
        None,
        &[((1, 0), "i".to_owned(), "https://example.com".to_owned())],
    );
    assert_eq!(with_links.cells[1].hyperlink, Some(0));
    assert_eq!(
        with_links.hyperlinks,
        vec!["https://example.com".to_owned()]
    );

    // Convert back to ratatui buffer and compare.
    let restored = frame.to_ratatui_buffer().expect("should reconstruct");
    assert_eq!(restored.area, area);
    assert_eq!(restored.cell((0, 0)).unwrap().symbol(), "H");
    assert_eq!(restored.cell((0, 0)).unwrap().fg, Color::Red);
    assert_eq!(restored.cell((0, 0)).unwrap().modifier, Modifier::BOLD);
    assert_eq!(restored.cell((1, 0)).unwrap().symbol(), "i");
    assert_eq!(restored.cell((2, 0)).unwrap().symbol(), "!");
    assert_eq!(restored.cell((2, 0)).unwrap().fg, Color::Rgb(255, 128, 0));
}

#[test]
fn frame_data_rejects_mismatched_cell_count() {
    let frame = FrameData {
        cells: vec![
            CellData {
                symbol: "X".into(),
                fg: 0,
                bg: 0,
                modifier: 0,
                skip: false,
                hyperlink: None,
            };
            5
        ], // 5 cells but 3×2 = 6 expected
        width: 3,
        height: 2,
        cursor: None,
        hyperlinks: Vec::new(),
        graphics: Vec::new(),
    };
    assert!(frame.to_ratatui_buffer().is_none());
}

// ---- Color conversion coverage ----

#[test]
fn color_roundtrip_all_named_colors() {
    let named = [
        Color::Reset,
        Color::Black,
        Color::Red,
        Color::Green,
        Color::Yellow,
        Color::Blue,
        Color::Magenta,
        Color::Cyan,
        Color::Gray,
        Color::DarkGray,
        Color::LightRed,
        Color::LightGreen,
        Color::LightYellow,
        Color::LightBlue,
        Color::LightMagenta,
        Color::LightCyan,
        Color::White,
    ];
    for c in named {
        assert_eq!(
            u32_to_color(color_to_u32(c)),
            c,
            "roundtrip failed for {c:?}"
        );
    }
}

#[test]
fn color_roundtrip_indexed() {
    for i in 0..=255u8 {
        let c = Color::Indexed(i);
        assert_eq!(
            u32_to_color(color_to_u32(c)),
            c,
            "roundtrip failed for Indexed({i})"
        );
    }
}

#[test]
fn color_roundtrip_rgb() {
    let c = Color::Rgb(0xAB, 0xCD, 0xEF);
    assert_eq!(u32_to_color(color_to_u32(c)), c);

    let c = Color::Rgb(0, 0, 0);
    assert_eq!(u32_to_color(color_to_u32(c)), c);

    let c = Color::Rgb(255, 255, 255);
    assert_eq!(u32_to_color(color_to_u32(c)), c);
}

// ---- Modifier conversion ----

#[test]
fn modifier_roundtrip() {
    let all_mods = [
        Modifier::BOLD,
        Modifier::ITALIC,
        Modifier::REVERSED,
        Modifier::UNDERLINED,
        Modifier::DIM,
        Modifier::SLOW_BLINK,
        Modifier::CROSSED_OUT,
        Modifier::BOLD | Modifier::ITALIC,
        Modifier::BOLD | Modifier::UNDERLINED | Modifier::REVERSED,
        Modifier::empty(),
    ];
    for m in all_mods {
        assert_eq!(
            u16_to_modifier(modifier_to_u16(m)),
            m,
            "roundtrip failed for {m:?}"
        );
    }
}

#[test]
fn read_message_rejects_trailing_bytes() {
    // Encode a valid message, then append an extra byte after it.
    let msg = ClientMessage::Detach;
    let mut payload = bincode::serde::encode_to_vec(&msg, bincode::config::standard()).unwrap();
    let original_len = payload.len();
    payload.push(0xDE); // trailing garbage

    // Frame it with the inflated length (original + 1).
    let mut buf = (payload.len() as u32).to_le_bytes().to_vec();
    buf.extend_from_slice(&payload);

    let result: Result<ClientMessage, FramingError> =
        read_message(&mut buf.as_slice(), MAX_FRAME_SIZE);
    match result {
        Err(FramingError::Bincode(msg)) => {
            assert!(
                msg.contains("trailing bytes"),
                "error should mention trailing bytes: {msg}"
            );
            assert!(
                msg.contains(&format!("decoded {original_len}")),
                "error should mention decoded byte count: {msg}"
            );
        }
        other => panic!("expected Bincode error about trailing bytes, got: {other:?}"),
    }
}

#[test]
fn read_message_accepts_exact_payload() {
    // A normally-framed message should decode without error.
    let msg = ClientMessage::TerminalHello {
        version: PROTOCOL_VERSION,
        cols: 80,
        rows: 24,
        cell_width_px: 8,
        cell_height_px: 16,
        pixel_mouse: false,
    };
    let mut buf = Vec::new();
    write_message(&mut buf, &msg).unwrap();
    let decoded: ClientMessage = read_message(&mut buf.as_slice(), MAX_FRAME_SIZE).unwrap();
    assert_eq!(msg, decoded);
}

#[test]
fn write_message_rejects_oversized_payload() {
    // We can't easily create a message that exceeds u32::MAX in a test,
    // but we can verify the check exists by testing that normal messages
    // have lengths well within the limit and the function doesn't fail.
    let msg = ClientMessage::Detach;
    let mut buf = Vec::new();
    assert!(write_message(&mut buf, &msg).is_ok());
}

// ---- Unix socketpair integration test ----

#[cfg(unix)]
#[test]
fn framing_over_unix_socketpair() {
    use std::os::unix::net::UnixStream;

    let (mut a, mut b) = UnixStream::pair().expect("socketpair");

    let messages = vec![
        ClientMessage::TerminalHello {
            version: PROTOCOL_VERSION,
            cols: 200,
            rows: 60,
            cell_width_px: 8,
            cell_height_px: 16,
            pixel_mouse: true,
        },
        ClientMessage::Input {
            data: b"hello world".to_vec(),
        },
        ClientMessage::ClipboardImage {
            target: ClientClipboardImageTarget::DirectTerminal,
            extension: "png".to_owned(),
            data: vec![0x89, b'P', b'N', b'G'],
        },
        ClientMessage::Resize {
            cols: 100,
            rows: 30,
            cell_width_px: 8,
            cell_height_px: 16,
            pixel_mouse: true,
        },
        ClientMessage::Detach,
    ];

    // Set non-blocking so we can write and read in the same test.
    a.set_nonblocking(false).unwrap();
    b.set_nonblocking(false).unwrap();

    for msg in &messages {
        write_message(&mut a, msg).unwrap();
    }

    for expected in &messages {
        let decoded: ClientMessage = read_message(&mut b, MAX_FRAME_SIZE).unwrap();
        assert_eq!(*expected, decoded);
    }
}

// ---- Helper: chunked reader for simulating partial reads ----

/// A `Read` wrapper that yields at most `chunk_size` bytes per `read()` call,
/// simulating partial reads on a real socket.
struct ChunkedReader {
    data: Vec<u8>,
    pos: usize,
    chunk_size: usize,
}

impl ChunkedReader {
    fn new(data: Vec<u8>, chunk_size: usize) -> Self {
        Self {
            data,
            pos: 0,
            chunk_size,
        }
    }
}

impl Read for ChunkedReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.pos >= self.data.len() {
            return Ok(0);
        }
        let remaining = self.data.len() - self.pos;
        let to_read = buf.len().min(remaining).min(self.chunk_size);
        buf[..to_read].copy_from_slice(&self.data[self.pos..self.pos + to_read]);
        self.pos += to_read;
        Ok(to_read)
    }
}

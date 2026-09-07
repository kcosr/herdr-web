use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Minimal action model needed by the copied wire conversion helpers.
pub enum CustomCommandAction {
    Shell,
    Pane,
    Popup,
    PluginAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ToastHerdrPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ConfigReloadStatus {
    Applied,
    Partial,
    Failed,
}

pub fn config_dir() -> PathBuf {
    if let Some(value) = non_empty_env("HERDR_CONFIG_DIR") {
        return PathBuf::from(value);
    }
    if let Some(value) = non_empty_env("XDG_CONFIG_HOME") {
        return PathBuf::from(value).join("herdr");
    }
    if let Some(value) = non_empty_env("HOME") {
        return PathBuf::from(value).join(".config").join("herdr");
    }
    PathBuf::from(".").join(".config").join("herdr")
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

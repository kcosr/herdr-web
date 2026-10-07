use std::path::{Path, PathBuf};

pub(crate) fn derive_label_from_cwd(cwd: &Path) -> String {
    if let Some(repo_root) = git_repo_root(cwd) {
        if let Some(name) = repo_root.file_name().and_then(|name| name.to_str()) {
            return name.to_string();
        }
    }

    if let Ok(home) = std::env::var("HOME") {
        if cwd == Path::new(&home) {
            return "~".to_string();
        }
    }

    cwd.file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| cwd.display().to_string())
}

fn git_repo_root(start: &Path) -> Option<PathBuf> {
    let mut current = if start.is_dir() {
        start.to_path_buf()
    } else {
        start.parent()?.to_path_buf()
    };

    loop {
        if git_dir_for_repo_root(&current)
            .map(|git_dir| git_dir.join("HEAD").is_file())
            .unwrap_or(false)
        {
            return Some(current);
        }

        if !current.pop() {
            return None;
        }
    }
}

fn git_dir_for_repo_root(repo_root: &Path) -> Option<PathBuf> {
    let git_path = repo_root.join(".git");
    if git_path.is_dir() {
        return Some(git_path);
    }

    if let Ok(gitdir) = std::fs::read_to_string(&git_path) {
        if let Some(relative) = gitdir.trim().strip_prefix("gitdir:").map(str::trim) {
            let resolved = Path::new(relative);
            return Some(if resolved.is_absolute() {
                resolved.to_path_buf()
            } else {
                repo_root.join(resolved)
            });
        }
    }

    if path_is_git_dir_layout(repo_root) && git_dir_is_bare(repo_root) {
        return Some(repo_root.to_path_buf());
    }

    None
}

fn path_is_git_dir_layout(path: &Path) -> bool {
    path.join("HEAD").is_file() && path.join("objects").is_dir() && path.join("refs").is_dir()
}

fn git_dir_is_bare(git_dir: &Path) -> bool {
    let Ok(contents) = std::fs::read_to_string(git_dir.join("config")) else {
        return false;
    };

    contents.lines().any(|line| {
        let Some((name, value)) = line.trim().split_once('=') else {
            return false;
        };
        name.trim().eq_ignore_ascii_case("bare") && value.trim().eq_ignore_ascii_case("true")
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = format!(
            "herdr-web-bridge-workspace-{name}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn derive_label_uses_repo_root_for_nested_cwd() {
        let root = temp_test_dir("repo-label");
        let cwd = root.join("nested").join("path");
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        std::fs::create_dir_all(&cwd).unwrap();

        assert_eq!(
            derive_label_from_cwd(&cwd),
            root.file_name().unwrap().to_string_lossy()
        );

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn derive_label_uses_home_marker_without_git_repo() {
        let home = std::env::var("HOME").unwrap();

        assert_eq!(derive_label_from_cwd(Path::new(&home)), "~");
    }

    #[test]
    fn derive_label_falls_back_to_directory_name() {
        // A missing cwd is still labelled by its directory name. Keep it outside
        // the checkout even when TMPDIR is configured inside a working tree.
        let current = std::env::current_dir().unwrap();
        let root = current.ancestors().last().unwrap().join(format!(
            "herdr-web-bridge-plain-label-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert!(!root.exists());
        assert_eq!(
            derive_label_from_cwd(&root),
            root.file_name().unwrap().to_string_lossy()
        );
    }
}

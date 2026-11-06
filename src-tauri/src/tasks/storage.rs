use super::model::SavedState;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};

pub fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

pub fn load(path: &Path) -> Result<SavedState, String> {
    match fs::read_to_string(path) {
        Ok(text) => {
            let state: SavedState = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            if state.schema_version != 1 {
                return Err("Unsupported task calendar data version".into());
            }
            Ok(state)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SavedState::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save(path: &Path, state: &SavedState) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Missing task calendar data directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let text = serde_json::to_string(state).map_err(|e| e.to_string())?;
    crate::write_text_file_atomic_at(path, &text)
}

pub fn read_note(path: &Path) -> Result<String, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        // 元数据检查后路径也可能被替换，打开时再次拒绝链接并避免 FIFO 等待。
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Task sources must be regular files".into());
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    // 与编辑器一致保留 UTF-8 BOM；UTF-16 只读取，不改变源文件编码。
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        if (bytes.len() - 2) % 2 != 0 {
            return Err("Invalid UTF-16 note".into());
        }
        let words: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect();
        return String::from_utf16(&words).map_err(|e| e.to_string());
    }
    String::from_utf8(bytes).map_err(|_| "Task indexing requires UTF-8 or UTF-16 notes".into())
}

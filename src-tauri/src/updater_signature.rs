use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

fn decode_tauri_updater_b64(value: &str) -> Result<String, String> {
    let bytes = BASE64_STANDARD
        .decode(value.trim())
        .map_err(|error| format!("更新签名解码失败: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("更新签名不是合法 UTF-8: {error}"))
}

/// 安装器与发布验收共用验签逻辑，公钥和签名均为 minisign 文本的 Base64。
pub fn verify_update_signature(data: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    if signature.trim().is_empty() {
        return Err("latest.json 缺少 signature，已终止安装。".to_string());
    }
    let pubkey_plain = decode_tauri_updater_b64(pubkey)?;
    let signature_plain = decode_tauri_updater_b64(signature)?;
    let public_key = minisign_verify::PublicKey::decode(&pubkey_plain)
        .map_err(|error| format!("更新公钥无效: {error}"))?;
    let decoded_signature = minisign_verify::Signature::decode(&signature_plain)
        .map_err(|error| format!("更新签名格式非法: {error}"))?;
    public_key
        .verify(data, &decoded_signature, true)
        .map_err(|_| "更新包签名校验失败，已终止安装。".to_string())?;
    Ok(())
}

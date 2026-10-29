use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum AiOperation {
    ChatCompletions,
    Models,
}

#[derive(Serialize)]
pub(crate) struct AiResponse {
    status: u16,
    payload: Value,
}

fn endpoint(base_url: &str, operation: &AiOperation) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base_url.trim()).map_err(|_| "AI_INVALID_URL")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("AI_INVALID_URL".into());
    }
    let suffix = match operation {
        AiOperation::ChatCompletions => "chat/completions",
        AiOperation::Models => "models",
    };
    url.set_path(&format!("{}/{suffix}", url.path().trim_end_matches('/')));
    Ok(url)
}

// 仅支持新增供应商的模型列表和结构化对话，避免 WebView 的跨域限制。
#[tauri::command]
pub(crate) async fn ai_provider_request(
    base_url: String,
    api_key: String,
    operation: AiOperation,
    body: Option<Value>,
) -> Result<AiResponse, String> {
    let url = endpoint(&base_url, &operation)?;
    if api_key.trim().is_empty() {
        return Err("AI_MISSING_KEY".into());
    }
    let timeout = match operation {
        AiOperation::ChatCompletions => 180,
        AiOperation::Models => 60,
    };
    // 禁止跟随重定向，避免把认证信息转发到配置之外的地址。
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|_| "AI_NETWORK_FAILED")?;
    let request = match operation {
        AiOperation::ChatCompletions => client.post(url).json(&body.ok_or("AI_MISSING_BODY")?),
        AiOperation::Models => client.get(url),
    };
    let response = request
        .bearer_auth(api_key.trim())
        .send()
        .await
        .map_err(|error| if error.is_timeout() { "AI_REQUEST_TIMEOUT" } else { "AI_NETWORK_FAILED" })?;
    let status = response.status().as_u16();
    let payload = match response.json::<Value>().await {
        Ok(payload) => payload,
        Err(error) if error.is_timeout() => return Err("AI_REQUEST_TIMEOUT".into()),
        Err(_) => Value::Null,
    };
    Ok(AiResponse { status, payload })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_preserves_vendor_prefix_and_limits_operations() {
        assert_eq!(endpoint(" https://open.bigmodel.cn/api/paas/v4/// ", &AiOperation::ChatCompletions).unwrap().as_str(), "https://open.bigmodel.cn/api/paas/v4/chat/completions");
        assert_eq!(endpoint("http://127.0.0.1:1234/v1", &AiOperation::Models).unwrap().as_str(), "http://127.0.0.1:1234/v1/models");
    }

    #[test]
    fn rejects_insecure_remote_urls_and_embedded_credentials() {
        for url in ["http://example.com", "file:///tmp/test", "https://secret@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/#x"] {
            assert!(endpoint(url, &AiOperation::Models).is_err());
        }
        assert!(serde_json::from_str::<AiOperation>("\"arbitraryPath\"").is_err());
    }
    #[test]
    fn native_requests_authenticate_and_preserve_http_status_without_cors() {
        use std::io::{Read, Write};
        use std::net::TcpListener;
        for (operation, path, status, content) in [
            (AiOperation::Models, "GET /v1/models", "200 OK", r#"{"data":[{"id":"fixture-model"}]}"#),
            (AiOperation::ChatCompletions, "POST /v1/chat/completions", "401 Unauthorized", r#"{"error":{"message":"fixture"}}"#),
            (AiOperation::Models, "GET /v1/models", "302 Found", "not-json"),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut buffer = [0; 8192];
                let count = stream.read(&mut buffer).unwrap();
                let request = String::from_utf8_lossy(&buffer[..count]);
                assert!(request.starts_with(path));
                assert!(request.to_lowercase().contains("authorization: bearer fixture-secret"));
                write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/forbidden\r\nConnection: close\r\n\r\n{content}", content.len()).unwrap();
            });
            let response = tauri::async_runtime::block_on(ai_provider_request(
                format!("http://{address}/v1"), " fixture-secret ".into(), operation, Some(serde_json::json!({"model":"fixture-model"})),
            )).unwrap();
            assert_eq!(response.status.to_string(), status[..3]);
            assert_eq!(response.payload, serde_json::from_str::<Value>(content).unwrap_or(Value::Null));
            server.join().unwrap();
        }
    }

}

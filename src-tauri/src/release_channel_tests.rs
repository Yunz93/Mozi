use super::*;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread;

fn release(tag: &str, prerelease: bool) -> serde_json::Value {
    serde_json::json!({
        "tag_name": tag, "draft": false, "prerelease": prerelease,
        "assets": [{"name": "latest.json"}]
    })
}

fn index(releases: Vec<serde_json::Value>) -> String {
    serde_json::json!({"schemaVersion": 1, "releases": releases}).to_string()
}

struct Server {
    url: String,
    response: Arc<Mutex<(u16, String)>>,
    paths: Arc<Mutex<Vec<String>>>,
    stopped: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

impl Server {
    fn new(status: u16, body: String) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/releases.json", listener.local_addr().unwrap());
        let response = Arc::new(Mutex::new((status, body)));
        let paths = Arc::new(Mutex::new(Vec::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let (reply, requests, done) = (response.clone(), paths.clone(), stopped.clone());
        let worker = thread::spawn(move || {
            for stream in listener.incoming() {
                if done.load(Ordering::SeqCst) {
                    break;
                }
                let mut stream = stream.unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(&stream);
                let mut first_line = String::new();
                reader.read_line(&mut first_line).unwrap();
                let path = first_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("")
                    .to_string();
                requests.lock().unwrap().push(path.clone());
                let (status, body) = if path == "/releases.json" {
                    reply.lock().unwrap().clone()
                } else {
                    (403, "{\"message\":\"API rate limit exceeded\"}".to_owned())
                };
                write!(stream,
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()
                ).unwrap();
            }
        });
        Self {
            url,
            response,
            paths,
            stopped,
            worker: Some(worker),
        }
    }

    fn expire(cache: &IndexCache) {
        cache.0.lock().unwrap().as_mut().unwrap().expires_at = Instant::now();
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        let address = self
            .url
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap();
        let _ = TcpStream::connect(address);
        self.worker.take().unwrap().join().unwrap();
    }
}

#[test]
fn beta_discovery_works_with_rate_limited_api_and_only_reads_static_index() {
    let server = Server::new(200, index(vec![release("v2.3.6-beta.10", true)]));
    let api = reqwest::blocking::get(
        server
            .url
            .replace("releases.json", "repos/Yunz93/Mozi/releases?per_page=100"),
    )
    .unwrap();
    assert_eq!(api.status(), reqwest::StatusCode::FORBIDDEN);
    let result =
        beta_manifest_url_from_index("2.3.5", &server.url, &IndexCache::default()).unwrap();
    assert_eq!(
        result.as_deref(),
        Some("https://github.com/Yunz93/Mozi/releases/download/v2.3.6-beta.10/latest.json")
    );
    assert_eq!(
        *server.paths.lock().unwrap(),
        vec!["/repos/Yunz93/Mozi/releases?per_page=100", "/releases.json"]
    );
}

#[test]
fn semantic_order_filters_drafts_invalid_tags_flags_and_missing_manifests() {
    let mut draft = release("v9.0.0", false);
    draft["draft"] = true.into();
    let mut missing = release("v8.0.0", false);
    missing["assets"] = serde_json::json!([]);
    let server = Server::new(
        200,
        index(vec![
            release("v2.3.6-beta.2", true),
            release("v2.3.6-beta.10", true),
            release("v2.3.5", false),
            release("v7.0.0-beta.1", false),
            release("v7.0.0", true),
            release("v6.0.0-nightly.1", true),
            release("v6.0.0-beta.01", true),
            release("v6.0.0+meta", false),
            release("https://example.com/latest.json", false),
            draft,
            missing,
        ]),
    );
    let cache = IndexCache::default();
    assert!(beta_manifest_url_from_index("2.3.5", &server.url, &cache)
        .unwrap()
        .unwrap()
        .contains("v2.3.6-beta.10/"));
    assert!(
        beta_manifest_url_from_index("2.3.6-beta.10", &server.url, &cache)
            .unwrap()
            .is_none()
    );
    assert!(beta_manifest_url_from_index("2.3.7", &server.url, &cache)
        .unwrap()
        .is_none());
    assert_eq!(server.paths.lock().unwrap().len(), 1);
    *server.response.lock().unwrap() = (
        200,
        index(vec![
            release("v2.3.6-beta.10", true),
            release("v2.3.6", false),
        ]),
    );
    Server::expire(&cache);
    assert!(
        beta_manifest_url_from_index("2.3.6-beta.10", &server.url, &cache)
            .unwrap()
            .unwrap()
            .contains("/v2.3.6/")
    );
    assert!(beta_manifest_url_from_index("2.3.6", &server.url, &cache)
        .unwrap()
        .is_none());
}

#[test]
fn index_failures_are_errors_and_recover_after_short_cooldown() {
    for (status, body, expected) in [
        (404, "{}", "尚未发布"),
        (403, "{}", "HTTP 403"),
        (503, "{}", "HTTP 503"),
        (200, "invalid", "格式无效"),
        (200, "{\"schemaVersion\":2,\"releases\":[]}", "不支持"),
        (200, "{\"schemaVersion\":1}", "格式无效"),
    ] {
        let server = Server::new(status, body.to_string());
        let cache = IndexCache::default();
        let error = beta_manifest_url_from_index("2.3.5", &server.url, &cache).unwrap_err();
        assert!(error.contains(expected), "{error}");
        *server.response.lock().unwrap() = (200, index(vec![release("v2.3.6-beta.1", true)]));
        assert_eq!(
            beta_manifest_url_from_index("2.3.5", &server.url, &cache).unwrap_err(),
            error
        );
        assert_eq!(server.paths.lock().unwrap().len(), 1);
        Server::expire(&cache);
        assert!(beta_manifest_url_from_index("2.3.5", &server.url, &cache)
            .unwrap()
            .is_some());
    }
}

#[test]
fn simultaneous_checks_share_one_fetch_and_cache_expires() {
    let server = Server::new(200, index(vec![release("v2.3.6-beta.1", true)]));
    let cache = Arc::new(IndexCache::default());
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let (cache, barrier, url) = (cache.clone(), barrier.clone(), server.url.clone());
            thread::spawn(move || {
                barrier.wait();
                beta_manifest_url_from_index("2.3.5", &url, &cache).unwrap()
            })
        })
        .collect();
    for worker in workers {
        assert!(worker.join().unwrap().is_some());
    }
    assert_eq!(server.paths.lock().unwrap().len(), 1);
    Server::expire(&cache);
    assert!(beta_manifest_url_from_index("2.3.5", &server.url, &cache)
        .unwrap()
        .is_some());
    assert_eq!(server.paths.lock().unwrap().len(), 2);
}

#[test]
fn invalid_local_versions_and_unsafe_tags_do_not_make_requests() {
    let server = Server::new(200, index(vec![]));
    assert!(
        beta_manifest_url_from_index("not-a-version", &server.url, &IndexCache::default()).is_err()
    );
    assert!(server.paths.lock().unwrap().is_empty());
    for tag in ["../../x", "v2.3.6-beta.0", "v2.3.6-beta.01", "v2.3.6+meta"] {
        assert!(manifest_url_for_tag(tag).is_err());
    }
}

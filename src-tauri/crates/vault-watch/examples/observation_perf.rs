//! Synthetic broker benchmark. This does not measure WebView, IPC or UI latency.
use mozi_vault_watch::{Broker, Observer, Subscription};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};
struct Fixture(PathBuf);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn list_arg(name: &str, default: &[usize]) -> Vec<usize> {
    let args: Vec<_> = std::env::args().collect();
    args.iter()
        .position(|a| a == name)
        .map(|at| {
            args.get(at + 1)
                .expect("argument value")
                .split(',')
                .map(|v| {
                    let n: usize = v.parse().expect("positive integer");
                    assert!(n > 0 && n <= 100_000);
                    n
                })
                .collect()
        })
        .unwrap_or_else(|| default.to_vec())
}
fn wait(broker: &Broker, sub: &Subscription, after: u64, path: &Path) -> u64 {
    let start = Instant::now();
    loop {
        let page = broker
            .changes(&sub.subscription_id, &sub.epoch, after)
            .unwrap();
        if page.rescan_required || page.changes.iter().any(|c| c.path == path) {
            return page.seq;
        }
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "native event timed out"
        );
        thread::sleep(Duration::from_millis(10));
    }
}
fn percentile(values: &mut [f64], p: f64) -> f64 {
    values.sort_by(|a, b| a.total_cmp(b));
    values[((values.len() as f64 * p).ceil() as usize).saturating_sub(1)]
}
fn run(count: usize, windows: usize, rounds: usize, idle_ms: usize) -> Value {
    let path = std::env::temp_dir().join(format!("mozi-watch-perf-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&path).unwrap();
    let fixture = Fixture(fs::canonicalize(path).unwrap());
    for i in 0..count {
        fs::write(
            fixture.0.join(format!("note-{i}.md")),
            format!("# Note {i}\n\n- [ ] Synthetic task\n"),
        )
        .unwrap();
    }
    let broker = Arc::new(Broker::default());
    let mut background = Observer::new(broker.clone());
    background.set_roots([fixture.0.clone()]).unwrap();
    let subs: Vec<_> = (0..windows * 2)
        .map(|_| broker.subscribe(&fixture.0, true).unwrap())
        .collect();
    assert_eq!(broker.stats().watchers, 1);
    // FSEvents may replay the directory creation. Allow it to settle before idle.
    thread::sleep(Duration::from_secs(2));
    let sub = &subs[0];
    let mut seq = broker
        .changes(&sub.subscription_id, &sub.epoch, sub.seq)
        .unwrap()
        .seq;
    let idle_start = broker.stats().batches;
    let idle_started = Instant::now();
    while idle_started.elapsed() < Duration::from_millis(idle_ms as u64) {
        background.poll().unwrap();
        thread::sleep(Duration::from_millis(1000.min(idle_ms) as u64));
    }
    let idle_batches = broker.stats().batches - idle_start;
    let idle = broker
        .changes(&sub.subscription_id, &sub.epoch, seq)
        .unwrap();
    seq = idle.seq;
    let target = fixture.0.join("note-0.md");
    let mut latency = Vec::new();
    let batches_before = broker.stats().batches;
    for i in 0..rounds {
        let start = Instant::now();
        fs::write(&target, format!("# Changed {i}\n\n- [ ] Synthetic task\n")).unwrap();
        seq = wait(&broker, sub, seq, &target);
        latency.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    let p50 = percentile(&mut latency, 0.50);
    let p95 = percentile(&mut latency, 0.95);
    let batch_count = broker.stats().batches - batches_before;
    // One scan samples the legacy directory+task metadata workload. Extrapolated
    // cadence below is a model, not measured application CPU/power consumption.
    let scan = Instant::now();
    let mut entries = 0;
    for entry in fs::read_dir(&fixture.0).unwrap() {
        entry.unwrap().metadata().unwrap();
        entries += 1;
    }
    let scan_ms = scan.elapsed().as_secs_f64() * 1000.0;
    let refs = broker.stats().subscriptions;
    let overflows = broker.stats().overflows;
    for sub in subs {
        broker.unsubscribe(&sub.subscription_id);
    }
    let watchers_after_windows_close = broker.stats().watchers;
    assert_eq!(watchers_after_windows_close, 1);
    drop(background);
    assert_eq!(broker.stats().watchers, 0);
    json!({ "notes": count, "modeledWindows": windows, "subscriptions": refs,
        "sharedWatchers": 1, "idleSeconds": idle_ms as f64 / 1000.0, "idleBatches": idle_batches,
        "nativeRecursiveScansAfterInitialization": 0,
        "journalVisibleLatencyMs": { "p50": p50, "p95": p95, "samples": rounds },
        "editBatches": batch_count, "overflows": overflows,
        "legacySingleMetadataScanMs": scan_ms, "legacyEntriesPerScan": entries,
        "modeledLegacyRecursiveScansPerMinute": windows * 30 + 12,
        "watchersAfterWindowsClose": watchers_after_windows_close, "watchersAfterAllClose": 0 })
}
fn main() {
    let counts = list_arg("--counts", &[100, 1000, 10000]);
    let windows = list_arg("--windows", &[1, 2, 5]);
    let rounds = list_arg("--rounds", &[8])[0];
    let idle_ms = list_arg("--idle-ms", &[1000])[0];
    let mut results = Vec::new();
    for count in counts {
        for &windows in &windows {
            results.push(run(count, windows, rounds, idle_ms));
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemaVersion": 1, "scope": "synthetic native broker; excludes application IPC and UI",
            "os": std::env::consts::OS, "arch": std::env::consts::ARCH, "results": results
        }))
        .unwrap()
    );
}

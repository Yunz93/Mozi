#[path = "../src/updater_signature.rs"]
mod updater_signature;

fn main() {
    if let Err(error) = verify() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn verify() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        return Err("Usage: verify-updater <update-package> <signature-file>".into());
    }
    // 公钥只取同一源码版本的应用配置，不能由更新清单或环境变量替换。
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .map_err(|error| error.to_string())?;
    let pubkey = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Application updater public key is missing")?;
    let bytes = std::fs::read(&args[0]).map_err(|error| error.to_string())?;
    let signature = std::fs::read_to_string(&args[1]).map_err(|error| error.to_string())?;
    updater_signature::verify_update_signature(&bytes, &signature, pubkey)?;
    println!(
        "Verified updater signature: {}",
        std::path::Path::new(&args[0]).display()
    );
    Ok(())
}

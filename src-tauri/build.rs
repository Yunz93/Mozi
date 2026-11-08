fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/tasks/calendar_bridge.m");
        cc::Build::new()
            .file("src/tasks/calendar_bridge.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("mozi_calendar");
        println!("cargo:rerun-if-changed=src/native_notification_bridge.m");
        cc::Build::new()
            .file("src/native_notification_bridge.m")
            .flag("-fobjc-arc")
            .compile("mozi_notifications");
        println!("cargo:rustc-link-lib=framework=EventKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
    tauri_build::build()
}

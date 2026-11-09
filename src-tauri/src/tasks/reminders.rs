use super::model::{Preferences, Task};
use chrono::{Local, NaiveDate, NaiveTime, TimeZone};

pub fn normalize_times(times: Vec<String>) -> Result<Vec<String>, String> {
    if times.is_empty() || times.len() > 1440 {
        return Err("Set at least one reminder time.".into());
    }
    let mut result = Vec::new();
    for time in times {
        if time.len() != 5 || NaiveTime::parse_from_str(&time, "%H:%M").is_err() {
            return Err("Reminder times must use HH:mm.".into());
        }
        result.push(time);
    }
    result.sort();
    result.dedup();
    Ok(result)
}

pub fn points(task: &Task, preferences: &Preferences) -> Vec<(String, i64)> {
    if task.completed || task.date_error {
        return Vec::new();
    }
    let base = task.notification_key();
    if task.time.is_some() {
        return task
            .reminder_at
            .map(|at| vec![(base, at)])
            .unwrap_or_default();
    }
    let Some(date) = task
        .date
        .as_deref()
        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
    else {
        return Vec::new();
    };
    preferences
        .reminder_times
        .iter()
        .filter_map(|time| {
            let time_value = NaiveTime::parse_from_str(time, "%H:%M").ok()?;
            // 夏令时跳变时不猜测一个错误的本地时间。
            let at = Local
                .from_local_datetime(&date.and_time(time_value))
                .single()?
                .timestamp_millis();
            // 保留旧版 09:00 的记录键，升级后不会再次发送已经送达的提醒。
            let key = if time == "09:00" {
                base.clone()
            } else {
                super::storage::hash(&format!("{base}\0{time}"))
            };
            Some((key, at))
        })
        .collect()
}

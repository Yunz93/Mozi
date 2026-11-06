use super::{model::Task, storage::hash};
use chrono::{Days, Local, NaiveDate, NaiveTime, TimeZone};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::{ops::Range, path::Path};

fn frontmatter_end(text: &str) -> usize {
    let offset = if text.starts_with('\u{feff}') {
        '\u{feff}'.len_utf8()
    } else {
        0
    };
    let body = &text[offset..];
    if !body.starts_with("---\n") && !body.starts_with("---\r\n") {
        return offset;
    }
    let mut end = offset;
    for (index, line) in body.split_inclusive('\n').enumerate() {
        end += line.len();
        if index > 0 && matches!(line.trim(), "---" | "...") {
            return end;
        }
    }
    text.len()
}

fn plain_title(text: &str) -> String {
    Parser::new(text)
        .filter_map(|event| match event {
            Event::Text(text) | Event::Code(text) => Some(text.into_string()),
            Event::SoftBreak | Event::HardBreak => Some(" ".into()),
            _ => None,
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

struct DateMark {
    range: Range<usize>,
    date: Option<String>,
    time: Option<String>,
    reminder: Option<i64>,
    deadline: Option<i64>,
    invalid: bool,
}

fn date_mark(text: &str, ignored: &[Range<usize>], origin: usize) -> Option<DateMark> {
    let mut marks = Vec::new();
    for (at, character) in text.char_indices() {
        if character != '@'
            || (at > 0 && !text[..at].ends_with(char::is_whitespace))
            || ignored.iter().any(|r| r.contains(&(origin + at)))
        {
            continue;
        }
        let tail = &text[at + 1..];
        if !tail.starts_with(|c: char| c.is_ascii_digit())
            && !tail.starts_with("今天")
            && !tail.starts_with("明天")
        {
            continue;
        }
        let date_len = tail.find(char::is_whitespace).unwrap_or(tail.len());
        let raw_date = &tail[..date_len];
        let rest = &tail[date_len..];
        let spaces = rest.len() - rest.trim_start().len();
        let rest = rest.trim_start();
        let time_len = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let raw_time = &rest[..time_len];
        let has_time = !raw_time.is_empty()
            && (raw_time.contains(':') || raw_time.starts_with(|c: char| c.is_ascii_digit()));
        let end = at + 1 + date_len + if has_time { spaces + time_len } else { 0 };
        let parsed_date = if raw_date.len() == 10
            && raw_date.as_bytes().get(4) == Some(&b'-')
            && raw_date.as_bytes().get(7) == Some(&b'-')
        {
            NaiveDate::parse_from_str(raw_date, "%Y-%m-%d").ok()
        } else {
            None
        };
        let parsed_time = if has_time {
            if raw_time.len() == 5 && raw_time.as_bytes().get(2) == Some(&b':') {
                NaiveTime::parse_from_str(raw_time, "%H:%M").ok()
            } else {
                None
            }
        } else {
            NaiveTime::from_hms_opt(9, 0, 0)
        };
        let reminder = parsed_date
            .zip(parsed_time)
            .and_then(|(date, time)| Local.from_local_datetime(&date.and_time(time)).single())
            .map(|date| date.timestamp_millis());
        let deadline = if has_time {
            reminder
        } else {
            parsed_date
                .and_then(|date| date.checked_add_days(Days::new(1)))
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .and_then(|date| Local.from_local_datetime(&date).single())
                .map(|date| date.timestamp_millis())
        };
        marks.push(DateMark {
            range: at..end,
            date: parsed_date.map(|_| raw_date.to_string()),
            time: if has_time && parsed_time.is_some() {
                Some(raw_time.to_string())
            } else {
                None
            },
            reminder,
            deadline,
            invalid: reminder.is_none() || deadline.is_none(),
        });
    }
    if marks.len() > 1 {
        return Some(DateMark {
            range: 0..0,
            date: None,
            time: None,
            reminder: None,
            deadline: None,
            invalid: true,
        });
    }
    marks.pop()
}

pub fn parse(text: &str, vault: &Path, path: &Path) -> Vec<Task> {
    let origin = frontmatter_end(text);
    let body = &text[origin..];
    let mut markers = Vec::new();
    let mut ignored = Vec::<Range<usize>>::new();
    let mut protected_start = None;
    let mut protected_depth = 0usize;
    let mut item_depth = 0usize;
    for (event, range) in Parser::new_ext(body, Options::ENABLE_TASKLISTS).into_offset_iter() {
        let range = range.start + origin..range.end + origin;
        match event {
            Event::Start(Tag::Item) => item_depth += 1,
            Event::End(TagEnd::Item) => item_depth = item_depth.saturating_sub(1),
            Event::TaskListMarker(completed) if item_depth > 0 => markers.push((range, completed)),
            Event::Start(Tag::Link { .. } | Tag::Image { .. }) => {
                if protected_depth == 0 {
                    protected_start = Some(range.start);
                }
                protected_depth += 1;
            }
            Event::End(TagEnd::Link | TagEnd::Image) => {
                protected_depth = protected_depth.saturating_sub(1);
                if protected_depth == 0 {
                    if let Some(start) = protected_start.take() {
                        ignored.push(start..range.end);
                    }
                }
            }
            Event::Code(_) | Event::Html(_) | Event::InlineHtml(_) => ignored.push(range),
            _ => {}
        }
    }
    let vault_path = vault.to_string_lossy().into_owned();
    let file_path = path.to_string_lossy().into_owned();
    let relative_path = path
        .strip_prefix(vault)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    // 一次建立行号和 UTF-16 起点，避免每项待办反复扫描整段前文。
    let mut lines = vec![(0usize, 0usize)];
    let mut utf16 = 0;
    for (offset, character) in text.char_indices() {
        utf16 += character.len_utf16();
        if character == '\n' {
            lines.push((offset + 1, utf16));
        }
    }
    markers
        .into_iter()
        .map(|(marker, completed)| {
            let line = lines
                .partition_point(|(start, _)| *start <= marker.start)
                .saturating_sub(1);
            let (start, start_utf16) = lines[line];
            let end = lines
                .get(line + 1)
                .map_or(text.len(), |(start, _)| start - 1);
            let first_line = text[marker.end..end].trim_end_matches('\r');
            let mark = date_mark(first_line, &ignored, marker.end);
            let title_source = match &mark {
                Some(mark) if !mark.invalid => format!(
                    "{} {}",
                    &first_line[..mark.range.start],
                    &first_line[mark.range.end..]
                ),
                _ => first_line.to_string(),
            };
            let title = plain_title(&title_source);
            let id = hash(&format!("{file_path}\0{start}\0{title}"));
            Task {
                id,
                vault_path: vault_path.clone(),
                file_path: file_path.clone(),
                relative_path: relative_path.clone(),
                title,
                completed,
                date: mark.as_ref().and_then(|m| m.date.clone()),
                time: mark.as_ref().and_then(|m| m.time.clone()),
                reminder_at: mark
                    .as_ref()
                    .and_then(|m| if m.invalid { None } else { m.reminder }),
                deadline_at: mark
                    .as_ref()
                    .and_then(|m| if m.invalid { None } else { m.deadline }),
                date_error: mark.as_ref().is_some_and(|m| m.invalid),
                line: line + 1,
                start: start_utf16,
                end: start_utf16 + text[start..end].encode_utf16().count(),
                raw_line: text[start..end]
                    .trim_end_matches('\r')
                    .trim_start_matches('\u{feff}')
                    .to_string(),
                available: true,
            }
        })
        .collect()
}

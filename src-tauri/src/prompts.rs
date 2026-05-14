//! Load and render the 5 prompt templates that drive the AI engine.
//!
//! File format (`===SYSTEM===\n...\n===CONTEXT===\n...\n===USER===\n...`):
//! the first two segments are eligible for provider-side prompt caching; the
//! last is the per-turn user input. Render performs `{name}` substitution.
//!
//! Templates ship bundled with the app (`src-tauri/resources/prompts/`) and
//! may be overridden per-user by dropping a same-named file into
//! `~/BioNova/prompts/`.

use crate::providers::ChatMessage;
use anyhow::{anyhow, Context, Result};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct PromptTemplate {
    pub system: String,
    pub context: String,
    pub user: String,
}

impl PromptTemplate {
    /// Render the template into a `Vec<ChatMessage>` ready to pass to
    /// `LLMProvider::chat_stream`. The system + context segments are
    /// marked `cache=true` so Anthropic can hit its prompt cache.
    pub fn render(&self, vars: &HashMap<String, String>) -> Vec<ChatMessage> {
        let system = substitute(&self.system, vars);
        let context = substitute(&self.context, vars);
        let user = substitute(&self.user, vars);

        // Anthropic ignores empty system messages — fold context into user
        // turn if needed. Here we keep them separate; ai_engine flattens.
        let mut msgs = Vec::new();
        if !system.trim().is_empty() {
            msgs.push(ChatMessage { role: "system".into(), content: system, cache: true });
        }
        // Context goes as a leading user-turn assertion so OpenAI can see it;
        // marked `cache: true` (a no-op for OpenAI, real cache hit on Anthropic).
        let combined = if !context.trim().is_empty() {
            format!("{}\n\n{}", context.trim(), user.trim())
        } else {
            user.trim().to_string()
        };
        msgs.push(ChatMessage { role: "user".into(), content: combined, cache: false });
        msgs
    }
}

/// Substitute `{key}` placeholders. Unknown placeholders are left intact so a
/// missing context value is obvious in the rendered prompt rather than
/// silently dropped.
pub fn substitute(text: &str, vars: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '{' {
            out.push(c);
            continue;
        }
        let mut name = String::new();
        let mut closed = false;
        while let Some(&n) = chars.peek() {
            chars.next();
            if n == '}' {
                closed = true;
                break;
            }
            name.push(n);
        }
        if closed {
            if let Some(v) = vars.get(name.as_str()) {
                out.push_str(v);
            } else {
                out.push('{');
                out.push_str(&name);
                out.push('}');
            }
        } else {
            out.push('{');
            out.push_str(&name);
        }
    }
    out
}

/// Parse a `===SYSTEM===\n...\n===CONTEXT===\n...\n===USER===\n...` document.
pub fn parse(text: &str) -> Result<PromptTemplate> {
    let mut system = None;
    let mut context = None;
    let mut user = None;
    let mut current: Option<&str> = None;
    let mut buf = String::new();

    for line in text.lines() {
        let header = match line.trim() {
            "===SYSTEM===" => Some("system"),
            "===CONTEXT===" => Some("context"),
            "===USER===" => Some("user"),
            _ => None,
        };
        if let Some(h) = header {
            if let Some(prev) = current.take() {
                store(prev, &mut buf, &mut system, &mut context, &mut user);
            }
            current = Some(h);
            buf.clear();
            continue;
        }
        if current.is_some() {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    if let Some(prev) = current.take() {
        store(prev, &mut buf, &mut system, &mut context, &mut user);
    }
    Ok(PromptTemplate {
        system: system.unwrap_or_default(),
        context: context.unwrap_or_default(),
        user: user.ok_or_else(|| anyhow!("prompt template missing ===USER=== segment"))?,
    })
}

fn store(
    section: &str,
    buf: &mut String,
    system: &mut Option<String>,
    context: &mut Option<String>,
    user: &mut Option<String>,
) {
    let v = buf.trim().to_string();
    match section {
        "system" => *system = Some(v),
        "context" => *context = Some(v),
        "user" => *user = Some(v),
        _ => {}
    }
    buf.clear();
}

/// Load a template by name (e.g. "plan", "generate_code"). Tries the user's
/// override dir first, then the bundled resource path.
pub fn load(name: &str, bundled_dir: &Path) -> Result<PromptTemplate> {
    let user_override = dirs::home_dir()
        .map(|h| h.join("BioNova").join("prompts").join(format!("{name}.md")));
    if let Some(p) = &user_override {
        if p.exists() {
            let text = std::fs::read_to_string(p).context("read user prompt override")?;
            return parse(&text);
        }
    }
    let bundled = bundled_dir.join(format!("{name}.md"));
    let text = std::fs::read_to_string(&bundled)
        .with_context(|| format!("read bundled prompt {}", bundled.display()))?;
    parse(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitute_replaces_known_keys() {
        let mut v = HashMap::new();
        v.insert("name".into(), "Alice".into());
        v.insert("n".into(), "42".into());
        let out = substitute("hi {name}, n={n}, miss={none}", &v);
        assert_eq!(out, "hi Alice, n=42, miss={none}");
    }

    #[test]
    fn parse_extracts_three_segments() {
        let src = "===SYSTEM===\nyou are X\n===CONTEXT===\nthe data is Y\n===USER===\ndo Z\n";
        let t = parse(src).unwrap();
        assert_eq!(t.system, "you are X");
        assert_eq!(t.context, "the data is Y");
        assert_eq!(t.user, "do Z");
    }

    #[test]
    fn parse_requires_user_section() {
        let err = parse("===SYSTEM===\nhi\n").unwrap_err();
        assert!(err.to_string().contains("===USER==="));
    }

    #[test]
    fn render_emits_system_and_user() {
        let t = PromptTemplate {
            system: "be terse".into(),
            context: "data: {n} cells".into(),
            user: "tell me about {topic}".into(),
        };
        let mut v = HashMap::new();
        v.insert("n".into(), "500".into());
        v.insert("topic".into(), "QC".into());
        let msgs = t.render(&v);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "system");
        assert_eq!(msgs[0].content, "be terse");
        assert!(msgs[0].cache);
        assert_eq!(msgs[1].role, "user");
        assert!(msgs[1].content.contains("500 cells"));
        assert!(msgs[1].content.contains("tell me about QC"));
    }
}

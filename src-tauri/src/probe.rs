//! Tiny "test model capability" probe. No persistence, no pricing — just runs
//! 4 short tasks and reports per-dimension scores. Called from Settings.

use crate::ai_engine;
use crate::config::AppConfig;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeReport {
    pub plan_score: f32,
    pub code_score: f32,
    pub fix_score: f32,
    pub chinese_score: f32,
    pub overall_score: f32,
    pub notes: Vec<String>,
}

pub async fn run(cfg: &AppConfig, prompts_dir: &PathBuf) -> Result<ProbeReport> {
    let mut notes = Vec::new();
    let mut plan_score = 0.0;
    let mut code_score = 0.0;
    let mut fix_score = 0.0;
    let mut chinese_score = 0.0;

    // 1) Plan: ask for a 5-card plan on toy metadata, verify JSON array shape.
    let mut v = HashMap::new();
    v.insert("n_obs".into(), "2700".into());
    v.insert("n_vars".into(), "32738".into());
    v.insert("obs_columns".into(), "sample,batch".into());
    v.insert("var_columns".into(), "gene_symbol".into());
    v.insert("layers".into(), "counts".into());
    v.insert("source_hint".into(), "10x PBMC 3k".into());
    v.insert("user_intent".into(), "".into());
    match ai_engine::run_task(cfg, prompts_dir, ai_engine::Task::Plan, v, 1024).await {
        Ok(r) => {
            match ai_engine::parse_plan_response(&r.text) {
                Ok(cards) if !cards.is_empty() => {
                    plan_score = if cards.len() >= 5 && cards.len() <= 10 { 1.0 } else { 0.6 };
                }
                Ok(_) => {
                    plan_score = 0.3;
                    notes.push("plan: parsed but empty".into());
                }
                Err(e) => {
                    plan_score = 0.0;
                    notes.push(format!("plan: JSON parse failed: {e}"));
                }
            }
        }
        Err(e) => {
            notes.push(format!("plan: call failed: {e}"));
        }
    }

    // 2) Code: ask for QC code; check it imports scanpy and references adata.
    let mut v = HashMap::new();
    v.insert("card_id".into(), "qc".into());
    v.insert("card_title".into(), "质控".into());
    v.insert("prev_summaries".into(), "(none)".into());
    v.insert("adata_state".into(), "fresh".into());
    v.insert("scanpy_version".into(), "1.10".into());
    match ai_engine::run_task(cfg, prompts_dir, ai_engine::Task::GenerateCode, v, 1024).await {
        Ok(r) => {
            let code = ai_engine::strip_code_fences(&r.text);
            let has_scanpy = code.contains("scanpy") || code.contains("sc.");
            let has_adata = code.contains("adata");
            code_score = match (has_scanpy, has_adata) {
                (true, true) => 1.0,
                (true, false) | (false, true) => 0.5,
                _ => 0.0,
            };
            if code_score < 1.0 {
                notes.push("code: missing scanpy or adata reference".into());
            }
        }
        Err(e) => notes.push(format!("code: call failed: {e}")),
    }

    // 3) Fix: feed a toy error; check that the reply differs from input.
    let original = "sc.tl.louvain(adata)";
    let mut v = HashMap::new();
    v.insert("card_id".into(), "cluster".into());
    v.insert("original_code".into(), original.into());
    v.insert("error_message".into(), "AttributeError: louvain removed; use leiden".into());
    v.insert("var_snapshot".into(), "adata".into());
    v.insert("prior_attempts".into(), "(none)".into());
    match ai_engine::run_task(cfg, prompts_dir, ai_engine::Task::FixError, v, 512).await {
        Ok(r) => {
            let fixed = ai_engine::strip_code_fences(&r.text);
            let differs = fixed.trim() != original;
            let uses_leiden = fixed.contains("leiden");
            fix_score = match (differs, uses_leiden) {
                (true, true) => 1.0,
                (true, false) => 0.5,
                _ => 0.0,
            };
            if fix_score < 1.0 {
                notes.push("fix: didn't switch louvain → leiden".into());
            }
        }
        Err(e) => notes.push(format!("fix: call failed: {e}")),
    }

    // 4) Chinese: ask interpret; check reply contains CJK characters.
    let mut v = HashMap::new();
    v.insert("card_id".into(), "qc".into());
    v.insert("card_title".into(), "质控".into());
    v.insert("outputs".into(), "Saved 7821 cells (-8.6%), median mt 4.2%".into());
    match ai_engine::run_task(cfg, prompts_dir, ai_engine::Task::Interpret, v, 256).await {
        Ok(r) => {
            let has_cjk = r.text.chars().any(|c| {
                let cp = c as u32;
                (0x4E00..=0x9FFF).contains(&cp) // CJK Unified Ideographs
            });
            chinese_score = if has_cjk { 1.0 } else { 0.2 };
            if !has_cjk {
                notes.push("interpret: no Chinese characters in reply".into());
            }
        }
        Err(e) => notes.push(format!("interpret: call failed: {e}")),
    }

    let overall_score =
        (plan_score * 0.30 + code_score * 0.30 + fix_score * 0.25 + chinese_score * 0.15) * 100.0;

    Ok(ProbeReport {
        plan_score: plan_score * 100.0,
        code_score: code_score * 100.0,
        fix_score: fix_score * 100.0,
        chinese_score: chinese_score * 100.0,
        overall_score,
        notes,
    })
}

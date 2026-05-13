use anyhow::{Context, Result};
use keyring::Entry;

const SERVICE: &str = "io.bionova.desktop";

pub fn set_secret(key: &str, value: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, key).context("keyring entry")?;
    entry.set_password(value).context("set_password")?;
    Ok(())
}

pub fn get_secret(key: &str) -> Result<Option<String>> {
    let entry = Entry::new(SERVICE, key).context("keyring entry")?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e).context("get_password"),
    }
}

pub fn delete_secret(key: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, key).context("keyring entry")?;
    match entry.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e).context("delete_password"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests touch the real OS keychain. Unique keys per test, cleanup at end.
    // Windows CI (the production target) exercises Windows Credential Manager.
    // On Linux dev boxes without secret-service running, these tests may fail
    // with backend errors; this is documented in the plan as acceptable.

    #[test]
    #[cfg_attr(not(target_os = "windows"), ignore = "needs Windows Credential Manager")]
    fn set_get_roundtrip() {
        let key = format!("test-roundtrip-{}", uuid::Uuid::new_v4());
        set_secret(&key, "sk-test-1234").unwrap();
        let got = get_secret(&key).unwrap();
        assert_eq!(got.as_deref(), Some("sk-test-1234"));
        delete_secret(&key).unwrap();
    }

    #[test]
    #[cfg_attr(not(target_os = "windows"), ignore = "needs Windows Credential Manager")]
    fn missing_returns_none() {
        let key = format!("test-missing-{}", uuid::Uuid::new_v4());
        let got = get_secret(&key).unwrap();
        assert_eq!(got, None);
    }

    #[test]
    #[cfg_attr(not(target_os = "windows"), ignore = "needs Windows Credential Manager")]
    fn delete_missing_is_ok() {
        let key = format!("test-del-missing-{}", uuid::Uuid::new_v4());
        delete_secret(&key).unwrap();
    }
}

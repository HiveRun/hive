// lib.rs

#[cfg(target_os = "android")]
#[allow(non_snake_case)]
pub mod android;

#[cfg(mobile)]
pub mod mobile;
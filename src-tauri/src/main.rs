#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

use auto_launch::AutoLaunchBuilder;
use dotenv::dotenv;
use menu::DbRecentHistoryItems;
use opener;
// use schema::clipboard_history::history_id;
use services::settings_service::insert_or_update_setting_by_name;
use services::utils;
use services::utils::debug_output;
use tokio::time::sleep;
// use simple_cache::SimpleCache;
use std::env::current_exe;
use std::fs;
use std::thread;
use tauri::Menu;
use tauri::MenuItem;
use tauri::Submenu;

#[cfg(target_os = "macos")]
use window_ext::WindowToolBar;

#[cfg(target_os = "macos")]
mod window_ext;

mod clipboard;
mod commands;
mod constants;
mod cron_jobs;
mod db;
mod helpers;
mod menu;
mod metadata;
mod models;
mod schema;
mod services;
mod simple_cache;

use crate::commands::clipboard_commands::copy_paste_clip_item_from_menu;
use crate::commands::clipboard_commands::write_image_to_clipboard;
use crate::menu::DbItems;
use crate::models::Setting;
use crate::services::history_service;
use crate::services::settings_service::get_all_settings;
use crate::services::translations::translations::Translations;
use crate::services::utils::remove_special_bbcode_tags;
use crate::services::utils::{apply_global_templates, ensure_url_or_email_prefix};
use commands::backup_restore_commands;
use commands::clipboard_commands;
use commands::collections_commands;
use commands::format_converter_commands;
use commands::history_commands;
use commands::items_commands;
use commands::link_metadata_commands;
use commands::request_commands;
use commands::security_commands;
use commands::shell_commands;
use commands::tabs_commands;
use commands::translations_commands;
use commands::user_settings_command;

use db::AppConstants;
use mouse_position::mouse_position::Mouse;
use serde::Deserialize;
use std::collections::HashMap;

use serde::Serialize;
use tauri::ClipboardManager;
use tauri::Manager;
use tauri::SystemTray;
use tauri::SystemTrayEvent;
// use tauri_plugin_positioner::{Position, WindowExt};

use fns::debounce;
use inputbot::{BlockInput, KeybdKey, KeybdKey::*, MouseButton};
use once_cell::sync::Lazy;
use std::ptr;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration as StdDuration;
use std::time::Instant;
use tokio::sync::Mutex as TokioMutex;
use window_state::AppHandleExt;
use window_state::StateFlags;

static QUICKPASTE_SEARCH_ACTIVE: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));
static QUICKPASTE_PREVIOUS_FOREGROUND_WINDOW: Lazy<Mutex<isize>> = Lazy::new(|| Mutex::new(0));
#[cfg(target_os = "windows")]
static QUICKPASTE_HELD_NUMBER_INDEXES: Lazy<Mutex<Vec<usize>>> =
  Lazy::new(|| Mutex::new(Vec::new()));
#[cfg(target_os = "windows")]
static QUICKPASTE_SELECTED_NUMBER_INDEXES: Lazy<Mutex<Vec<usize>>> =
  Lazy::new(|| Mutex::new(Vec::new()));

const QUICKPASTE_FOCUS_RESTORE_DELAY_MS: u64 = 35;
const QUICKPASTE_SEQUENCE_PASTE_DELAY_MS: u64 = 25;
const APP_TRAY_ID: &str = "app-tray";

#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
use cocoa::{appkit::NSApplication, base::nil};

#[cfg(target_os = "windows")]
use winapi::shared::windef::POINT;
#[cfg(target_os = "windows")]
use winapi::um::winuser::GetCursorPos;
#[cfg(target_os = "windows")]
use winapi::um::winuser::{GetForegroundWindow, SetForegroundWindow};

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct QuickPasteWindowsMaterial {
  acrylic_opacity: i32,
  acrylic_color_depth: i32,
}

#[cfg(target_os = "windows")]
fn quickpaste_setting_int(
  settings_map: &HashMap<String, Setting>,
  name: &str,
  default_value: i32,
) -> i32 {
  settings_map
    .get(name)
    .and_then(|setting| setting.value_int)
    .unwrap_or(default_value)
}

#[cfg(target_os = "windows")]
fn quickpaste_windows_material_from_settings(
  settings_map: &HashMap<String, Setting>,
) -> QuickPasteWindowsMaterial {
  QuickPasteWindowsMaterial {
    acrylic_opacity: quickpaste_setting_int(settings_map, "quickPasteAcrylicOpacity", 86)
      .clamp(25, 100),
    acrylic_color_depth: quickpaste_setting_int(
      settings_map,
      "quickPasteAcrylicColorDepth",
      100,
    )
    .clamp(0, 100),
  }
}

#[cfg(target_os = "windows")]
fn quickpaste_acrylic_tint(is_dark: bool, material: QuickPasteWindowsMaterial) -> u32 {
  let alpha = ((material.acrylic_opacity * 255) / 100) as u32;
  let depth = material.acrylic_color_depth;
  let channel = if is_dark {
    249 - ((249 - 17) * depth / 100)
  } else {
    255 - ((255 - 249) * depth / 100)
  } as u32;

  (alpha << 24) | (channel << 16) | (channel << 8) | channel
}

#[cfg(target_os = "windows")]
fn apply_quickpaste_windows_backdrop(
  window: &tauri::Window,
  is_dark: bool,
  material: QuickPasteWindowsMaterial,
) -> Result<(), String> {
  use windows_sys::Win32::Graphics::Dwm::DwmSetWindowAttribute;
  use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};

  fn check_dwm_result(result: i32, attribute_name: &str) -> Result<(), String> {
    if result < 0 {
      return Err(format!(
        "Failed to apply Quick Paste DWM attribute {}: HRESULT {:#010x}",
        attribute_name, result
      ));
    }

    Ok(())
  }

  #[repr(C)]
  struct AccentPolicy {
    accent_state: u32,
    accent_flags: u32,
    gradient_color: u32,
    animation_id: u32,
  }

  #[repr(C)]
  struct WindowCompositionAttribData {
    attrib: u32,
    data: *mut std::ffi::c_void,
    size_of_data: usize,
  }

  type SetWindowCompositionAttributeFn =
    unsafe extern "system" fn(isize, *mut WindowCompositionAttribData) -> i32;

  const WCA_ACCENT_POLICY: u32 = 19;
  const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;
  const DWMWA_USE_IMMERSIVE_DARK_MODE: u32 = 20;
  const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
  const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
  const DWMWCP_ROUND: u32 = 2;
  const DWMSBT_TRANSIENTWINDOW: u32 = 3;

  let hwnd = window.hwnd().map_err(|e| e.to_string())?;
  let immersive_dark_mode = if is_dark { 1u32 } else { 0u32 };
  let corner_preference = DWMWCP_ROUND;
  let backdrop_type = DWMSBT_TRANSIENTWINDOW;
  let accent_tint = quickpaste_acrylic_tint(is_dark, material);

  unsafe {
    check_dwm_result(
      DwmSetWindowAttribute(
        hwnd.0 as _,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
        &immersive_dark_mode as *const _ as _,
        std::mem::size_of_val(&immersive_dark_mode) as u32,
      ),
      "DWMWA_USE_IMMERSIVE_DARK_MODE",
    )?;

    check_dwm_result(
      DwmSetWindowAttribute(
        hwnd.0 as _,
        DWMWA_WINDOW_CORNER_PREFERENCE,
        &corner_preference as *const _ as _,
        std::mem::size_of_val(&corner_preference) as u32,
      ),
      "DWMWA_WINDOW_CORNER_PREFERENCE",
    )?;

    check_dwm_result(
      DwmSetWindowAttribute(
        hwnd.0 as _,
        DWMWA_SYSTEMBACKDROP_TYPE,
        &backdrop_type as *const _ as _,
        std::mem::size_of_val(&backdrop_type) as u32,
      ),
      "DWMWA_SYSTEMBACKDROP_TYPE",
    )?;

    let user32 = LoadLibraryA("user32.dll\0".as_ptr());
    if user32 == 0 {
      return Err("Failed to load user32.dll for Quick Paste acrylic".to_string());
    }

    let Some(set_window_composition_attribute_proc) =
      GetProcAddress(user32, "SetWindowCompositionAttribute\0".as_ptr())
    else {
      return Err(
        "Failed to load SetWindowCompositionAttribute for Quick Paste acrylic".to_string(),
      );
    };

    let set_window_composition_attribute: SetWindowCompositionAttributeFn =
      std::mem::transmute(set_window_composition_attribute_proc);

    let mut accent = AccentPolicy {
      accent_state: ACCENT_ENABLE_ACRYLICBLURBEHIND,
      accent_flags: 2,
      gradient_color: accent_tint,
      animation_id: 0,
    };
    let mut data = WindowCompositionAttribData {
      attrib: WCA_ACCENT_POLICY,
      data: &mut accent as *mut _ as *mut std::ffi::c_void,
      size_of_data: std::mem::size_of::<AccentPolicy>(),
    };

    if set_window_composition_attribute(hwnd.0 as _, &mut data) == 0 {
      return Err("Failed to apply Quick Paste acrylic accent".to_string());
    }
  }

  Ok(())
}

#[cfg(target_os = "windows")]
fn apply_quickpaste_webview_transparent_background(window: &tauri::Window) -> Result<(), String> {
  window
    .with_webview(|webview| {
      use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller2, COREWEBVIEW2_COLOR,
      };
      use windows::core::Interface;

      let controller = webview.controller();
      let controller2: ICoreWebView2Controller2 = controller
        .cast()
        .expect("Failed to access Quick Paste WebView2 controller background API");
      unsafe {
        controller2
          .SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
            R: 0,
            G: 0,
            B: 0,
            A: 0,
          })
          .expect("Failed to set Quick Paste WebView2 transparent background");
      }
    })
    .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn apply_quickpaste_windows_material(
  window: &tauri::Window,
  is_dark: bool,
  material: QuickPasteWindowsMaterial,
) -> Result<(), String> {
  apply_quickpaste_windows_backdrop(window, is_dark, material)?;
  apply_quickpaste_webview_transparent_background(window)?;

  Ok(())
}

#[cfg(target_os = "macos")]
fn return_focus_to_previous_window() {
  unsafe {
    let app = NSApplication::sharedApplication(nil);
    let _: () = msg_send![app, hide: nil];
  }
}

#[cfg(target_os = "windows")]
fn get_foreground_window_handle() -> isize {
  unsafe { GetForegroundWindow() as isize }
}

#[cfg(target_os = "windows")]
fn restore_foreground_window(window_handle: isize) {
  if window_handle != 0 {
    unsafe {
      SetForegroundWindow(window_handle as _);
    }
  }
}

#[cfg(target_os = "windows")]
fn restore_quickpaste_previous_foreground_window() {
  let window_handle = *QUICKPASTE_PREVIOUS_FOREGROUND_WINDOW
    .lock()
    .expect("Failed to lock quickpaste previous foreground window");

  restore_foreground_window(window_handle);
}

#[derive(Serialize)]
struct AppReadyResponse<'a> {
  permissionstrusted: bool,
  constants: &'a AppConstants<'a>,
  settings: &'a Mutex<HashMap<String, Setting>>,
}

#[derive(Clone, serde::Serialize)]
struct SettingUpdatePayload {
  name: String,
  value_bool: Option<bool>,
  value_string: Option<String>,
  value_number: Option<i32>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFontOption {
  family: String,
  display_name: String,
  is_cjk: bool,
}

fn contains_cjk_char(value: &str) -> bool {
  value.chars().any(|ch| {
    ('\u{4E00}'..='\u{9FFF}').contains(&ch)
      || ('\u{3400}'..='\u{4DBF}').contains(&ch)
      || ('\u{F900}'..='\u{FAFF}').contains(&ch)
  })
}

fn strip_windows_font_style_name(value: &str) -> String {
  let mut family = value.trim().to_string();
  let style_suffixes = [
    " Extra Bold Italic",
    " Extra Bold",
    " Bold Italic",
    " SemiBold Italic",
    " Semibold Italic",
    " SemiLight Italic",
    " Semilight Italic",
    " Black Italic",
    " Light Italic",
    " Medium Italic",
    " Regular Italic",
    " Condensed Bold",
    " Condensed",
    " Regular",
    " SemiBold",
    " Semibold",
    " SemiLight",
    " Semilight",
    " Medium",
    " Black",
    " Light",
    " Bold",
    " Italic",
  ];

  for suffix in style_suffixes {
    if family.ends_with(suffix) {
      family.truncate(family.len() - suffix.len());
      break;
    }
  }

  family.trim().to_string()
}

fn quickpaste_font_display_name(family: &str) -> String {
  match family {
    "Microsoft YaHei" => "微软雅黑".to_string(),
    "Microsoft YaHei UI" => "微软雅黑 UI".to_string(),
    "SimSun" => "宋体".to_string(),
    "NSimSun" => "新宋体".to_string(),
    "SimHei" => "黑体".to_string(),
    "KaiTi" => "楷体".to_string(),
    "FangSong" => "仿宋".to_string(),
    "Microsoft JhengHei" => "微软正黑体".to_string(),
    "Microsoft JhengHei UI" => "微软正黑体 UI".to_string(),
    "MingLiU" => "细明体".to_string(),
    "PMingLiU" => "新细明体".to_string(),
    "DengXian" => "等线".to_string(),
    "Yu Gothic" => "游ゴシック".to_string(),
    "Yu Gothic UI" => "游ゴシック UI".to_string(),
    _ => family.to_string(),
  }
}

fn is_quickpaste_cjk_font_family(family: &str, display_name: &str) -> bool {
  contains_cjk_char(family)
    || contains_cjk_char(display_name)
    || family.contains("YaHei")
    || family.contains("JhengHei")
    || family.contains("SimSun")
    || family.contains("SimHei")
    || family.contains("KaiTi")
    || family.contains("FangSong")
    || family.contains("MingLiU")
    || family.contains("DengXian")
    || family.contains("Yu Gothic")
    || family.contains("MS Gothic")
    || family.contains("Malgun Gothic")
    || family.contains("Mincho")
    || family.contains("PingFang")
    || family.contains("Source Han")
    || family.contains("HarmonyOS Sans SC")
    || family.contains("MiSans")
}

fn normalize_windows_font_registry_name(value: &str) -> Vec<String> {
  let font_name = value
    .split(" (")
    .next()
    .unwrap_or(value)
    .split('（')
    .next()
    .unwrap_or(value)
    .trim();

  font_name
    .split(" & ")
    .map(strip_windows_font_style_name)
    .filter(|family| !family.is_empty())
    .collect()
}

#[cfg(target_os = "windows")]
fn collect_windows_fonts_from_registry(
  root: winreg::HKEY,
  fonts: &mut std::collections::BTreeMap<String, SystemFontOption>,
) -> Result<(), String> {
  use winreg::RegKey;

  let root_key = RegKey::predef(root);
  let fonts_key = root_key
    .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts")
    .map_err(|e| e.to_string())?;

  for item in fonts_key.enum_values() {
    let (name, _) = item.map_err(|e| e.to_string())?;

    for family in normalize_windows_font_registry_name(&name) {
      let display_name = quickpaste_font_display_name(&family);
      let is_cjk = is_quickpaste_cjk_font_family(&family, &display_name);
      fonts.entry(family.clone()).or_insert(SystemFontOption {
        family,
        is_cjk,
        display_name,
      });
    }
  }

  Ok(())
}

#[tauri::command]
fn list_system_fonts() -> Result<Vec<SystemFontOption>, String> {
  #[cfg(target_os = "windows")]
  {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let mut fonts = std::collections::BTreeMap::new();
    collect_windows_fonts_from_registry(HKEY_LOCAL_MACHINE, &mut fonts)?;
    let _ = collect_windows_fonts_from_registry(HKEY_CURRENT_USER, &mut fonts);

    Ok(fonts.into_values().collect())
  }

  #[cfg(not(target_os = "windows"))]
  {
    Ok(Vec::new())
  }
}

#[tauri::command]
async fn quickpaste_hide_paste_close(
  app_handle: tauri::AppHandle,
  history_id: String,
) -> Result<(), String> {
  let window = app_handle
    .get_window("quickpaste")
    .ok_or_else(|| "Failed to get quickpaste window".to_string())?;

  #[cfg(target_os = "macos")]
  return_focus_to_previous_window();

  #[cfg(target_os = "windows")]
  restore_quickpaste_previous_foreground_window();

  sleep(StdDuration::from_millis(QUICKPASTE_FOCUS_RESTORE_DELAY_MS)).await;

  clipboard_commands::copy_paste_history_item_internal(app_handle.clone(), history_id, 0);

  window
    .close()
    .map_err(|e| format!("Failed to close window: {}", e))?;

  Ok(())
}

#[tauri::command]
async fn quickpaste_hide_paste(
  app_handle: tauri::AppHandle,
  history_id: String,
) -> Result<(), String> {
  let window = app_handle
    .get_window("quickpaste")
    .ok_or_else(|| "Failed to get quickpaste window".to_string())?;

  #[cfg(target_os = "macos")]
  return_focus_to_previous_window();

  #[cfg(target_os = "windows")]
  restore_quickpaste_previous_foreground_window();

  sleep(StdDuration::from_millis(QUICKPASTE_FOCUS_RESTORE_DELAY_MS)).await;

  clipboard_commands::copy_paste_history_item_internal(app_handle.clone(), history_id, 0);

  let _ = window.is_visible();

  Ok(())
}

#[tauri::command]
async fn quickpaste_paste_many(
  app_handle: tauri::AppHandle,
  history_ids: Vec<String>,
  separator: String,
  prefix_separator: bool,
  close_after: bool,
) -> Result<(), String> {
  if history_ids.is_empty() {
    return Ok(());
  }

  let window = app_handle
    .get_window("quickpaste")
    .ok_or_else(|| "Failed to get quickpaste window".to_string())?;

  #[cfg(target_os = "macos")]
  return_focus_to_previous_window();

  #[cfg(target_os = "windows")]
  restore_quickpaste_previous_foreground_window();

  sleep(StdDuration::from_millis(QUICKPASTE_FOCUS_RESTORE_DELAY_MS)).await;

  let paste_result = clipboard_commands::copy_paste_history_items(
    app_handle.clone(),
    history_ids,
    separator,
    prefix_separator,
    QUICKPASTE_SEQUENCE_PASTE_DELAY_MS,
  );

  if paste_result != "ok" {
    return Err(paste_result);
  }

  if close_after {
    window
      .close()
      .map_err(|e| format!("Failed to close quickpaste window: {}", e))?;
  }

  Ok(())
}

#[tauri::command]
fn close_quickpaste_restore_focus(app_handle: tauri::AppHandle) -> Result<(), String> {
  if let Some(window) = app_handle.get_window("quickpaste") {
    window
      .close()
      .map_err(|e| format!("Failed to close quickpaste window: {}", e))?;
  }

  Ok(())
}

#[tauri::command]
fn set_quickpaste_search_active(is_active: bool) {
  *QUICKPASTE_SEARCH_ACTIVE
    .lock()
    .expect("Failed to lock quickpaste search state") = is_active;
}

#[tauri::command]
fn restore_quickpaste_previous_focus() {
  *QUICKPASTE_SEARCH_ACTIVE
    .lock()
    .expect("Failed to lock quickpaste search state") = false;

  #[cfg(target_os = "windows")]
  restore_quickpaste_previous_foreground_window();
}

#[cfg(target_os = "windows")]
fn is_quickpaste_visible(app_handle: &tauri::AppHandle) -> bool {
  let Some(window) = app_handle.get_window("quickpaste") else {
    return false;
  };

  window
    .is_visible()
    .expect("Failed to check quickpaste window visibility")
}

#[cfg(target_os = "windows")]
fn is_quickpaste_search_active() -> bool {
  *QUICKPASTE_SEARCH_ACTIVE
    .lock()
    .expect("Failed to lock quickpaste search state")
}

#[cfg(target_os = "windows")]
fn has_quickpaste_modifier_pressed() -> bool {
  LControlKey.is_pressed()
    || RControlKey.is_pressed()
    || LAltKey.is_pressed()
    || RAltKey.is_pressed()
    || LShiftKey.is_pressed()
    || RShiftKey.is_pressed()
    || LSuper.is_pressed()
    || RSuper.is_pressed()
}

#[cfg(target_os = "windows")]
fn has_quickpaste_non_alt_modifier_pressed() -> bool {
  LControlKey.is_pressed()
    || RControlKey.is_pressed()
    || LShiftKey.is_pressed()
    || RShiftKey.is_pressed()
    || LSuper.is_pressed()
    || RSuper.is_pressed()
}

#[cfg(target_os = "windows")]
fn is_quickpaste_alt_pressed() -> bool {
  LAltKey.is_pressed() || RAltKey.is_pressed()
}

#[cfg(target_os = "windows")]
fn should_capture_quickpaste_key(app_handle: &tauri::AppHandle) -> bool {
  !has_quickpaste_modifier_pressed() && is_quickpaste_visible(app_handle)
}

#[cfg(target_os = "windows")]
fn should_capture_quickpaste_search_chord(app_handle: &tauri::AppHandle) -> bool {
  (LControlKey.is_pressed()
    || RControlKey.is_pressed()
    || LSuper.is_pressed()
    || RSuper.is_pressed())
    && !LAltKey.is_pressed()
    && !RAltKey.is_pressed()
    && !LShiftKey.is_pressed()
    && !RShiftKey.is_pressed()
    && is_quickpaste_visible(app_handle)
}

#[cfg(target_os = "windows")]
fn should_capture_quickpaste_number_key(app_handle: &tauri::AppHandle) -> bool {
  !has_quickpaste_non_alt_modifier_pressed()
    && !is_quickpaste_search_active()
    && is_quickpaste_visible(app_handle)
}

#[cfg(target_os = "windows")]
fn reset_quickpaste_number_selection(app_handle: &tauri::AppHandle) {
  let _ = app_handle;
  QUICKPASTE_HELD_NUMBER_INDEXES
    .lock()
    .expect("Failed to lock quickpaste held number indexes")
    .clear();
  QUICKPASTE_SELECTED_NUMBER_INDEXES
    .lock()
    .expect("Failed to lock quickpaste selected number indexes")
    .clear();
}

#[cfg(target_os = "windows")]
fn quickpaste_number_key_index(key: KeybdKey) -> Option<usize> {
  match key {
    Numrow1Key | Numpad1Key => Some(0),
    Numrow2Key | Numpad2Key => Some(1),
    Numrow3Key | Numpad3Key => Some(2),
    Numrow4Key | Numpad4Key => Some(3),
    Numrow5Key | Numpad5Key => Some(4),
    Numrow6Key | Numpad6Key => Some(5),
    Numrow7Key | Numpad7Key => Some(6),
    Numrow8Key | Numpad8Key => Some(7),
    Numrow9Key | Numpad9Key => Some(8),
    _ => None,
  }
}

#[cfg(target_os = "windows")]
fn press_quickpaste_number_key(key: KeybdKey, app_handle: &tauri::AppHandle) -> BlockInput {
  if should_capture_quickpaste_number_key(app_handle) {
    if let Some(index) = quickpaste_number_key_index(key) {
      let mut held_indexes = QUICKPASTE_HELD_NUMBER_INDEXES
        .lock()
        .expect("Failed to lock quickpaste held number indexes");
      if !held_indexes.contains(&index) {
        held_indexes.push(index);
      }
      drop(held_indexes);

      let mut selected_indexes = QUICKPASTE_SELECTED_NUMBER_INDEXES
        .lock()
        .expect("Failed to lock quickpaste selected number indexes");
      if !selected_indexes.contains(&index) {
        selected_indexes.push(index);
        selected_indexes.sort_unstable();
      }

      app_handle
        .emit_all("quickpaste-selected-results", selected_indexes.clone())
        .expect("Failed to emit quickpaste selected results");
      return BlockInput::Block;
    }
  }

  BlockInput::DontBlock
}

#[cfg(target_os = "windows")]
fn release_quickpaste_number_key(key: KeybdKey, app_handle: &tauri::AppHandle) -> BlockInput {
  if !is_quickpaste_visible(app_handle) || is_quickpaste_search_active() {
    return BlockInput::DontBlock;
  }

  if let Some(index) = quickpaste_number_key_index(key) {
    let mut held_indexes = QUICKPASTE_HELD_NUMBER_INDEXES
      .lock()
      .expect("Failed to lock quickpaste held number indexes");
    held_indexes.retain(|held_index| *held_index != index);

    if held_indexes.is_empty() && !is_quickpaste_alt_pressed() {
      QUICKPASTE_SELECTED_NUMBER_INDEXES
        .lock()
        .expect("Failed to lock quickpaste selected number indexes")
        .clear();
      app_handle
        .emit_all("quickpaste-selected-results", Vec::<usize>::new())
        .expect("Failed to emit quickpaste selected results");
    }

    return BlockInput::Block;
  }

  BlockInput::DontBlock
}

#[cfg(target_os = "windows")]
fn release_quickpaste_alt_key(_key: KeybdKey, app_handle: &tauri::AppHandle) -> BlockInput {
  if !is_quickpaste_visible(app_handle) || is_quickpaste_search_active() {
    return BlockInput::DontBlock;
  }

  let held_is_empty = QUICKPASTE_HELD_NUMBER_INDEXES
    .lock()
    .expect("Failed to lock quickpaste held number indexes")
    .is_empty();

  if held_is_empty {
    let mut selected_indexes = QUICKPASTE_SELECTED_NUMBER_INDEXES
      .lock()
      .expect("Failed to lock quickpaste selected number indexes");
    if !selected_indexes.is_empty() {
      selected_indexes.clear();
      app_handle
        .emit_all("quickpaste-selected-results", Vec::<usize>::new())
        .expect("Failed to emit quickpaste selected results");
    }
  }

  BlockInput::DontBlock
}

#[cfg(target_os = "windows")]
fn is_quickpaste_text_key(key: KeybdKey) -> bool {
  matches!(
    key,
    AKey
      | BKey
      | CKey
      | DKey
      | EKey
      | FKey
      | GKey
      | HKey
      | IKey
      | JKey
      | KKey
      | LKey
      | MKey
      | NKey
      | OKey
      | PKey
      | QKey
      | RKey
      | SKey
      | TKey
      | UKey
      | VKey
      | WKey
      | XKey
      | YKey
      | ZKey
      | SpaceKey
      | BackquoteKey
      | BackslashKey
      | CommaKey
      | PeriodKey
      | MinusKey
      | QuoteKey
      | SemicolonKey
      | LBracketKey
      | RBracketKey
      | EqualKey
  )
}

#[cfg(target_os = "windows")]
fn close_quickpaste_on_text_key(key: KeybdKey, app_handle: &tauri::AppHandle) {
  if is_quickpaste_text_key(key)
    && !has_quickpaste_modifier_pressed()
    && !is_quickpaste_search_active()
    && is_quickpaste_visible(app_handle)
  {
    let _ = close_quickpaste_restore_focus(app_handle.clone());
  }
}

#[cfg(target_os = "windows")]
fn is_cursor_inside_quickpaste_window(app_handle: &tauri::AppHandle) -> bool {
  let Some(window) = app_handle.get_window("quickpaste") else {
    return false;
  };

  let Ok(position) = window.outer_position() else {
    return false;
  };
  let Ok(size) = window.outer_size() else {
    return false;
  };

  let mut cursor_position = POINT { x: 0, y: 0 };
  let did_get_cursor_position = unsafe { GetCursorPos(&mut cursor_position) };

  if did_get_cursor_position == 0 {
    return false;
  }

  cursor_position.x >= position.x
    && cursor_position.x <= position.x + size.width as i32
    && cursor_position.y >= position.y
    && cursor_position.y <= position.y + size.height as i32
}

#[cfg(target_os = "windows")]
fn close_quickpaste_on_outside_click(app_handle: &tauri::AppHandle) {
  if is_quickpaste_visible(app_handle) && !is_cursor_inside_quickpaste_window(app_handle) {
    let _ = close_quickpaste_restore_focus(app_handle.clone());
  }
}

#[cfg(target_os = "windows")]
fn register_quickpaste_number_key_hooks(key: KeybdKey, app_handle: &tauri::AppHandle) {
  let app_handle_for_press = app_handle.clone();
  key.blockable_bind(move || press_quickpaste_number_key(key, &app_handle_for_press));

  let app_handle_for_release = app_handle.clone();
  key.release_blockable_bind(move || release_quickpaste_number_key(key, &app_handle_for_release));
}

#[cfg(target_os = "windows")]
fn register_quickpaste_alt_key_hooks(key: KeybdKey, app_handle: &tauri::AppHandle) {
  let app_handle_for_release = app_handle.clone();
  key.release_blockable_bind(move || release_quickpaste_alt_key(key, &app_handle_for_release));
}

#[cfg(target_os = "windows")]
fn register_quickpaste_search_chord_hook(key: KeybdKey, app_handle: &tauri::AppHandle) {
  let app_handle_for_search = app_handle.clone();
  key.blockable_bind(move || {
    if should_capture_quickpaste_search_chord(&app_handle_for_search) {
      app_handle_for_search
        .emit_all("quickpaste-show-search", ())
        .expect("Failed to emit quickpaste search chord");
      return BlockInput::Block;
    }

    BlockInput::DontBlock
  });
}

#[cfg(target_os = "windows")]
fn register_quickpaste_keyboard_hooks(app_handle: tauri::AppHandle) {
  let app_handle_for_text_keys = app_handle.clone();
  KeybdKey::bind_all(move |key| {
    close_quickpaste_on_text_key(key, &app_handle_for_text_keys);
  });

  let app_handle_for_mouse = app_handle.clone();
  MouseButton::bind_all(move |_| {
    close_quickpaste_on_outside_click(&app_handle_for_mouse);
  });

  let app_handle_for_search = app_handle.clone();
  SlashKey.blockable_bind(move || {
    if should_capture_quickpaste_key(&app_handle_for_search) {
      app_handle_for_search
        .emit_all("quickpaste-show-search", ())
        .expect("Failed to emit quickpaste search key");
      return BlockInput::Block;
    }

    BlockInput::DontBlock
  });
  register_quickpaste_search_chord_hook(FKey, &app_handle);
  register_quickpaste_search_chord_hook(KKey, &app_handle);

  register_quickpaste_number_key_hooks(Numrow1Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow2Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow3Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow4Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow5Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow6Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow7Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow8Key, &app_handle);
  register_quickpaste_number_key_hooks(Numrow9Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad1Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad2Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad3Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad4Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad5Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad6Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad7Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad8Key, &app_handle);
  register_quickpaste_number_key_hooks(Numpad9Key, &app_handle);
  register_quickpaste_alt_key_hooks(LAltKey, &app_handle);
  register_quickpaste_alt_key_hooks(RAltKey, &app_handle);

  let app_handle_for_escape = app_handle.clone();
  EscapeKey.blockable_bind(move || {
    if should_capture_quickpaste_key(&app_handle_for_escape) {
      close_quickpaste_restore_focus(app_handle_for_escape.clone())
        .expect("Failed to close quickpaste window");
      return BlockInput::Block;
    }

    BlockInput::DontBlock
  });
}

#[tauri::command]
fn open_path_or_app(path: String) -> Result<(), String> {
  opener::open(path).map_err(|e| format!("Failed to open path: {}", e))
}

#[tauri::command]
fn get_device_id() -> Result<String, String> {
  match mid::get("FlowPasterApp") {
    Ok(id) => {
      debug_output(|| {
        println!("Device ID: {}", &id[..24]);
      });
      Ok(id[..24].to_string())
    }
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn update_setting(setting: Setting, app_handle: tauri::AppHandle) -> Result<String, String> {
  match insert_or_update_setting_by_name(&setting, app_handle) {
    Ok(result) => Ok(result),
    Err(err) => Err(err.to_string()),
  }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn update_left_click_tray_env(is_toggle_enabled: bool, is_disabled: bool) -> Result<(), String> {
  let should_disable_context_menu = is_disabled || is_toggle_enabled;

  std::env::set_var(
    "FLOWPASTER_ENABLE_LEFT_CLICK_MENU",
    should_disable_context_menu.to_string(),
  );
  Ok(())
}

fn set_windows_left_click_tray_env(settings_map: &HashMap<String, Setting>) {
  #[cfg(target_os = "windows")]
  {
    let is_disabled = settings_map
      .get("isLeftClickTrayDisabledOnWindows")
      .and_then(|setting| setting.value_bool)
      .unwrap_or(false);

    let is_toggle_enabled = settings_map
      .get("isLeftClickTrayToOpenEnabledOnWindows")
      .and_then(|setting| setting.value_bool)
      .unwrap_or(false);

    std::env::set_var(
      "FLOWPASTER_ENABLE_LEFT_CLICK_MENU",
      (is_disabled || is_toggle_enabled).to_string(),
    );
  }
}

fn build_app_tray(app_handle: &tauri::AppHandle) -> Result<(), String> {
  let db_items_state = app_handle.state::<DbItems>();
  let db_recent_history_items_state = app_handle.state::<DbRecentHistoryItems>();
  let app_settings = app_handle.state::<Mutex<HashMap<String, Setting>>>();

  {
    let settings_map = app_settings.lock().unwrap();
    set_windows_left_click_tray_env(&settings_map);
  }

  let tray_menu =
    menu::build_tray_menu(db_items_state, db_recent_history_items_state, app_settings)?;

  SystemTray::new()
    .with_id(APP_TRAY_ID)
    .with_menu(tray_menu)
    .build(app_handle)
    .map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
fn set_tray_icon_hidden(app_handle: tauri::AppHandle, is_hidden: bool) -> Result<(), String> {
  if is_hidden {
    if let Some(tray_handle) = app_handle.tray_handle_by_id(APP_TRAY_ID) {
      tray_handle.destroy().map_err(|e| e.to_string())?;
    }
    return Ok(());
  }

  if app_handle.tray_handle_by_id(APP_TRAY_ID).is_none() {
    build_app_tray(&app_handle)?;
  }

  Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn update_left_click_tray_env(is_toggle_enabled: bool, is_disabled: bool) -> Result<(), String> {
  Ok(())
}

#[tauri::command]
fn is_autostart_enabled() -> Result<bool, bool> {
  let current_exe = current_exe().unwrap();

  let auto_start = AutoLaunchBuilder::new()
    .set_app_name("FlowPaster")
    .set_app_path(&current_exe.to_str().unwrap())
    .set_use_launch_agent(true)
    .build()
    .unwrap();

  Ok(auto_start.is_enabled().unwrap())
}

#[tauri::command]
fn autostart(enabled: bool) -> Result<bool, bool> {
  let current_exe = current_exe().unwrap();

  let auto_start = AutoLaunchBuilder::new()
    .set_app_name("FlowPaster")
    .set_app_path(&current_exe.to_str().unwrap())
    .set_use_launch_agent(true)
    .build()
    .unwrap();

  if enabled {
    auto_start.enable().unwrap();
  } else {
    auto_start.disable().unwrap();
  }

  Ok(auto_start.is_enabled().unwrap())
}

#[tauri::command]
fn app_ready(app_handle: tauri::AppHandle) -> Result<String, String> {
  let window = app_handle.get_window("main").unwrap();

  let current_size = window.inner_size().unwrap();
  let mut new_size = current_size;

  if current_size.width < 600 {
    new_size.width = 600;
  }
  if current_size.height < 550 {
    new_size.height = 550;
  }

  if new_size != current_size {
    window.set_size(new_size).unwrap();
  }

  let app_settings = app_handle.state::<Mutex<HashMap<String, Setting>>>();

  let hide_main_window_on_startup = app_settings
    .lock()
    .unwrap()
    .get("isKeepMainWindowClosedOnRestartEnabled")
    .map(|setting| setting.value_bool.unwrap_or(false))
    .unwrap_or(false);

  if !hide_main_window_on_startup {
    window.show().unwrap();
  }

  debug_output(|| {
    println!("app_ready on client");
  });

  let constants = db::APP_CONSTANTS
    .get()
    .ok_or("APP_CONSTANTS not initialized")?;

  let mut is_permissions_trusted = true;

  #[cfg(target_os = "macos")]
  {
    is_permissions_trusted =
      macos_accessibility_client::accessibility::application_is_trusted_with_prompt();

    debug_output(|| {
      println!("Application is trusted: {}", is_permissions_trusted);
    });
  }

  let response = AppReadyResponse {
    constants: constants,
    permissionstrusted: is_permissions_trusted,
    settings: &app_settings,
  };

  let serialized = serde_json::to_string(&response).map_err(|e| e.to_string())?;

  Ok(serialized)
}

#[tauri::command]
fn get_app_settings(app_handle: tauri::AppHandle) -> Result<String, String> {
  println!("app_settings on client");
  let app_settings = app_handle.state::<Mutex<HashMap<String, Setting>>>();

  let constants = db::APP_CONSTANTS
    .get()
    .ok_or("APP_CONSTANTS not initialized")?;

  let response = AppReadyResponse {
    constants: constants,
    permissionstrusted: true,
    settings: &app_settings,
  };

  let serialized = serde_json::to_string(&response).map_err(|e| e.to_string())?;

  Ok(serialized)
}

#[tauri::command]
fn open_osx_accessibility_preferences() {
  #[cfg(target_os = "macos")]
  {
    let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
    if let Err(err) = opener::open(url) {
      eprintln!("Failed to open URL: {}", err);
    }
  }
}

#[tauri::command]
fn check_osx_accessibility_preferences() -> bool {
  #[cfg(target_os = "macos")]
  {
    macos_accessibility_client::accessibility::application_is_trusted()
  }

  #[cfg(target_os = "windows")]
  {
    true
  }
}

#[tauri::command]
fn set_icon(app_handle: tauri::AppHandle, name: &str, is_dark: bool) {
  let Some(tray_handle) = app_handle.tray_handle_by_id(APP_TRAY_ID) else {
    return;
  };

  let _ = tray_handle.set_tooltip("FlowPaster");
  let is_windows_system_dark_mode = utils::is_windows_system_uses_dark_theme();

  match name {
    "notification" => {
      tray_handle
        .set_icon(if cfg!(windows) {
          if is_dark || is_windows_system_dark_mode {
            tauri::Icon::Raw(include_bytes!("../icons/tray128x128-white-notification.png").to_vec())
          } else {
            tauri::Icon::Raw(include_bytes!("../icons/tray128x128-notification.png").to_vec())
          }
        } else {
          tauri::Icon::Raw(include_bytes!("../icons/tray128x128-notification.png").to_vec())
        })
        .unwrap();
    }
    _ => tray_handle
      .set_icon(if cfg!(windows) {
        if is_dark || is_windows_system_dark_mode {
          tauri::Icon::Raw(include_bytes!("../icons/tray128x128-color.png").to_vec())
        } else {
          tauri::Icon::Raw(include_bytes!("../icons/tray128x128-color.png").to_vec())
        }
      } else {
        tauri::Icon::Raw(include_bytes!("../icons/tray128x128.png").to_vec())
      })
      .unwrap(),
  }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn open_history_window(app_handle: tauri::AppHandle) -> Result<(), String> {
  // check if the window is already open
  if app_handle.get_window("history").is_some() {
    // show if exist and return
    let window = app_handle
      .get_window("history")
      .ok_or_else(|| "Failed to get history window".to_string())?;
    // bring to front
    window.show().map_err(|e| e.to_string())?;
    // window.set_focus().map_err(|e| e.to_string())?;

    return Ok(());
  }
  let menu = Menu::new().add_submenu(Submenu::new(
    "FlowPaster",
    Menu::new()
      .add_native_item(MenuItem::CloseWindow)
      .add_native_item(MenuItem::Copy)
      .add_native_item(MenuItem::SelectAll)
      .add_native_item(MenuItem::Undo)
      .add_native_item(MenuItem::Redo)
      .add_native_item(MenuItem::Paste),
  ));

  let mut window_builder = tauri::WindowBuilder::new(
    &app_handle,
    "history",
    tauri::WindowUrl::App("history-index".into()),
  )
  .title("FlowPaster History")
  .max_inner_size(700.0, 2200.0)
  .min_inner_size(300.0, 400.0)
  .menu(menu)
  .visible(false);

  window_builder = window_builder
    .title_bar_style(tauri::TitleBarStyle::Overlay)
    .hidden_title(true);

  let history_window = window_builder.build().map_err(|e| e.to_string())?;

  history_window.set_transparent_titlebar(true);
  history_window.position_traffic_lights(-10., -10.);

  {
    let app_handle_clone = app_handle.clone();

    let debounced_save = debounce(
      move |_: ()| {
        app_handle_clone
          .save_window_state(StateFlags::POSITION | StateFlags::SIZE)
          .unwrap_or_else(|e| eprintln!("Failed to save window state: {}", e));
      },
      StdDuration::from_secs(1),
    );

    history_window.on_window_event(move |e| match e {
      tauri::WindowEvent::Destroyed => {
        app_handle.save_window_state(StateFlags::all()).unwrap();
        app_handle
          .emit_all("window-events", "history-window-closed")
          .unwrap_or_else(|e| eprintln!("Failed to emit window closed event: {}", e));
      }
      tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
        debounced_save.call(());
      }
      _ => {}
    });
  }

  // history_window.hide().map_err(|e| e.to_string())?;
  history_window.show().map_err(|e| e.to_string())?;
  history_window.set_focus().map_err(|e| e.to_string())?;

  Ok(())
}

// On Windows, the open new window command must be async
#[cfg(target_os = "windows")]
#[tauri::command]
async fn open_history_window(app_handle: tauri::AppHandle) -> Result<(), String> {
  // check if the window is already open
  if app_handle.get_window("history").is_some() {
    // show if exist and return
    let window = app_handle
      .get_window("history")
      .ok_or_else(|| "Failed to get history window".to_string())?;
    // bring to front
    window.show().map_err(|e| e.to_string())?;
    // window.set_focus().map_err(|e| e.to_string())?;

    return Ok(());
  }
  let menu = Menu::new().add_submenu(Submenu::new(
    "FlowPaster",
    Menu::new()
      .add_native_item(MenuItem::CloseWindow)
      .add_native_item(MenuItem::Copy)
      .add_native_item(MenuItem::SelectAll)
      .add_native_item(MenuItem::Undo)
      .add_native_item(MenuItem::Redo)
      .add_native_item(MenuItem::Paste),
  ));

  let mut window_builder = tauri::WindowBuilder::new(
    &app_handle,
    "history",
    tauri::WindowUrl::App("history-index".into()),
  )
  .title("FlowPaster History")
  .decorations(false)
  .transparent(true)
  .max_inner_size(700.0, 2200.0)
  .min_inner_size(300.0, 400.0)
  .menu(menu)
  .visible(false);

  window_builder = window_builder.decorations(false).transparent(true);

  let history_window = window_builder.build().map_err(|e| e.to_string())?;

  {
    let app_handle_clone = app_handle.clone();

    let debounced_save = debounce(
      move |_: ()| {
        app_handle_clone
          .save_window_state(StateFlags::POSITION | StateFlags::SIZE)
          .unwrap_or_else(|e| eprintln!("Failed to save window state: {}", e));
      },
      StdDuration::from_secs(1),
    );

    history_window.on_window_event(move |e| match e {
      tauri::WindowEvent::Destroyed => {
        app_handle.save_window_state(StateFlags::all()).unwrap();
        app_handle
          .emit_all("window-events", "history-window-closed")
          .unwrap_or_else(|e| eprintln!("Failed to emit window closed event: {}", e));
      }
      tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
        debounced_save.call(());
      }
      _ => {}
    });
  }

  let _ = history_window.set_decorations(false);
  history_window.show().map_err(|e| e.to_string())?;
  history_window.set_focus().map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
async fn open_quickpaste_window(
  app_handle: tauri::AppHandle,
  app_settings: tauri::State<'_, Mutex<HashMap<String, Setting>>>,
  title: String,
  is_dark: Option<bool>,
) -> Result<(), String> {
  let _ = title;

  if let Some(window) = app_handle.get_window("quickpaste") {
    *QUICKPASTE_SEARCH_ACTIVE
      .lock()
      .expect("Failed to lock quickpaste search state") = false;
    #[cfg(target_os = "windows")]
    reset_quickpaste_number_selection(&app_handle);
    window.close().map_err(|e| e.to_string())?;
    return Ok(());
  }

  *QUICKPASTE_SEARCH_ACTIVE
    .lock()
    .expect("Failed to lock quickpaste search state") = false;
  #[cfg(target_os = "windows")]
  reset_quickpaste_number_selection(&app_handle);
  #[cfg(target_os = "windows")]
  let previous_foreground_window = get_foreground_window_handle();
  #[cfg(target_os = "windows")]
  {
    *QUICKPASTE_PREVIOUS_FOREGROUND_WINDOW
      .lock()
      .expect("Failed to lock quickpaste previous foreground window") = previous_foreground_window;
  }

  let window_width = 410.0;
  let window_height = 720.0;
  #[cfg(target_os = "windows")]
  let quickpaste_windows_material = {
    let settings_map = app_settings
      .lock()
      .expect("Failed to lock app settings for Quick Paste material");
    quickpaste_windows_material_from_settings(&settings_map)
  };
  let main_window = app_handle.get_window("main").unwrap();
  let is_main_window_visible = main_window.is_visible().unwrap();

  if is_main_window_visible {
    #[cfg(target_os = "macos")]
    main_window.hide().map_err(|e| e.to_string())?;
  }

  let window_builder = tauri::WindowBuilder::new(
    &app_handle,
    "quickpaste",
    tauri::WindowUrl::App("quickpaste-index".into()),
  )
  .title("")
  .always_on_top(true)
  .decorations(false)
  .transparent(true)
  .focused(false)
  .maximizable(false)
  .resizable(false)
  .max_inner_size(window_width, window_height)
  .min_inner_size(window_width, window_height)
  .minimizable(false)
  .inner_size(window_width, window_height)
  .visible(false);

  let quickpaste_window = window_builder.build().map_err(|e| e.to_string())?;

  #[cfg(target_os = "windows")]
  {
    let use_dark_tint = is_dark.unwrap_or_else(utils::is_windows_system_uses_dark_theme);
    apply_quickpaste_windows_material(
      &quickpaste_window,
      use_dark_tint,
      quickpaste_windows_material,
    )?;
  }

  let position = Mouse::get_mouse_position();

  let (cursor_x, cursor_y) = match position {
    Mouse::Position { x, y } => (x, y),
    Mouse::Error => {
      println!("Failed to get mouse position, using default (100, 100)");
      (100, 100)
    }
  };

  let monitors = quickpaste_window
    .available_monitors()
    .map_err(|e| e.to_string())?;

  #[cfg(target_os = "windows")]
  {
    let cursor_monitor = monitors
      .iter()
      .find(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let monitor_left = monitor_position.x;
        let monitor_top = monitor_position.y;
        let monitor_right = monitor_left + monitor_size.width as i32;
        let monitor_bottom = monitor_top + monitor_size.height as i32;

        cursor_x >= monitor_left
          && cursor_x < monitor_right
          && cursor_y >= monitor_top
          && cursor_y < monitor_bottom
      })
      .ok_or_else(|| "Failed to find monitor containing Quick Paste cursor".to_string())?;

    let monitor_position = cursor_monitor.position();
    let monitor_size = cursor_monitor.size();
    let scale_factor = cursor_monitor.scale_factor();
    let monitor_left = monitor_position.x;
    let monitor_top = monitor_position.y;
    let monitor_right = monitor_left + monitor_size.width as i32;
    let monitor_bottom = monitor_top + monitor_size.height as i32;
    let window_width_physical = (window_width * scale_factor).round() as i32;
    let window_height_physical = (window_height * scale_factor).round() as i32;
    let cursor_inset = (24.0 * scale_factor).round() as i32;
    let max_window_x = (monitor_right - window_width_physical).max(monitor_left);
    let max_window_y = (monitor_bottom - window_height_physical).max(monitor_top);
    let preferred_window_x = cursor_x - cursor_inset;
    let preferred_window_y = cursor_y - window_height_physical + cursor_inset;
    let window_x = preferred_window_x.clamp(monitor_left, max_window_x);
    let window_y = preferred_window_y.clamp(monitor_top, max_window_y);

    quickpaste_window
      .set_position(tauri::PhysicalPosition {
        x: window_x,
        y: window_y,
      })
      .map_err(|e| e.to_string())?;
  }

  #[cfg(target_os = "macos")]
  {
    let cursor_x_scale = (cursor_x as f64).round() as i32;
    let cursor_y_scale = (cursor_y as f64).round() as i32;
    quickpaste_window
      .set_position(tauri::LogicalPosition {
        x: cursor_x_scale + 50,
        y: cursor_y_scale - 50,
      })
      .map_err(|e| e.to_string())?;
  }

  {
    let app_handle_clone = app_handle.clone();

    quickpaste_window.on_window_event(move |e| match e {
      tauri::WindowEvent::Destroyed => {
        *QUICKPASTE_SEARCH_ACTIVE
          .lock()
          .expect("Failed to lock quickpaste search state") = false;
        #[cfg(target_os = "windows")]
        reset_quickpaste_number_selection(&app_handle_clone);
        #[cfg(target_os = "macos")]
        {
          return_focus_to_previous_window();
          if is_main_window_visible {
            let _ = app_handle_clone
              .get_window("main")
              .unwrap()
              .show()
              .map_err(|e| e.to_string());
          }
        }

        app_handle_clone
          .emit_all("window-events", "quickpaste-window-closed")
          .unwrap_or_else(|e| eprintln!("Failed to emit window closed event: {}", e));
      }
      #[cfg(target_os = "windows")]
      tauri::WindowEvent::Focused(_) => {
        if let Some(window) = app_handle_clone.get_window("quickpaste") {
          let use_dark_tint = is_dark.unwrap_or_else(utils::is_windows_system_uses_dark_theme);
          apply_quickpaste_windows_material(&window, use_dark_tint, quickpaste_windows_material)
            .expect("Failed to refresh Quick Paste Windows material after focus change");
        }
      }
      tauri::WindowEvent::CloseRequested { api, .. } => {
        api.prevent_close();
        if let Some(window) = app_handle_clone.get_window("quickpaste") {
          let _ = window
            .close()
            .map_err(|e| eprintln!("Failed to close window: {}", e));
        }
        #[cfg(target_os = "macos")]
        return_focus_to_previous_window();
      }
      _ => {}
    });
  }

  quickpaste_window.show().map_err(|e| e.to_string())?;
  #[cfg(target_os = "windows")]
  {
    let use_dark_tint = is_dark.unwrap_or_else(utils::is_windows_system_uses_dark_theme);
    apply_quickpaste_windows_material(
      &quickpaste_window,
      use_dark_tint,
      quickpaste_windows_material,
    )?;
  }
  #[cfg(target_os = "windows")]
  {
    restore_foreground_window(previous_foreground_window);
    apply_quickpaste_windows_material(
      &quickpaste_window,
      is_dark.unwrap_or_else(utils::is_windows_system_uses_dark_theme),
      quickpaste_windows_material,
    )?;
  }

  // println!(
  //   "User cursor position: {}x{}",
  //   cursor_x_scale, cursor_y_scale
  // );
  // println!("Global window size: {}x{}", global_width, global_height);
  // println!("Window position: {}x{}", window_x, window_y);

  Ok(())
}

#[tokio::main]
async fn main() {
  dotenv().ok();
  let db_items_state = DbItems(Mutex::new(Vec::new()));
  let db_recent_history_items_state = DbRecentHistoryItems(Mutex::new(Vec::new()));
  tauri_plugin_deep_link::prepare("app.flowpaster.desktop");

  tauri::Builder::default()
    .manage(db_items_state)
    .manage(db_recent_history_items_state)
    .on_system_tray_event(move |app, event| match event {
      SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
        "quit" => {
          app.save_window_state(StateFlags::all()).unwrap();
          let w = app.get_window("main").unwrap();
          w.close().unwrap();
          app.exit(0);
        }
        "open" => {
          let w = app.get_window("main").unwrap();
          w.emit_all("window-events", "main-window-show").unwrap();
          w.show().unwrap();
          w.set_focus().unwrap();
        }
        "add_first_menu_item" => {
          let w = app.get_window("main").unwrap();
          w.show().unwrap();
          w.set_focus().unwrap();
          w.emit("menu:add_first_menu_item", {}).unwrap();
        }
        "disable_history_capture" => {
          let w = app.get_window("main").unwrap();
          w.emit(
            "setting:update",
            SettingUpdatePayload {
              name: "isHistoryEnabled".to_string(),
              value_number: None,
              value_string: None,
              value_bool: Some(false),
            },
          )
          .unwrap();
        }
        "enable_history_capture" => {
          let w = app.get_window("main").unwrap();
          w.emit(
            "setting:update",
            SettingUpdatePayload {
              name: "isHistoryEnabled".to_string(),
              value_bool: Some(true),
              value_number: None,
              value_string: None,
            },
          )
          .unwrap();
        }

        item_id => {
          debug_output(|| {
            println!("system tray received a click on item id{:?} ", item_id);
          });

          let w = app.get_window("main").unwrap();
          let state: tauri::State<DbItems> = app.state::<DbItems>();
          let db_items_state = state.0.lock().unwrap();

          // Get the copy-only setting
          let app_settings = app.state::<Mutex<HashMap<String, Setting>>>();
          let settings_map = app_settings.lock().unwrap();
          let is_copy_only = settings_map
            .get("isMenuItemCopyOnlyEnabled")
            .and_then(|setting| setting.value_bool)
            .unwrap_or(false);

          debug_output(|| {
            println!("Looking for item with item_id: {:?}", item_id);
            println!("is_copy_only: {:?}", is_copy_only);
          });

          let item_opt = db_items_state.iter().find(|&item| item.item_id == item_id);

          if let Some(item) = item_opt {
            debug_output(|| {
              println!(
                "Found item in db_items_state with value: {:?} ",
                &item.value
              );
            });

            let mut manager = app.clipboard_manager();

            if !item.is_clip {
              if let (Some(true), Some(false)) = (item.is_image, item.is_link) {
                let image_path = match &item.image_path_full_res {
                  Some(path) => path,
                  None => return (),
                };

                // Convert relative path to absolute path
                let absolute_path = db::to_absolute_image_path(&image_path);
                let img_data =
                  std::fs::read(&absolute_path).expect("Failed to read image from path");
                let base64_image = base64::encode(&img_data);

                write_image_to_clipboard(base64_image).expect("Failed to write image to clipboard");
              }
              if item.is_link.unwrap_or(false) {
                let url = item.value.as_deref().unwrap_or("");
                if is_copy_only {
                  // Copy URL to clipboard instead of opening it
                  // Apply global templates
                  let final_text = apply_global_templates(url, &settings_map);
                  debug_output(|| {
                    println!("Copying URL to clipboard: {}", final_text);
                  });
                  manager
                    .write_text(final_text)
                    .expect("failed to write to clipboard");
                } else {
                  let _ = opener::open(ensure_url_or_email_prefix(url))
                    .map_err(|e| format!("Failed to open url: {}", e));
                }
              } else if item.is_path.unwrap_or(false) {
                let path = item.value.as_deref().unwrap_or("");
                if is_copy_only {
                  // Copy path to clipboard instead of opening it
                  // Apply global templates
                  let final_text = apply_global_templates(path, &settings_map);
                  debug_output(|| {
                    println!("Copying path to clipboard: {}", final_text);
                  });
                  manager
                    .write_text(final_text)
                    .expect("failed to write to clipboard");
                } else {
                  let _ = opener::open(path).map_err(|e| format!("Failed to open path: {}", e));
                }
              } else {
                if item.value.as_deref().unwrap_or("").is_empty() {
                  // Apply global templates to item name
                  let final_text = apply_global_templates(&item.name, &settings_map);
                  debug_output(|| {
                    println!("Copying item name to clipboard: {}", final_text);
                  });
                  manager
                    .write_text(final_text)
                    .expect("failed to write to clipboard");
                } else if let Some(ref item_value) = item.value {
                  let text_to_copy = remove_special_bbcode_tags(item_value);
                  // Apply global templates
                  let final_text = apply_global_templates(&text_to_copy, &settings_map);
                  debug_output(|| {
                    println!("Copying item value to clipboard: {}", final_text);
                  });
                  manager
                    .write_text(final_text)
                    .expect("failed to write to clipboard");
                }
              }

              #[cfg(target_os = "windows")]
              {
                thread::sleep(StdDuration::from_secs(3));
              }

              #[cfg(target_os = "macos")]
              fn query_accessibility_permissions() -> bool {
                macos_accessibility_client::accessibility::application_is_trusted_with_prompt()
              }

              #[cfg(target_os = "windows")]
              fn query_accessibility_permissions() -> bool {
                return true;
              }

              // Only auto-paste if not in copy-only mode
              if !is_copy_only {
                #[cfg(any(target_os = "windows", target_os = "macos"))]
                if query_accessibility_permissions() {
                  VKey.press_paste();
                } else {
                  w.show().unwrap();
                  w.emit("macosx-permissions-modal", "show").unwrap();
                }
              }

              w.emit("execMenuItemById", item_id).unwrap();
            } else {
              let app_clone = app.clone();
              let item_id_string = item_id.to_string();

              thread::spawn(move || {
                let rt = tokio::runtime::Runtime::new().unwrap();

                let delay = if cfg!(target_os = "windows") { 3 } else { 0 };

                rt.block_on(async {
                  if is_copy_only {
                    // For copy-only mode, use copy function instead of copy-paste
                    clipboard_commands::copy_clip_item(app_clone, item_id_string, true).await;
                  } else {
                    copy_paste_clip_item_from_menu(app_clone, item_id_string, delay).await;
                  }
                });
              });
            }
          } else {
            debug_output(|| {
              println!(
                "Item not found in db_items_state, checking recent history for: {:?}",
                item_id
              );
            });

            let recent_history_state: tauri::State<DbRecentHistoryItems> =
              app.state::<DbRecentHistoryItems>();
            let db_recent_history_items_state = recent_history_state.0.lock().unwrap();

            if let Some(history_item) = db_recent_history_items_state
              .iter()
              .find(|&item| item.history_id == item_id)
            {
              let detailed_history_item =
                history_service::get_clipboard_history_by_id(&history_item.history_id);

              if detailed_history_item.is_none() {
                debug_output(|| {
                  println!("History item not found");
                });
              }

              let detailed_history_item = detailed_history_item.unwrap();

              let mut manager = app.clipboard_manager();

              if let (Some(true), Some(false)) = (
                detailed_history_item.is_image,
                detailed_history_item.is_link,
              ) {
                let image_path = match detailed_history_item.image_path_full_res {
                  Some(path) => path,
                  None => return (),
                };

                // Convert relative path to absolute path
                let absolute_path = db::to_absolute_image_path(&image_path);
                let img_data =
                  std::fs::read(&absolute_path).expect("Failed to read image from path");
                let base64_image = base64::encode(&img_data);

                write_image_to_clipboard(base64_image).expect("Failed to write image to clipboard");
              } else {
                let value = match detailed_history_item.value {
                  Some(val) => val,
                  None => return (),
                };
                // Apply global templates
                let final_text = apply_global_templates(&value, &settings_map);
                manager
                  .write_text(final_text)
                  .expect("failed to write to clipboard");
              }

              #[cfg(target_os = "windows")]
              {
                thread::sleep(StdDuration::from_secs(3));
              }

              #[cfg(target_os = "macos")]
              fn query_accessibility_permissions() -> bool {
                macos_accessibility_client::accessibility::application_is_trusted_with_prompt()
              }

              #[cfg(target_os = "windows")]
              fn query_accessibility_permissions() -> bool {
                return true;
              }

              // Only auto-paste if not in copy-only mode
              if !is_copy_only {
                #[cfg(any(target_os = "windows", target_os = "macos"))]
                if query_accessibility_permissions() {
                  VKey.press_paste();
                } else {
                  w.show().unwrap();
                  w.emit("macosx-permissions-modal", "show").unwrap();
                }
              }

              w.emit("execMenuItemById", item_id).unwrap();
            } else {
              debug_output(|| {
                println!("No item found with id: {:?}", item_id);
              });
            }
          }
        }
      },
      #[cfg(target_os = "windows")]
      SystemTrayEvent::LeftClick { .. } => {
        let app_settings = app.state::<Mutex<HashMap<String, Setting>>>();
        let settings_map = app_settings.lock().unwrap();
        let enable_left_click = settings_map
          .get("isLeftClickTrayToOpenEnabledOnWindows")
          .and_then(|setting| setting.value_bool)
          .unwrap_or(false);

        if enable_left_click {
          let window = app.get_window("main").unwrap();
          if window.is_visible().unwrap() {
            window.hide().unwrap();
            window
              .emit_all("window-events", "main-window-hide")
              .unwrap();
          } else {
            window.show().unwrap();
            window.unminimize().unwrap();
            window.set_focus().unwrap();
            window
              .emit_all("window-events", "main-window-show")
              .unwrap();
          }
        }
      }
      #[cfg(target_os = "windows")]
      SystemTrayEvent::DoubleClick { .. } => {
        let app_settings = app.state::<Mutex<HashMap<String, Setting>>>();
        let settings_map = app_settings.lock().unwrap();
        let is_enabled = settings_map
          .get("isDoubleClickTrayToOpenEnabledOnWindows")
          .and_then(|setting| setting.value_bool)
          .unwrap_or(true);

        if is_enabled {
          let window = app.get_window("main").unwrap();
          if window.is_visible().unwrap() {
            window.hide().unwrap();
            window
              .emit_all("window-events", "main-window-hide")
              .unwrap();
          } else {
            window.show().unwrap();
            window.unminimize().unwrap();
            window.set_focus().unwrap();
            window
              .emit_all("window-events", "main-window-show")
              .unwrap();
          }
        }
      }
      _ => {}
    })
    .on_window_event(|event| {
      let apply_offset = || {
        let _win = event.window();
        #[cfg(target_os = "macos")]
        if _win.label() == "main" {
          _win.position_traffic_lights(-10., -10.);
        }
        #[cfg(target_os = "macos")]
        if _win.label() == "history" {
          _win.position_traffic_lights(-10., -10.);
        }
      };

      match event.event() {
        tauri::WindowEvent::CloseRequested { api, .. } => {
          let _win = event.window();
          if _win.label() != "history" {
            _win.emit_all("window-events", "main-window-hide").unwrap();

            event.window().hide().unwrap();
            api.prevent_close();
          }
        }
        tauri::WindowEvent::Focused(false) => {}
        tauri::WindowEvent::ThemeChanged(..) => apply_offset(),
        tauri::WindowEvent::Resized(..) => apply_offset(),
        _ => {}
      }
    })
    .setup(|app| {
      db::init(app);
      let app_settings = get_all_settings(None).unwrap_or_default();
      cron_jobs::setup_cron_jobs();

      #[cfg(target_os = "macos")]
      {
        let settings_map = app_settings.lock().unwrap();
        if let Some(setting) = settings_map.get("isHideMacOSDockIcon") {
          if let Some(value_bool) = &setting.value_bool {
            if *value_bool {
              app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
          }
        }
      }

      let mut window_min_inner_width = 720.;

      // if settings isHistoryPanelVisibleOnly is true set min inner size to 310 width
      {
        let settings_map = app_settings.lock().unwrap();
        if let Some(setting) = settings_map.get("isHistoryPanelVisibleOnly") {
          if let Some(value_bool) = &setting.value_bool {
            if *value_bool {
              window_min_inner_width = 310.;
            }
          }
        }
      }

      app.manage(app_settings);

      let menu = Menu::new().add_submenu(Submenu::new(
        "FlowPaster",
        Menu::new()
          .add_native_item(MenuItem::CloseWindow)
          .add_native_item(MenuItem::Copy)
          .add_native_item(MenuItem::SelectAll)
          .add_native_item(MenuItem::Undo)
          .add_native_item(MenuItem::Redo)
          .add_native_item(MenuItem::Paste),
      ));

      let mut window_builder =
        tauri::WindowBuilder::new(app, "main", tauri::WindowUrl::App("index.html".into()))
          .inner_size(1100., 730.)
          .min_inner_size(window_min_inner_width, 620.)
          // .decorations(false)
          // .title_bar_style(tauri::TitleBarStyle::Overlay)
          // .hidden_title(true)
          // transparent does use private APIs on Mac OS and is not recommended
          //.transparent(true)
          .disable_file_drop_handler()
          .menu(menu)
          .visible(false);

      #[cfg(target_os = "macos")]
      {
        window_builder = window_builder
          .title_bar_style(tauri::TitleBarStyle::Overlay)
          .hidden_title(true);
      }

      #[cfg(target_os = "windows")]
      {
        window_builder = window_builder.decorations(false).transparent(true);
      }

      let window = window_builder.build()?;

      // set dynamic title for window for Pro version
      window.set_title("FlowPaster").unwrap();

      #[cfg(target_os = "windows")]
      {
        window.set_decorations(false).unwrap();
      }

      #[cfg(target_os = "macos")]
      {
        window.set_transparent_titlebar(true);
        window.position_traffic_lights(-10., -10.);
        window.set_decorations(true).unwrap();
      }

      {
        let app_handle = app.app_handle();

        {
          let app_settings_local = app_handle.state::<Mutex<HashMap<String, Setting>>>();
          let settings_map = app_settings_local.lock().unwrap();
          if let Some(setting) = settings_map.get("userSelectedLanguage") {
            if let Some(value_text) = &setting.value_text {
              Translations::set_user_language(&value_text);
            }
          }
        }

        let is_tray_icon_hidden = {
          let app_settings_for_tray = app_handle.state::<Mutex<HashMap<String, Setting>>>();
          let settings_map = app_settings_for_tray.lock().unwrap();
          settings_map
            .get("isTrayIconHidden")
            .and_then(|setting| setting.value_bool)
            .unwrap_or(false)
        };

        if !is_tray_icon_hidden {
          if let Err(error_msg) = build_app_tray(&app_handle) {
            debug_output(|| {
              println!("Failed to build tray menu: {}", error_msg);
            });
          }
        }

        {
          let app_handle_clone = app_handle.clone();

          let debounced_save_position = debounce(
            move |_: ()| {
              println!("Saving window state main window");
              app_handle_clone
                .save_window_state(StateFlags::POSITION)
                .unwrap_or_else(|e| eprintln!("Failed to save window position: {}", e));
            },
            StdDuration::from_secs(1),
          );

          let debounced_save_size = debounce(
            move |_: ()| {
              app_handle
                .save_window_state(StateFlags::SIZE)
                .unwrap_or_else(|e| eprintln!("Failed to save window size: {}", e));
            },
            StdDuration::from_secs(1),
          );

          window.on_window_event(move |e| match e {
            tauri::WindowEvent::Moved(_) => {
              debounced_save_position.call(());
            }
            tauri::WindowEvent::Resized(_) => {
              debounced_save_size.call(());
            }
            _ => {}
          });
        }
      }

      if cfg!(debug_assertions) {
        #[cfg(debug_assertions)]
        {
          window.open_devtools();
        }
      } else {
        window.hide().unwrap();
      }

      let handle = app.handle().clone();
      let w = app.get_window("main").unwrap();

      let _ = tauri_plugin_deep_link::register("flowpaster", move |request| {
        debug_output(|| {
          println!("scheme request received: {:?}", &request);
        });
        if request.starts_with("flowpaster://") {
          w.show().unwrap();
          w.set_focus().unwrap();
          handle.emit_all("scheme-request-received", request).unwrap();
        }
      })
      .unwrap();

      #[cfg(not(target_os = "macos"))]
      // on macos the plugin handles this (macos doesn't use cli args for the url)
      if let Some(url) = std::env::args().nth(1) {
        debug_output(|| {
          println!("scheme request received on start url: {:?}", &url);
        });
        if url.starts_with("flowpaster://") {
          let w = app.get_window("main").unwrap();
          w.show().unwrap();
          w.set_focus().unwrap();
          app
            .handle()
            .emit_all("scheme-request-received", url)
            .unwrap();
        }
      }

      #[cfg(target_os = "windows")]
      {
        register_quickpaste_keyboard_hooks(app.handle().clone());
        std::thread::spawn(move || {
          inputbot::handle_input_events();
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      app_ready,
      get_app_settings,
      update_setting,
      update_left_click_tray_env,
      set_tray_icon_hidden,
      backup_restore_commands::create_backup,
      backup_restore_commands::list_backups,
      backup_restore_commands::restore_backup,
      backup_restore_commands::delete_backup,
      backup_restore_commands::get_data_paths,
      tabs_commands::delete_tab,
      tabs_commands::create_tab,
      tabs_commands::update_tab,
      tabs_commands::update_tabs,
      items_commands::upload_image_file_to_item_id,
      items_commands::create_item,
      items_commands::duplicate_item,
      items_commands::duplicate_menu_item,
      items_commands::update_item_by_id,
      items_commands::update_items_by_ids,
      items_commands::update_menu_item_by_id,
      items_commands::update_menu_items_by_ids,
      items_commands::update_item_value_by_history_id,
      items_commands::delete_item_by_id,
      items_commands::delete_items_by_ids,
      items_commands::delete_image_by_item_by_id,
      items_commands::delete_menu_item_by_id,
      items_commands::delete_menu_items_by_ids,
      items_commands::update_pinned_items_by_ids,
      items_commands::unpin_all_items_clips,
      items_commands::move_pinned_clip_item_up_down,
      items_commands::add_image_to_item_id,
      items_commands::link_clip_to_menu_item,
      items_commands::save_to_file_clip_item,
      clipboard_commands::copy_text,
      clipboard_commands::copy_paste,
      clipboard_commands::copy_history_item,
      clipboard_commands::quickpaste_copy_history_item,
      clipboard_commands::quickpaste_copy_history_items,
      clipboard_commands::copy_paste_history_item,
      clipboard_commands::copy_paste_clip_item,
      clipboard_commands::copy_clip_item,
      clipboard_commands::run_form_fill,
      clipboard_commands::run_template_fill,
      link_metadata_commands::fetch_link_metadata,
      link_metadata_commands::fetch_path_metadata,
      link_metadata_commands::fetch_link_track_metadata,
      link_metadata_commands::validate_audio,
      link_metadata_commands::delete_link_metadata,
      link_metadata_commands::get_link_metadata_by_item_id,
      link_metadata_commands::copy_link_metadata_to_new_item_id,
      link_metadata_commands::download_audio,
      collections_commands::get_collections,
      collections_commands::create_collection,
      collections_commands::get_collection,
      collections_commands::delete_collection_by_id,
      collections_commands::get_active_collection_with_menu_items,
      collections_commands::get_active_collection_with_clips,
      collections_commands::update_moved_menu_items_in_collection,
      collections_commands::update_collection_by_id,
      collections_commands::select_collection_by_id,
      collections_commands::update_moved_clips_in_collection,
      history_commands::get_clipboard_history,
      history_commands::get_clipboard_history_pinned,
      history_commands::get_clipboard_history_by_id,
      history_commands::delete_clipboard_history_by_ids,
      history_commands::find_clipboard_histories_by_value_or_filters,
      history_commands::get_recent_clipboard_histories,
      history_commands::get_clipboard_histories_within_date_range,
      history_commands::clear_clipboard_history_older_than,
      history_commands::clear_recent_clipboard_history,
      history_commands::count_clipboard_histories,
      history_commands::insert_clipboard_history,
      history_commands::update_clipboard_history_by_id,
      history_commands::update_clipboard_history_by_ids,
      history_commands::update_pinned_clipboard_history_by_ids,
      history_commands::unpin_all_clipboard_history_items,
      history_commands::move_pinned_item_up_down,
      history_commands::find_clipboard_history_by_id,
      history_commands::search_clipboard_histories_by_value_or_filters,
      history_commands::save_to_file_history_item,
      history_commands::get_history_items_source_apps,
      menu::build_system_menu,
      get_device_id,
      list_system_fonts,
      shell_commands::check_path,
      shell_commands::path_type_check,
      shell_commands::run_shell_command,
      request_commands::run_web_request,
      request_commands::run_web_scraping,
      translations_commands::update_translation_keys,
      translations_commands::change_menu_language,
      security_commands::hash_password,
      security_commands::verify_password,
      security_commands::store_os_password,
      security_commands::verify_os_password,
      security_commands::delete_os_password,
      security_commands::get_stored_os_password,
      user_settings_command::cmd_get_custom_db_path,
      // user_settings_command::cmd_set_custom_db_path, // Replaced by cmd_set_and_relocate_db
      // user_settings_command::cmd_remove_custom_db_path, // Replaced by cmd_revert_to_default_db_location
      user_settings_command::cmd_create_directory,
      user_settings_command::cmd_validate_custom_db_path,
      user_settings_command::cmd_check_custom_data_path,
      user_settings_command::cmd_set_and_relocate_data,
      user_settings_command::cmd_revert_to_default_data_location,
      user_settings_command::cmd_get_all_settings,
      user_settings_command::cmd_get_setting,
      user_settings_command::cmd_set_setting,
      user_settings_command::cmd_remove_setting,
      format_converter_commands::format_convert,
      open_osx_accessibility_preferences,
      check_osx_accessibility_preferences,
      open_path_or_app,
      autostart,
      is_autostart_enabled,
      open_history_window,
      open_quickpaste_window,
      quickpaste_hide_paste_close,
      quickpaste_hide_paste,
      quickpaste_paste_many,
      close_quickpaste_restore_focus,
      set_quickpaste_search_active,
      restore_quickpaste_previous_focus,
      set_icon
    ])
    .plugin(clipboard::init())
    .plugin(
      window_state::Builder::default()
        .skip_initial_state("quickpaste")
        .build(),
    )
    .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
      debug_output(|| {
        println!("{}, {argv:?}, {cwd}", app.package_info().name);
      })
    }))
    .run(tauri::generate_context!())
    .expect("Error While Running FlowPaster App");
}

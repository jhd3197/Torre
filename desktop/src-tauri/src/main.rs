//! Torre on the desktop: the studio (`python -m torre serve`) in its own window.
//!
//! The installer ships a standalone Python with Torre installed into it (built by
//! scripts/build_runtime.py). On launch the window shows the splash page, starts that
//! Python on a fixed local port, and loads the studio once it answers. The server stops when
//! its standard input closes, which happens when Torre quits or crashes; on Windows a job
//! object also stops it (and the engines it runs) if it does not.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// Fixed, so the studio's origin (and the settings it keeps in localStorage) is the same on
/// every launch. London 1851, the first international tournament (`torre serve` keeps 1886).
const PORT: u16 = 1851;
/// The first launch migrates data and starts background jobs before the server listens.
const START_TIMEOUT: Duration = Duration::from_secs(90);
/// How long a quitting server gets to close its engines before it is killed.
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// The server and the pipe to its standard input; closing the pipe asks it to stop.
struct Server(Mutex<Option<(Child, ChildStdin)>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let opener = app.handle().clone();
            let new_window = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Torre")
                .inner_size(1280.0, 840.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .on_navigation(move |url| {
                    if is_local(url) {
                        return true;
                    }
                    let _ = opener.opener().open_url(url.as_str(), None::<&str>);
                    false
                })
                .on_new_window(move |url, _features| {
                    // target="_blank" links (engine sources, API key pages, YouTube) go to the browser.
                    let _ = new_window.opener().open_url(url.as_str(), None::<&str>);
                    NewWindowResponse::Deny
                })
                .build()?;

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let Some(window) = handle.get_webview_window("main") else { return };
                match start(&handle) {
                    Ok(()) => {
                        let url = Url::parse(&format!("http://127.0.0.1:{PORT}/")).unwrap();
                        let _ = window.navigate(url);
                    }
                    Err((message, detail)) => {
                        let _ = window.eval(format!(
                            "torreFailed({}, {})",
                            serde_json::to_string(&message).unwrap(),
                            serde_json::to_string(&detail).unwrap()
                        ));
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Torre could not start")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some((child, stdin)) = app.state::<Server>().0.lock().unwrap().take() {
                    drop(stdin);
                    stop(child);
                }
            }
        });
}

/// The splash page and the studio stay in the window; everything else opens in the browser.
fn is_local(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost")),
        "mailto" => false,
        _ => true,
    }
}

/// Start the bundled Python and wait until the studio answers; on failure, a message and
/// the end of the server's log.
fn start(app: &AppHandle) -> Result<(), (String, String)> {
    let address = SocketAddr::from(([127, 0, 0, 1], PORT));
    if answers(&address) {
        return Err((format!("Another program is already using port {PORT}. Close it and open Torre again."), String::new()));
    }

    let runtime = runtime_dir(app).ok_or_else(|| {
        ("Torre's Python is missing from the install. Reinstall Torre.".to_string(), String::new())
    })?;
    let python = runtime.join("python").join(PYTHON);
    // After STOCKFISH_PATH and ~/.torre/engine, Torre looks for Stockfish on PATH: this one.
    let mut path = vec![runtime.join("stockfish")];
    path.extend(std::env::var_os("PATH").iter().flat_map(std::env::split_paths));
    let path = std::env::join_paths(path).map_err(|e| (e.to_string(), String::new()))?;
    let log = app
        .path()
        .app_log_dir()
        .map(|dir| dir.join("server.log"))
        .map_err(|e| (format!("No folder for the log: {e}"), String::new()))?;
    let _ = std::fs::create_dir_all(log.parent().unwrap());
    let out = File::create(&log).map_err(|e| (format!("Cannot write {}: {e}", log.display()), String::new()))?;
    let err = out.try_clone().map_err(|e| (e.to_string(), String::new()))?;

    let mut command = Command::new(&python);
    command
        .args(["-m", "torre", "serve", "--port", &PORT.to_string(), "--until-stdin-closes"])
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONUTF8", "1")
        .env("PATH", path)
        .stdin(Stdio::piped())
        .stdout(out)
        .stderr(err);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| (format!("Cannot start {}: {e}", python.display()), String::new()))?;
    #[cfg(windows)]
    stop_with_app(&child);
    let stdin = child.stdin.take().expect("stdin is piped");
    let server = &app.state::<Server>().0;
    *server.lock().unwrap() = Some((child, stdin));

    let started = Instant::now();
    loop {
        if answers(&address) {
            return Ok(());
        }
        if let Some((child, _)) = server.lock().unwrap().as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                return Err((format!("The studio stopped ({status})."), tail(&log)));
            }
        }
        if started.elapsed() > START_TIMEOUT {
            return Err(("The studio took too long to start.".to_string(), tail(&log)));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// Wait for a server whose stdin was closed to stop, and kill it if it takes too long.
fn stop(mut child: Child) {
    let asked = Instant::now();
    while asked.elapsed() < STOP_TIMEOUT {
        if !matches!(child.try_wait(), Ok(None)) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn answers(address: &SocketAddr) -> bool {
    TcpStream::connect_timeout(address, Duration::from_millis(200)).is_ok()
}

const PYTHON: &str = if cfg!(windows) { "python.exe" } else { "bin/python3" };

/// The folder holding python/ and stockfish/: the app's resources once installed, or what
/// build_runtime.py made (tauri dev).
fn runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources);
    }
    candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime"));
    candidates.into_iter().find(|dir| dir.join("python").join(PYTHON).is_file())
}

/// The last lines of the server's log, for the error page.
fn tail(log: &Path) -> String {
    let text = std::fs::read_to_string(log).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(15)..].join("\n")
}

/// Put the server in a job that Windows kills when Torre's last handle to it closes, so the
/// server (and the engines it runs) never outlive the window, even after a crash.
#[cfg(windows)]
fn stop_with_app(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return;
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of_val(&info) as u32,
        );
        AssignProcessToJobObject(job, child.as_raw_handle() as _);
        // The job handle is never closed: it lives as long as this process does.
    }
}

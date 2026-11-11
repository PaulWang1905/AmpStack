import { homedir } from "node:os";
import { join } from "node:path";

// Resolve at launch time: Cargo's TOML paths do not expand $HOME or ~.
process.env.CARGO_TARGET_DIR = join(homedir(), "build_dir", "AmpStack");

// Run the installed CLI in this process, preserving arguments and signal handling.
await import("@tauri-apps/cli/tauri.js");

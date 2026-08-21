/**
 * Cross-platform clipboard helper with native CLI and OSC 52 fallback.
 */

import { execFileSync, spawn } from "node:child_process";
import { platform } from "node:os";

const MAX_OSC52_ENCODED_LENGTH = 100_000;

export async function copyToSystemClipboard(text: string): Promise<boolean> {
	if (!text) return true;

	const p = platform();

	try {
		if (p === "darwin") {
			const proc = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
			proc.stdin.write(text);
			proc.stdin.end();
			return await new Promise<boolean>((resolve) => {
				proc.on("close", (code) => resolve(code === 0));
				proc.on("error", () => resolve(false));
			});
		}

		if (p === "win32") {
			const proc = spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"] });
			proc.stdin.write(text);
			proc.stdin.end();
			return await new Promise<boolean>((resolve) => {
				proc.on("close", (code) => resolve(code === 0));
				proc.on("error", () => resolve(false));
			});
		}

		if (p === "linux") {
			if (process.env.TERMUX_VERSION) {
				try {
					execFileSync("termux-clipboard-set", [text], { timeout: 3000, stdio: "ignore" });
					return true;
				} catch {}
			}
			if (process.env.WAYLAND_DISPLAY) {
				try {
					const proc = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
					proc.stdin.write(text);
					proc.stdin.end();
					const ok = await new Promise<boolean>((resolve) => {
						proc.on("close", (code) => resolve(code === 0));
						proc.on("error", () => resolve(false));
					});
					if (ok) return true;
				} catch {}
			}
			if (process.env.DISPLAY) {
				try {
					const proc = spawn("xclip", ["-selection", "clipboard"], { stdio: ["pipe", "ignore", "ignore"] });
					proc.stdin.write(text);
					proc.stdin.end();
					const ok = await new Promise<boolean>((resolve) => {
						proc.on("close", (code) => resolve(code === 0));
						proc.on("error", () => resolve(false));
					});
					if (ok) return true;
				} catch {}
			}
		}
	} catch {
		// Fallback to OSC 52
	}

	try {
		const encoded = Buffer.from(text).toString("base64");
		if (encoded.length <= MAX_OSC52_ENCODED_LENGTH) {
			process.stdout.write(`\x1b]52;c;${encoded}\x07`);
			return true;
		}
	} catch {}

	return false;
}

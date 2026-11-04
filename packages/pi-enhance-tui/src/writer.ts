/**
 * High-performance terminal writer optimized for Bun stdout runtime.
 */

export interface TerminalOutputWriter {
	write(data: string): void;
	flush?(): void;
}

interface BunStdoutWriterLike {
	write(chunk: string | Uint8Array): number | undefined;
	flush(): number | undefined;
}

interface BunGlobalLike {
	stdout?: {
		writer?: (options?: { highWaterMark?: number }) => BunStdoutWriterLike;
	};
}

export class BunTerminalWriter implements TerminalOutputWriter {
	private bunWriter: BunStdoutWriterLike | undefined;

	constructor() {
		const bunGlobal = (globalThis as unknown as { Bun?: BunGlobalLike }).Bun;
		if (bunGlobal?.stdout && typeof bunGlobal.stdout.writer === "function") {
			try {
				this.bunWriter = bunGlobal.stdout.writer();
			} catch {
				this.bunWriter = undefined;
			}
		}
	}

	get isBunWriterActive(): boolean {
		return this.bunWriter !== undefined;
	}

	write(data: string): void {
		try {
			if (this.bunWriter) {
				this.bunWriter.write(data);
				this.bunWriter.flush();
			} else {
				process.stdout.write(data);
			}
		} catch {
			// Ignore EIO, EPIPE, or closed terminal stream errors on suspend/exit
		}
	}

	flush(): void {
		if (this.bunWriter) {
			try {
				this.bunWriter.flush();
			} catch {
				// Ignore flush errors on closed stdout
			}
		}
	}
}

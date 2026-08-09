interface SensitiveDownloadRuntime {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly click: (url: string, filename: string) => void;
}

export function downloadSensitiveCodes(
  rawCodes: readonly string[],
  batchRef: string,
  runtime: SensitiveDownloadRuntime = browserRuntime(),
): void {
  const blob = new Blob([`${rawCodes.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const url = runtime.createObjectURL(blob);
  const filename = `kokoro-code-batch-${safeFilenamePart(batchRef)}.txt`;
  try { runtime.click(url, filename); }
  finally { runtime.revokeObjectURL(url); }
}

function browserRuntime(): SensitiveDownloadRuntime {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    click: (url, filename) => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.click();
      anchor.remove();
    },
  };
}

function safeFilenamePart(value: string): string {
  const safe = value.replaceAll(/[^A-Za-z0-9._-]/gu, "-").slice(0, 128);
  return safe.length === 0 ? "export" : safe;
}

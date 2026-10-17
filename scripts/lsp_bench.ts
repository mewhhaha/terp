import { median } from "./measure.ts";
import {
  fingerprint,
  host,
  implementation_files,
  revision,
} from "./provenance.ts";

type Message = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
};
const source_sha256 = await fingerprint(await implementation_files());
const child = new Deno.Command(Deno.execPath(), {
  args: ["lsp"],
  stdin: "piped",
  stdout: "piped",
  stderr: "null",
}).spawn();
const writer = child.stdin.getWriter();
const pending = new Map<
  number,
  { resolve(value: unknown): void; reject(reason: unknown): void }
>();
const diagnostics: Message[] = [];
let next_id = 0;
const encoder = new TextEncoder();
async function send(message: Message): Promise<void> {
  const body = encoder.encode(JSON.stringify({ jsonrpc: "2.0", ...message }));
  const header = encoder.encode("Content-Length: " + body.length + "\r\n\r\n");
  const packet = new Uint8Array(header.length + body.length);
  packet.set(header);
  packet.set(body, header.length);
  await writer.write(packet);
}
function request(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const id = ++next_id;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("LSP request timed out: " + method));
    }, 30_000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timeout);
        resolve(value);
      },
      reject(reason) {
        clearTimeout(timeout);
        reject(reason);
      },
    });
    void send({ id, method, params }).catch(reject);
  });
}
const reader = (async () => {
  let buffer = new Uint8Array(0);
  for await (const chunk of child.stdout) {
    const joined = new Uint8Array(buffer.length + chunk.length);
    joined.set(buffer);
    joined.set(chunk, buffer.length);
    buffer = joined;
    while (true) {
      const separator = buffer.findIndex((byte, index) =>
        byte === 13 && buffer[index + 1] === 10 && buffer[index + 2] === 13 &&
        buffer[index + 3] === 10
      );
      if (separator < 0) break;
      const header = new TextDecoder().decode(buffer.subarray(0, separator));
      const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
      if (!Number.isFinite(length)) throw new Error(header);
      const end = separator + 4 + length;
      if (buffer.length < end) break;
      const message = JSON.parse(
        new TextDecoder().decode(buffer.subarray(separator + 4, end)),
      ) as Message;
      buffer = buffer.slice(end);
      if (
        message.method === "workspace/configuration" && message.id !== undefined
      ) {
        const items = message.params?.items as unknown[];
        await send({
          id: message.id,
          result: items.map(() => ({ enable: true, lint: false })),
        });
      } else if (message.method === "textDocument/publishDiagnostics") {
        diagnostics.push(message);
      } else if (message.id !== undefined) {
        const handler = pending.get(message.id);
        if (handler !== undefined) {
          pending.delete(message.id);
          if (message.error !== undefined) handler.reject(message.error);
          else handler.resolve(message.result);
        } else if (message.method !== undefined) {
          await send({ id: message.id, result: null });
        }
      }
    }
  }
})();
const timeout = setTimeout(() => {
  try {
    child.kill();
  } catch { /* Already exited. */ }
}, 90_000);
const uri = new URL("../bench/lsp-workload.ts", import.meta.url).href;
const valid =
  'import { terp } from "../mod.ts";\nconst value: number = terp("1 + 2");\nvalue;\n';
const invalid =
  'import { terp } from "../mod.ts";\nconst value: number = terp("1 +");\nvalue;\n';
async function diagnostic(version: number, invalid: boolean): Promise<number> {
  const start = performance.now();
  while (performance.now() - start < 30_000) {
    const matching = diagnostics.find((message) => {
      if (message.params?.uri !== uri || message.params.version !== version) {
        return false;
      }
      const entries = message.params.diagnostics as unknown[];
      return (entries.length > 0) === invalid;
    });
    if (matching !== undefined) {
      return (matching.params?.diagnostics as unknown[]).length;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(
    "timed out awaiting diagnostics version " + version + ": " +
      JSON.stringify(diagnostics),
  );
}
try {
  const initialized_start = performance.now();
  await request("initialize", {
    processId: Deno.pid,
    rootUri: new URL("../", import.meta.url).href,
    capabilities: {
      textDocument: { publishDiagnostics: { versionSupport: true } },
    },
    initializationOptions: { enable: true, lint: false },
  });
  await send({ method: "initialized", params: {} });
  await send({
    method: "textDocument/didOpen",
    params: {
      textDocument: {
        uri,
        languageId: "typescript",
        version: 1,
        text: invalid,
      },
    },
  });
  await diagnostic(1, true);
  const cold_diagnostic_ms = performance.now() - initialized_start;
  const samples = [];
  for (let index = 0; index < 6; index++) {
    const version = index + 2;
    const is_invalid = index % 2 === 1;
    let text = valid;
    if (is_invalid) text = invalid;
    const start = performance.now();
    await send({
      method: "textDocument/didChange",
      params: { textDocument: { uri, version }, contentChanges: [{ text }] },
    });
    const diagnostic_count = await diagnostic(version, is_invalid);
    const diagnostic_ms = performance.now() - start;
    const hover_start = performance.now();
    const hover = await request("textDocument/hover", {
      textDocument: { uri },
      position: { line: 1, character: 7 },
    });
    const hover_ms = performance.now() - hover_start;
    if (hover === null) throw new Error("empty LSP hover");
    const completion_start = performance.now();
    const completion = await request("textDocument/completion", {
      textDocument: { uri },
      position: { line: 2, character: 3 },
      context: { triggerKind: 1 },
    });
    const completion_ms = performance.now() - completion_start;
    if (completion === null) throw new Error("empty LSP completion");
    let completion_items: unknown[] = [];
    if (Array.isArray(completion)) completion_items = completion;
    else if (
      typeof completion === "object" && completion !== null &&
      "items" in completion && Array.isArray(completion.items)
    ) completion_items = completion.items;
    if (completion_items.length === 0) {
      throw new Error("LSP completion returned no items");
    }
    samples.push({
      version,
      is_invalid,
      diagnostic_count,
      diagnostic_ms,
      hover_ms,
      completion_ms,
      completion_item_count: completion_items.length,
    });
  }
  if (source_sha256 !== await fingerprint(await implementation_files())) {
    throw new Error("source changed during LSP measurement");
  }
  const report = {
    version: Deno.version,
    target: Deno.build.target,
    host: await host(),
    revision: await revision(),
    source_sha256,
    workload_sha256: await fingerprint(["scripts/lsp_bench.ts"]),
    method:
      "actual deno lsp JSON-RPC; six full-document edits alternating valid/invalid expressions; versioned diagnostics, hover, completion",
    cold_diagnostic_ms,
    medians: {
      diagnostic_ms: median(samples.map((sample) => sample.diagnostic_ms)),
      hover_ms: median(samples.map((sample) => sample.hover_ms)),
      completion_ms: median(samples.map((sample) => sample.completion_ms)),
    },
    samples,
  };
  if (Deno.args[0]) {
    await Deno.writeTextFile(
      Deno.args[0],
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  try {
    await request("shutdown", {});
    await send({ method: "exit", params: {} });
    await writer.close();
  } catch {
    child.kill();
  }
  await child.status;
  await reader;
}

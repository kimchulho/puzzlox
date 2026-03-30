/**
 * Apps in Toss partner API (server-side).
 * @see https://developers-apps-in-toss.toss.im/login/develop.html
 */
import https from "https";
import fs from "fs";

const DEFAULT_HOST = "apps-in-toss-api.toss.im";

export function getTossApiHost(): string {
  const raw = (process.env.TOSS_API_HOST || DEFAULT_HOST).replace(/^https?:\/\//, "").split("/")[0];
  return raw || DEFAULT_HOST;
}

export function createTossMtlsAgent(): https.Agent | undefined {
  const certPath = process.env.TOSS_MTLS_CERT_PATH;
  const keyPath = process.env.TOSS_MTLS_KEY_PATH;
  if (!certPath || !keyPath) {
    return undefined;
  }
  const opts: https.AgentOptions = {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
  if (process.env.TOSS_MTLS_CA_PATH) {
    opts.ca = fs.readFileSync(process.env.TOSS_MTLS_CA_PATH);
  }
  return new https.Agent(opts);
}

export async function tossPartnerRequest<T = unknown>(options: {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  jsonBody?: unknown;
}): Promise<{ statusCode: number; body: T }> {
  const host = getTossApiHost();
  const agent = createTossMtlsAgent();
  const payload =
    options.method === "POST" && options.jsonBody !== undefined
      ? JSON.stringify(options.jsonBody)
      : undefined;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: options.path,
        method: options.method,
        agent,
        headers: {
          ...options.headers,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: T;
          try {
            parsed = (text ? JSON.parse(text) : {}) as T;
          } catch {
            parsed = { _raw: text } as T;
          }
          resolve({ statusCode: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Apps in Toss partner API (server-side).
 * @see https://developers-apps-in-toss.toss.im/login/develop.html
 */
import https from "https";
import fs from "fs";

const DEFAULT_HOST = "apps-in-toss-api.toss.im";

/** Thrown when outbound HTTPS to Toss partner API fails (TLS, files, network). */
export class TossPartnerRequestError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "TossPartnerRequestError";
    this.code = code;
  }
}

export function getTossApiHost(): string {
  const raw = (process.env.TOSS_API_HOST || DEFAULT_HOST).replace(/^https?:\/\//, "").split("/")[0];
  return raw || DEFAULT_HOST;
}

export function createTossMtlsAgent(): https.Agent | undefined {
  const certPath = (process.env.TOSS_MTLS_CERT_PATH ?? "").trim();
  const keyPath = (process.env.TOSS_MTLS_KEY_PATH ?? "").trim();

  if (!certPath && !keyPath) {
    return undefined;
  }
  if (!certPath || !keyPath) {
    throw new TossPartnerRequestError(
      "TOSS_MTLS_CERT_PATH 와 TOSS_MTLS_KEY_PATH 는 둘 다 설정하거나 둘 다 비워 두세요. 한쪽만 있으면 mTLS 가 동작하지 않습니다.",
      "E_MTLS_INCOMPLETE",
    );
  }

  try {
    const opts: https.AgentOptions = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    };
    const caPath = (process.env.TOSS_MTLS_CA_PATH ?? "").trim();
    if (caPath) {
      opts.ca = fs.readFileSync(caPath);
    }
    return new https.Agent(opts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new TossPartnerRequestError(
      `mTLS 인증서/키 파일을 읽지 못했습니다 (${msg}). 경로와 PEM 형식을 확인하세요.`,
      "E_MTLS_READ",
    );
  }
}

export async function tossPartnerRequest<T = unknown>(options: {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  jsonBody?: unknown;
}): Promise<{ statusCode: number; body: T }> {
  const host = getTossApiHost();
  let agent: https.Agent | undefined;
  try {
    agent = createTossMtlsAgent();
  } catch (e) {
    if (e instanceof TossPartnerRequestError) throw e;
    throw new TossPartnerRequestError(e instanceof Error ? e.message : String(e), "E_MTLS_INIT");
  }

  if (!agent) {
    throw new TossPartnerRequestError(
      `토스 파트너 API(${host})는 클라이언트 인증서(mTLS)가 필요합니다. 서버 환경변수 TOSS_MTLS_CERT_PATH, TOSS_MTLS_KEY_PATH 에 토스에서 발급한 PEM 경로를 설정하세요. (선택: TOSS_MTLS_CA_PATH)`,
      "E_MTLS_MISSING",
    );
  }

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
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => {
      const code = err.code ?? undefined;
      const hint =
        code === "ECONNRESET" || code === "ETIMEDOUT"
          ? " 네트워크/방화벽 또는 상대 서버가 연결을 끊었을 수 있습니다."
          : code === "CERT_HAS_EXPIRED" || /expired/i.test(err.message)
            ? " 클라이언트 인증서 만료 여부를 확인하세요."
            : /unable to verify|UNABLE_TO_VERIFY|certificate/i.test(err.message)
              ? " TOSS_MTLS_CA_PATH(토스 안내 CA) 또는 인증서 체인을 확인하세요."
              : /bad decrypt|bad password|mac verify failure/i.test(err.message)
                ? " 개인키(TOSS_MTLS_KEY_PATH)가 인증서와 짝이 맞는지, 암호화된 키면 복호화 가능한지 확인하세요."
                : "";
      reject(
        new TossPartnerRequestError(
          `${options.method} https://${host}${options.path} — ${err.message}${code ? ` [${code}]` : ""}.${hint}`,
          code,
        ),
      );
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

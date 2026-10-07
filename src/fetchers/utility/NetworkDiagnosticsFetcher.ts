import dns from "node:dns/promises";
import tls from "node:tls";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { USER_AGENT } from "../../constants.ts";
import {
  assertPublicHost,
  fetchPublicUrl,
  publicAddressLookup,
} from "../web/SsrfGuard.ts";

const execFileAsync = promisify(execFile);

// ─── DNS Lookup ────────────────────────────────────────────────────

interface DnsLookupResult {
  hostname: string;
  recordType: string;
  records: unknown[];
  count: number;
}

const VALID_RECORD_TYPES = ["A", "AAAA", "MX", "CNAME", "TXT", "NS", "SOA", "SRV", "CAA", "PTR"];

export async function dnsLookup(
  hostname: string,
  recordType: string = "A",
): Promise<DnsLookupResult> {
  const normalizedRecordType = recordType.toUpperCase();
  if (!VALID_RECORD_TYPES.includes(normalizedRecordType)) {
    throw new Error(
      `Invalid record type: ${recordType}. Valid types: ${VALID_RECORD_TYPES.join(", ")}`,
    );
  }
  const rawRecords = await dns.resolve(hostname, normalizedRecordType);
  const records = Array.isArray(rawRecords) ? rawRecords : [rawRecords];
  return {
    hostname,
    recordType: normalizedRecordType,
    records,
    count: records.length,
  };
}

// ─── WHOIS Lookup ──────────────────────────────────────────────────

interface WhoisLookupResult {
  domain: string;
  registrar: string | null;
  registrarUrl: string | null;
  creationDate: string | null;
  expirationDate: string | null;
  updatedDate: string | null;
  status: string[];
  nameservers: string[];
  dnssec: string | null;
  rawText: string;
}

export async function whoisLookup(domain: string): Promise<WhoisLookupResult> {
  const { whoisDomain } = await import("whoiser");
  const whoisResult = await whoisDomain(domain, { follow: 1, timeout: 10_000 });

  // whoiser returns a record keyed by WHOIS server
  const serverKeys = Object.keys(whoisResult);
  const primaryData =
    serverKeys.length > 0
      ? (whoisResult[serverKeys[0]] as Record<string, unknown>)
      : {};

  const extractField = (fieldKeys: string[]): string | null => {
    for (const fieldKey of fieldKeys) {
      const fieldValue = primaryData[fieldKey];
      if (fieldValue) {
        return Array.isArray(fieldValue) ? fieldValue[0] : String(fieldValue);
      }
    }
    return null;
  };

  const extractArray = (fieldKeys: string[]): string[] => {
    for (const fieldKey of fieldKeys) {
      const fieldValue = primaryData[fieldKey];
      if (fieldValue) {
        return Array.isArray(fieldValue)
          ? fieldValue.map(String)
          : [String(fieldValue)];
      }
    }
    return [];
  };

  const rawText =
    typeof primaryData.__raw === "string"
      ? (primaryData.__raw as string)
      : JSON.stringify(primaryData, null, 2);

  return {
    domain,
    registrar: extractField(["Registrar", "registrar"]),
    registrarUrl: extractField([
      "Registrar URL",
      "Registrar Url",
      "registrar_url",
    ]),
    creationDate: extractField([
      "Creation Date",
      "Created Date",
      "created",
      "Registration Date",
    ]),
    expirationDate: extractField([
      "Registry Expiry Date",
      "Expiration Date",
      "expires",
      "Expiry Date",
    ]),
    updatedDate: extractField(["Updated Date", "Last Updated", "changed"]),
    status: extractArray(["Domain Status", "Status", "status"]),
    nameservers: extractArray(["Name Server", "nserver", "Nameservers"]),
    dnssec: extractField(["DNSSEC", "dnssec"]),
    rawText: rawText.slice(0, 4000),
  };
}

// ─── SSL Certificate Check ─────────────────────────────────────────

interface SslCertificateResult {
  hostname: string;
  port: number;
  valid: boolean;
  issuer: Record<string, unknown>;
  subject: Record<string, unknown>;
  subjectAltNames: string[];
  serialNumber: string;
  validFrom: string;
  validTo: string;
  daysUntilExpiry: number;
  fingerprint: string;
  fingerprint256: string;
  protocol: string;
  cipher: { name: string; version: string };
  keyExchange: string | undefined;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

export function sslCertificateCheck(
  hostname: string,
  port: number = 443,
): Promise<SslCertificateResult> {
  return new Promise((resolve, reject) => {
    // A caller's host: only a public address, checked as it is connected to
    assertPublicHost(hostname);
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: false,
        lookup: publicAddressLookup,
      },
      () => {
        try {
          const certificate = socket.getPeerCertificate();
          const cipher = socket.getCipher();
          const protocol = socket.getProtocol() || "unknown";

          const validFrom = new Date(certificate.valid_from);
          const validTo = new Date(certificate.valid_to);
          const currentTimestamp = new Date();
          const millisecondsPerDay = 86_400_000;
          const daysUntilExpiry = Math.floor(
            (validTo.getTime() - currentTimestamp.getTime()) / millisecondsPerDay,
          );

          const subjectAltNames = certificate.subjectaltname
            ? certificate.subjectaltname
                .split(",")
                .map((entry: string) => entry.trim().replace(/^DNS:/, ""))
            : [];

          resolve({
            hostname,
            port,
            valid: socket.authorized,
            issuer: certificate.issuer || {},
            subject: certificate.subject || {},
            subjectAltNames,
            serialNumber: certificate.serialNumber || "",
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            daysUntilExpiry,
            fingerprint: certificate.fingerprint || "",
            fingerprint256: certificate.fingerprint256 || "",
            protocol,
            cipher: {
              name: cipher?.name || "unknown",
              version: cipher?.version || "unknown",
            },
            keyExchange: undefined,
            isExpired: daysUntilExpiry < 0,
            isExpiringSoon: daysUntilExpiry >= 0 && daysUntilExpiry <= 30,
          });
        } finally {
          socket.destroy();
        }
      },
    );

    socket.setTimeout(10_000);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`SSL connection to ${hostname}:${port} timed out`));
    });
    socket.on("error", (error: Error) => {
      reject(
        new Error(
          `SSL connection to ${hostname}:${port} failed: ${error.message}`,
        ),
      );
    });
  });
}

// ─── Port Scan ─────────────────────────────────────────────────────

interface PortScanResult {
  host: string;
  openPorts: { port: number; service: string }[];
  closedPorts: number[];
  scanDurationMs: number;
}

const COMMON_PORT_SERVICES: Record<number, string> = {
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  110: "POP3",
  143: "IMAP",
  443: "HTTPS",
  465: "SMTPS",
  587: "SMTP Submission",
  993: "IMAPS",
  995: "POP3S",
  3000: "Dev Server",
  3306: "MySQL",
  5432: "PostgreSQL",
  5672: "RabbitMQ",
  6379: "Redis",
  8080: "HTTP Proxy",
  8443: "HTTPS Alt",
  9200: "Elasticsearch",
  27017: "MongoDB",
};

const DEFAULT_SCAN_PORTS = [
  21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3000, 3306, 5432,
  6379, 8080, 8443, 27017,
];

function scanSinglePort(
  host: string,
  port: number,
  timeoutMs: number = 2000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export async function portScan(
  host: string,
  ports?: number[],
): Promise<PortScanResult> {
  const targetPorts = ports && ports.length > 0 ? ports : DEFAULT_SCAN_PORTS;
  // Cap at 50 ports to prevent abuse
  const cappedPorts = targetPorts.slice(0, 50);
  const scanStartTime = Date.now();

  const scanResults = await Promise.all(
    cappedPorts.map(async (port) => ({
      port,
      isOpen: await scanSinglePort(host, port),
    })),
  );

  const openPorts = scanResults
    .filter((portResult) => portResult.isOpen)
    .map((portResult) => ({
      port: portResult.port,
      service: COMMON_PORT_SERVICES[portResult.port] || "Unknown",
    }));

  const closedPorts = scanResults
    .filter((portResult) => !portResult.isOpen)
    .map((portResult) => portResult.port);

  return {
    host,
    openPorts,
    closedPorts,
    scanDurationMs: Date.now() - scanStartTime,
  };
}

// ─── HTTP Headers ──────────────────────────────────────────────────

interface SecurityHeaderGrade {
  header: string;
  present: boolean;
  value: string | null;
  grade: "good" | "warning" | "missing";
}

interface HttpHeadersResult {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  securityHeaders: SecurityHeaderGrade[];
  securityScore: number;
  server: string | null;
  contentType: string | null;
  responseTimeMs: number;
}

const SECURITY_HEADERS_TO_CHECK = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-xss-protection",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy",
];

export async function httpHeaders(url: string): Promise<HttpHeadersResult> {
  const requestStartTime = Date.now();
  // A caller's URL: every hop must land in public address space
  const response = await fetchPublicUrl(url, {
    method: "HEAD",
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  const responseTimeMs = Date.now() - requestStartTime;

  const headerEntries: Record<string, string> = {};
  response.headers.forEach((headerValue, headerName) => {
    headerEntries[headerName] = headerValue;
  });

  const securityHeaders: SecurityHeaderGrade[] = SECURITY_HEADERS_TO_CHECK.map(
    (headerName) => {
      const headerValue = headerEntries[headerName] || null;
      return {
        header: headerName,
        present: headerValue !== null,
        value: headerValue,
        grade: headerValue ? "good" : "missing",
      };
    },
  );

  const presentCount = securityHeaders.filter(
    (securityHeader) => securityHeader.present,
  ).length;
  const securityScore = Math.round(
    (presentCount / SECURITY_HEADERS_TO_CHECK.length) * 100,
  );

  return {
    url,
    statusCode: response.status,
    headers: headerEntries,
    securityHeaders,
    securityScore,
    server: headerEntries["server"] || null,
    contentType: headerEntries["content-type"] || null,
    responseTimeMs,
  };
}

// ─── Ping Host ─────────────────────────────────────────────────────

interface PingResult {
  host: string;
  alive: boolean;
  packetsSent: number;
  packetsReceived: number;
  packetLoss: number;
  roundTripMinMs: number | null;
  roundTripAvgMs: number | null;
  roundTripMaxMs: number | null;
  roundTripStddevMs: number | null;
  rawOutput: string;
}

export async function pingHost(
  host: string,
  count: number = 4,
): Promise<PingResult> {
  const pingCount = Math.min(Math.max(count, 1), 10);
  try {
    const { stdout } = await execFileAsync("ping", [
      "-c",
      String(pingCount),
      "-W",
      "3",
      host,
    ], { timeout: 30_000 });

    const packetLossMatch = stdout.match(/(\d+(?:\.\d+)?)% packet loss/);
    const roundTripMatch = stdout.match(
      /(?:rtt|round-trip)\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/,
    );

    const packetLossPercent = packetLossMatch
      ? parseFloat(packetLossMatch[1])
      : 100;

    return {
      host,
      alive: packetLossPercent < 100,
      packetsSent: pingCount,
      packetsReceived: Math.round(
        pingCount * ((100 - packetLossPercent) / 100),
      ),
      packetLoss: packetLossPercent,
      roundTripMinMs: roundTripMatch ? parseFloat(roundTripMatch[1]) : null,
      roundTripAvgMs: roundTripMatch ? parseFloat(roundTripMatch[2]) : null,
      roundTripMaxMs: roundTripMatch ? parseFloat(roundTripMatch[3]) : null,
      roundTripStddevMs: roundTripMatch ? parseFloat(roundTripMatch[4]) : null,
      rawOutput: stdout.slice(0, 2000),
    };
  } catch (error: unknown) {
    const errorOutput =
      error && typeof error === "object" && "stdout" in error
        ? String((error as { stdout: string }).stdout)
        : "";
    return {
      host,
      alive: false,
      packetsSent: pingCount,
      packetsReceived: 0,
      packetLoss: 100,
      roundTripMinMs: null,
      roundTripAvgMs: null,
      roundTripMaxMs: null,
      roundTripStddevMs: null,
      rawOutput: errorOutput.slice(0, 2000) || "Host unreachable or ping failed",
    };
  }
}

import { isIPv4, isIPv6 } from "node:net";

// Every range here must stay blocked even if a public hostname resolves to
// it later (DNS rebinding) — callers must re-check on every hop, never
// just once at the start. See website-fetcher.ts.

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

const IPV4_BLOCKED_RANGES: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
  ["255.255.255.255", 32],
];

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return IPV4_BLOCKED_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function expandIPv6(ip: string): string {
  // Normalize to 8 groups of 4 hex chars for straightforward prefix comparison.
  let addr = ip;
  if (addr.includes("::")) {
    const [head, tail] = addr.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    addr = [...headParts, ...Array(missing).fill("0"), ...tailParts].join(":");
  }
  return addr.split(":").map((group) => group.padStart(4, "0")).join(":");
}

function isBlockedIPv6(ip: string): boolean {
  const expanded = expandIPv6(ip);
  const groups = expanded.split(":");

  // IPv4-mapped / IPv4-compatible addresses carry the real risk in the
  // embedded IPv4 — check that instead of the wrapper.
  if (expanded.startsWith("0000:0000:0000:0000:0000:ffff:") || (groups.slice(0, 5).every((g) => g === "0000") && groups[5] === "0000")) {
    const highWord = parseInt(groups[6]!, 16);
    const lowWord = parseInt(groups[7]!, 16);
    const embeddedIPv4 = [(highWord >> 8) & 0xff, highWord & 0xff, (lowWord >> 8) & 0xff, lowWord & 0xff].join(".");
    if (isBlockedIPv4(embeddedIPv4)) return true;
  }

  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0001") return true; // ::1 loopback
  if (expanded === "0000:0000:0000:0000:0000:0000:0000:0000") return true; // :: unspecified
  const firstGroup = parseInt(groups[0]!, 16);
  if ((firstGroup & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstGroup & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (firstGroup === 0x2001 && parseInt(groups[1]!, 16) === 0x0db8) return true; // documentation
  if ((firstGroup & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (isIPv4(ip)) return isBlockedIPv4(ip);
  if (isIPv6(ip)) return isBlockedIPv6(ip);
  return true; // unrecognized format — fail closed
}

export function isLiteralIpHostname(hostname: string): boolean {
  return isIPv4(hostname) || isIPv6(hostname.replace(/^\[|\]$/g, ""));
}

import { describe, expect, it } from "vitest";
import { isBlockedIp, isLiteralIpHostname } from "./ip-guard";

describe("isBlockedIp", () => {
  it("blocks loopback", () => expect(isBlockedIp("127.0.0.1")).toBe(true));
  it("blocks private class A", () => expect(isBlockedIp("10.1.2.3")).toBe(true));
  it("blocks private class C", () => expect(isBlockedIp("192.168.1.1")).toBe(true));
  it("blocks link-local / cloud metadata", () => expect(isBlockedIp("169.254.169.254")).toBe(true));
  it("blocks carrier-grade NAT", () => expect(isBlockedIp("100.64.0.1")).toBe(true));
  it("allows public IPv4", () => expect(isBlockedIp("8.8.8.8")).toBe(false));
  it("blocks IPv6 loopback", () => expect(isBlockedIp("::1")).toBe(true));
  it("blocks IPv6 unique local", () => expect(isBlockedIp("fc00::1")).toBe(true));
  it("blocks IPv6 link-local", () => expect(isBlockedIp("fe80::1")).toBe(true));
  it("blocks IPv4-mapped IPv6 private address", () => expect(isBlockedIp("::ffff:127.0.0.1")).toBe(true));
  it("blocks IPv4-mapped IPv6 metadata address", () => expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true));
  it("allows public IPv6", () => expect(isBlockedIp("2001:4860:4860::8888")).toBe(false));
  it("fails closed on garbage input", () => expect(isBlockedIp("not-an-ip")).toBe(true));
});

describe("isLiteralIpHostname", () => {
  it("recognizes IPv4 literals", () => expect(isLiteralIpHostname("127.0.0.1")).toBe(true));
  it("recognizes bracketed IPv6 literals", () => expect(isLiteralIpHostname("[::1]")).toBe(true));
  it("rejects normal hostnames", () => expect(isLiteralIpHostname("example.com")).toBe(false));
});

import { describe, it, expect } from "vitest";
import {
  isLinkLocalOrMetadataAddress,
  isPrivateAddress,
  validatePublicWebUrl,
} from "../SsrfGuard.ts";

// SSRF guard (survey D2 slice): agent-controlled URLs must never
// reach loopback, LAN, or cloud-metadata address space.

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.5",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:10.0.0.1", // IPv4-mapped IPv6
    "::ffff:192.168.1.5",
    // The URL parser writes mapped addresses in hex: the same addresses
    "::ffff:7f00:1", // 127.0.0.1
    "::ffff:a9fe:a9fe", // 169.254.169.254
    "0:0:0:0:0:ffff:7f00:1",
    "::7f00:1", // IPv4-compatible 127.0.0.1
    "::127.0.0.1",
    "::ffff:0:7f00:1", // IPv4-translated, ::/8
    "64:ff9b::a00:1", // NAT64 to 10.0.0.1
    "64:ff9b::7f00:1",
    "64:ff9b:1::1", // local-use NAT64
    "2002:a00:1::1", // 6to4 of 10.0.0.1
    "2001::1", // Teredo
    "2001:db8::1", // documentation
    "100::1", // discard-only
    "fec0::1", // site-local
    "ff02::1", // multicast
    "fe80::1%eth0", // with a zone
    "192.0.0.170",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "example.com", // not an address: resolve it first
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "142.250.72.14",
    "2607:f8b0::1",
    "2606:4700:4700::1111",
    "::ffff:808:808", // mapped 8.8.8.8
    "64:ff9b::808:808", // NAT64 to 8.8.8.8
    "2002:808:808::1", // 6to4 of 8.8.8.8
  ])("allows public %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

// The agentic browser's block: link-local space and the metadata endpoints,
// in every spelling isPrivateAddress knows — and nothing else of the LAN.
describe("isLinkLocalOrMetadataAddress", () => {
  it.each([
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "169.254.255.255",
    "100.100.100.200", // Alibaba Cloud metadata
    "fd00:ec2::254", // AWS metadata over IPv6
    "fd00:0ec2:0:0:0:0:0:254",
    "fe80::1",
    "FE80::1",
    "fe80::1%eth0", // with a zone
    "febf:ffff::1", // the top of fe80::/10
    // IPv4-mapped, dotted and hex
    "::ffff:169.254.169.254",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:a9fe:a9fe",
    "::FFFF:A9FE:A9FE",
    "::ffff:100.100.100.200",
    // IPv4-compatible
    "::169.254.169.254",
    "::a9fe:a9fe",
    // NAT64 of 169.254/16
    "64:ff9b::169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::a9fe:1",
    // 6to4 of 169.254/16
    "2002:a9fe:a9fe::",
    "2002:a9fe:1::1",
    "example.com", // not an address: resolve it first
  ])("refuses %s", (address) => {
    expect(isLinkLocalOrMetadataAddress(address)).toBe(true);
  });

  it.each([
    // The LAN and loopback stay browsable
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.5",
    "172.16.0.1",
    "100.64.0.1", // CGNAT
    "100.100.100.100",
    "::1",
    "fd12:3456::1", // unique-local
    "fd00:ec2::253",
    "fec0::1", // site-local
    "fe7f::1",
    "fec0::a9fe:a9fe",
    "::ffff:192.168.1.5",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "2002:a00:1::1",
    // The edges of 169.254/16
    "169.253.255.255",
    "169.255.0.0",
    "::ffff:a9fd:ffff",
    "::ffff:a9ff:0",
    // Public
    "8.8.8.8",
    "2606:4700:4700::1111",
  ])("lets %s through", (address) => {
    expect(isLinkLocalOrMetadataAddress(address)).toBe(false);
  });
});

describe("validatePublicWebUrl", () => {
  it("blocks non-http protocols", async () => {
    expect((await validatePublicWebUrl("file:///etc/passwd")).ok).toBe(false);
    expect((await validatePublicWebUrl("gopher://example.com")).ok).toBe(false);
  });

  it("blocks literal private IPs without DNS", async () => {
    expect((await validatePublicWebUrl("http://192.168.1.10/admin")).ok).toBe(
      false,
    );
    expect(
      (await validatePublicWebUrl("http://169.254.169.254/latest/meta-data/"))
        .ok,
    ).toBe(false);
    expect((await validatePublicWebUrl("http://[::1]:8080/")).ok).toBe(false);
  });

  it("blocks every spelling of loopback and metadata in a URL", async () => {
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[0:0:0:0:0:ffff:7f00:1]/",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "http://[::127.0.0.1]/",
      "http://[64:ff9b::10.0.0.1]/",
      "http://0x7f.1/",
      "http://2130706433/",
      "http://017700000001/",
      "http://127.1/",
      "http://0/",
    ]) {
      expect((await validatePublicWebUrl(url)).ok, url).toBe(false);
    }
  });

  it("blocks hostnames that resolve to loopback", async () => {
    // localhost resolves to 127.0.0.1/::1 on every platform
    const verdict = await validatePublicWebUrl("http://localhost:5590/admin");
    expect(verdict.ok).toBe(false);
  });

  it("rejects malformed URLs", async () => {
    expect((await validatePublicWebUrl("not a url")).ok).toBe(false);
  });
});

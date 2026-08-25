import { describe, expect, it, vi } from "vitest";
import { createPinnedLookup } from "./website-fetcher";

// Regression test for a bug that broke 100% of real analyses: Node's
// happy-eyeballs connector calls the custom `lookup` option with
// `{all: true}` and expects an addresses array, not the classic
// (address, family) triple. Getting this wrong makes every request fail
// with ERR_INVALID_IP_ADDRESS regardless of the target site — it looked
// like every website was blocking us, when nothing ever left the process.
describe("createPinnedLookup", () => {
  const pinned = { address: "203.0.113.10", family: 4 };

  it("responds with an addresses array when called with {all: true} (Node's happy-eyeballs shape)", () => {
    const lookup = createPinnedLookup(pinned);
    const callback = vi.fn();
    lookup("example.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "203.0.113.10", family: 4 }]);
  });

  it("responds with (address, family) when called without {all: true} (legacy shape)", () => {
    const lookup = createPinnedLookup(pinned);
    const callback = vi.fn();
    lookup("example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "203.0.113.10", 4);
  });

  it("responds with (address, family) when options is undefined", () => {
    const lookup = createPinnedLookup(pinned);
    const callback = vi.fn();
    lookup("example.com", undefined, callback);
    expect(callback).toHaveBeenCalledWith(null, "203.0.113.10", 4);
  });
});

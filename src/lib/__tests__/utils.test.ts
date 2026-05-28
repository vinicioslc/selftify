import { describe, it, expect } from "vitest";
import { formatDuration, formatCount, clamp, cn } from "../utils";

describe("formatDuration", () => {
  it("returns 0:00 for null", () => {
    expect(formatDuration(null)).toBe("0:00");
  });

  it("returns 0:00 for 0", () => {
    expect(formatDuration(0)).toBe("0:00");
  });

  it("returns 0:00 for negative", () => {
    expect(formatDuration(-1)).toBe("0:00");
  });

  it("formats seconds only", () => {
    expect(formatDuration(45000)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2:05");
  });

  it("formats hours, minutes, seconds", () => {
    expect(formatDuration(3661000)).toBe("1:01:01");
  });

  it("handles exactly 1 hour", () => {
    expect(formatDuration(3600000)).toBe("1:00:00");
  });

  it("handles large durations", () => {
    expect(formatDuration(9999000)).toBe("2:46:39");
  });

  it("pads seconds with leading zero", () => {
    expect(formatDuration(1000)).toBe("0:01");
    expect(formatDuration(10000)).toBe("0:10");
  });

  it("pads minutes with leading zero when hours present", () => {
    expect(formatDuration(3610000)).toBe("1:00:10");
  });
});

describe("formatCount", () => {
  it("returns 0 for null", () => {
    expect(formatCount(null)).toBe("0");
  });

  it("returns 0 for undefined", () => {
    expect(formatCount(undefined as unknown as null)).toBe("0");
  });

  it("formats small numbers", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(5)).toBe("5");
    expect(formatCount(999)).toBe("999");
  });

  it("formats thousands with K", () => {
    expect(formatCount(1000)).toBe("1.0K");
    expect(formatCount(1500)).toBe("1.5K");
    expect(formatCount(999999)).toBe("1000.0K");
  });

  it("formats millions with M", () => {
    expect(formatCount(1000000)).toBe("1.0M");
    expect(formatCount(2500000)).toBe("2.5M");
  });
});

describe("clamp", () => {
  it("returns value when within bounds", () => {
    expect(clamp(50, 0, 100)).toBe(50);
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });

  it("clamps to min when below", () => {
    expect(clamp(-1, 0, 100)).toBe(0);
    expect(clamp(-100, 0, 100)).toBe(0);
  });

  it("clamps to max when above", () => {
    expect(clamp(101, 0, 100)).toBe(100);
    expect(clamp(999, 0, 100)).toBe(100);
  });

  it("handles negative ranges", () => {
    expect(clamp(-5, -10, -1)).toBe(-5);
    expect(clamp(-20, -10, -1)).toBe(-10);
    expect(clamp(0, -10, -1)).toBe(-1);
  });
});

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });

  it("handles undefined values", () => {
    expect(cn("a", undefined, "b")).toBe("a b");
  });

  it("handles empty inputs", () => {
    expect(cn()).toBe("");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
const { mockDecodeAndFreeString } = vi.hoisted(() => ({
  mockDecodeAndFreeString: vi.fn((pointer: unknown) => {
    if (!pointer) return null;
    return '{"type":"transcript","entries":[]}';
  }),
}));

vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
  decodeAndFreeString: mockDecodeAndFreeString,
}));

import { Transcript } from "../../src/transcript.js";
import type { NativePointer } from "../../src/bindings.js";

const mockPointer = (label: string) => label as unknown as NativePointer;

beforeEach(() => {
  vi.clearAllMocks();
  mockDecodeAndFreeString.mockImplementation((pointer: unknown) => {
    if (!pointer) return null;
    return '{"type":"transcript","entries":[]}';
  });
});

describe("Transcript", () => {
  describe("toJson", () => {
    it("returns JSON string from C API", () => {
      const transcript = new Transcript(mockPointer("mock-session"));
      const json = transcript.toJson();
      expect(json).toBe('{"type":"transcript","entries":[]}');
      expect(mockFns.FMLanguageModelSessionGetTranscriptJSONString).toHaveBeenCalledWith(
        "mock-session",
        null,
        null,
      );
    });

    it("throws when C API returns null", () => {
      mockDecodeAndFreeString.mockReturnValueOnce(null);
      const transcript = new Transcript(mockPointer("mock-session"));
      expect(() => transcript.toJson()).toThrow("Failed to export transcript");
    });
  });

  describe("toDict", () => {
    it("returns parsed JSON object", () => {
      const transcript = new Transcript(mockPointer("mock-session"));
      const dict = transcript.toDict();
      expect(dict).toEqual({ type: "transcript", entries: [] });
    });
  });

  describe("fromJson", () => {
    it("creates transcript from JSON string", () => {
      const transcript = Transcript.fromJson('{"type":"transcript"}');
      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalledWith(
        '{"type":"transcript"}',
        expect.any(Array),
        null,
      );
      expect(transcript._nativeSession).toBe("mock-transcript-pointer");
    });

    it("throws when C returns null pointer", () => {
      mockFns.FMTranscriptCreateFromJSONString.mockReturnValueOnce(null);
      expect(() => Transcript.fromJson("bad json")).toThrow();
    });
  });

  describe("fromDict", () => {
    it("serializes dict to JSON and calls fromJson", () => {
      const dict = { type: "transcript", entries: [] };
      const transcript = Transcript.fromDict(dict);
      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalledWith(
        JSON.stringify(dict),
        expect.any(Array),
        null,
      );
      expect(transcript._nativeSession).toBe("mock-transcript-pointer");
    });
  });

  describe("_updateNativeSession", () => {
    it("updates the internal session pointer", () => {
      const transcript = new Transcript(mockPointer("old-session"));
      transcript._updateNativeSession(mockPointer("new-session"));
      expect(transcript._nativeSession).toBe("new-session");
    });
  });
});

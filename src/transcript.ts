import { getFunctions } from "./bindings.js";
import { statusToError } from "./errors.js";

export class Transcript {
  /** @internal raw session pointer (same as the session's ptr) */
  _sessionPtr: unknown;

  /** @internal */
  constructor(sessionPtr: unknown) {
    this._sessionPtr = sessionPtr;
  }

  /** @internal Update the session pointer after fromTranscript(). */
  _updateSessionPtr(ptr: unknown): void {
    this._sessionPtr = ptr;
  }

  /** Export the transcript as a JSON string for persistence. */
  toJson(): string {
    const json = getFunctions().FMLanguageModelSessionGetTranscriptJSONString(
      this._sessionPtr,
      null,
      null,
    ) as string | null;
    if (!json) throw new Error("Failed to export transcript");
    return json;
  }

  /** Export the transcript as a parsed dictionary (mirrors Python's Transcript.to_dict()). */
  toDict(): Record<string, unknown> {
    return JSON.parse(this.toJson()) as Record<string, unknown>;
  }

  /** Deserialize a previously exported transcript JSON string. */
  static fromJson(json: string): Transcript {
    const fn = getFunctions();
    const errorCode = [0];
    const ptr = fn.FMTranscriptCreateFromJSONString(json, errorCode, null);
    if (!ptr) {
      throw statusToError(errorCode[0], "Failed to deserialize transcript");
    }
    return new Transcript(ptr);
  }

  /** Deserialize a transcript from a dictionary (mirrors Python's Transcript.from_dict()). */
  static fromDict(dict: Record<string, unknown>): Transcript {
    return Transcript.fromJson(JSON.stringify(dict));
  }
}

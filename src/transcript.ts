import { getFunctions, decodeAndFreeString, type NativePointer } from "./bindings.js";
import { statusToError, FoundationModelsError } from "./errors.js";

export class Transcript {
  /** @internal raw session pointer — backs the live session's native handle */
  _nativeSession: NativePointer;

  /** @internal */
  constructor(sessionPointer: NativePointer) {
    this._nativeSession = sessionPointer;
  }

  /** @internal Update the native session after fromTranscript(). */
  _updateNativeSession(pointer: NativePointer): void {
    this._nativeSession = pointer;
  }

  /**
   * Export the current session history as a JSON string for persistence.
   *
   * **Lifetime note:** instances created by `new LanguageModelSession()` or
   * `LanguageModelSession.fromTranscript()` are backed by the live session's
   * C state. Calling `toJson()` after `session.dispose()` will dereference a
   * freed pointer. Export the transcript before disposing the session.
   *
   * Instances created via the static `Transcript.fromJson()` /
   * `Transcript.fromDict()` constructors are independent C objects and are
   * safe to use after the originating session is disposed.
   */
  toJson(): string {
    const pointer = getFunctions().FMLanguageModelSessionGetTranscriptJSONString(
      this._nativeSession,
      null,
      null,
    );
    const json = decodeAndFreeString(pointer);
    if (!json) throw new FoundationModelsError("Failed to export transcript");
    return json;
  }

  /** Export the transcript as a parsed dictionary (mirrors Python's Transcript.to_dict()). */
  toDict(): Record<string, unknown> {
    return JSON.parse(this.toJson());
  }

  /** Deserialize a previously exported transcript JSON string. */
  static fromJson(json: string): Transcript {
    const fn = getFunctions();
    const errorCode = [0];
    const pointer = fn.FMTranscriptCreateFromJSONString(json, errorCode, null);
    if (!pointer) {
      throw statusToError(errorCode[0], "Failed to deserialize transcript");
    }
    return new Transcript(pointer);
  }

  /** Deserialize a transcript from a dictionary (mirrors Python's Transcript.from_dict()). */
  static fromDict(dict: Record<string, unknown>): Transcript {
    return Transcript.fromJson(JSON.stringify(dict));
  }
}

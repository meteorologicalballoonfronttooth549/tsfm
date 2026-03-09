/**
 * Tool — base class for tools the model can invoke during generation.
 *
 * Subclass this, implement name/description/argumentsSchema/call,
 * then pass instances to LanguageModelSession's tools option.
 */

import koffi from "koffi";
import { getFunctions, ToolCallbackProto } from "./bindings.js";
import { GenerationSchema, GeneratedContent } from "./schema.js";
import { statusToError } from "./errors.js";

const _toolRegistry = new FinalizationRegistry(
  ({ ptr, callbackPtr }: { ptr: unknown; callbackPtr: unknown }) => {
    try {
      koffi.unregister(callbackPtr as Parameters<typeof koffi.unregister>[0]);
    } catch {}
    try { getFunctions().FMRelease(ptr); } catch {}
  },
);

export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly argumentsSchema: GenerationSchema;

  abstract call(args: GeneratedContent): Promise<string>;

  /** @internal Set during registration with a session. */
  _ptr: unknown = null;
  private _callbackPtr: unknown = null;

  /** @internal Called once before passing to FMBridgedToolCreate */
  _register(): void {
    if (this._ptr) return; // already registered

    const fn = getFunctions();

    // Register the koffi callback — this lives for the lifetime of the Tool
    this._callbackPtr = koffi.register(
      (contentRef: unknown, callId: number) => {
        const content = new GeneratedContent(contentRef);
        this.call(content)
          .then((result) => {
            fn.FMBridgedToolFinishCall(this._ptr, callId, result);
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            fn.FMBridgedToolFinishCall(this._ptr, callId, `Tool error: ${msg}`);
          });
      },
      koffi.pointer(ToolCallbackProto),
    );

    const errorCode = [0];
    const ptr = fn.FMBridgedToolCreate(
      this.name,
      this.description,
      this.argumentsSchema._ptr,
      this._callbackPtr,
      errorCode,
      null,
    );

    if (!ptr) {
      const err = statusToError(
        errorCode[0],
        `Failed to create tool '${this.name}'`,
      );
      throw err;
    }

    this._ptr = ptr;
    _toolRegistry.register(this, { ptr: this._ptr, callbackPtr: this._callbackPtr }, this);
  }

  dispose(): void {
    if (this._ptr || this._callbackPtr) {
      _toolRegistry.unregister(this);
    }
    if (this._callbackPtr) {
      koffi.unregister(
        this._callbackPtr as Parameters<typeof koffi.unregister>[0],
      );
      this._callbackPtr = null;
    }
    if (this._ptr) {
      getFunctions().FMRelease(this._ptr);
      this._ptr = null;
    }
  }
}

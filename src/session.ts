import koffi from "koffi";
import {
  getFunctions,
  decodeAndFreeString,
  ResponseCallbackProto,
  StructuredResponseCallbackProto,
} from "./bindings.js";
import { SystemLanguageModel } from "./core.js";
import { Tool } from "./tool.js";
import { GenerationSchema, GeneratedContent } from "./schema.js";
import { GenerationOptions, serializeOptions } from "./options.js";
import { statusToError } from "./errors.js";
import { Transcript } from "./transcript.js";

const _sessionRegistry = new FinalizationRegistry((ptr: unknown) => {
  try {
    getFunctions().FMRelease(ptr);
  } catch {}
});

type ResponseCbArgs = [status: number, content: string, length: number, userInfo: unknown];
type StructuredCbArgs = [status: number, contentRef: unknown, userInfo: unknown];

export class LanguageModelSession {
  /** @internal */
  _ptr: unknown;

  transcript: Transcript;

  private _activeTask: unknown = null;
  private _queue = Promise.resolve();

  constructor(
    opts: {
      instructions?: string;
      model?: SystemLanguageModel;
      tools?: Tool[];
    } = {},
  ) {
    const fn = getFunctions();
    const tools = opts.tools ?? [];
    tools.forEach((t) => t._register());

    const toolPtrs = tools.map((t) => t._ptr);
    const toolArrPtr = tools.length > 0 ? koffi.as(toolPtrs, "void **") : null;

    this._ptr = fn.FMLanguageModelSessionCreateFromSystemLanguageModel(
      opts.model?._ptr ?? null,
      opts.instructions ?? null,
      toolArrPtr,
      tools.length,
    );

    if (!this._ptr) throw new Error("Failed to create LanguageModelSession");
    this.transcript = new Transcript(this._ptr);
    _sessionRegistry.register(this, this._ptr, this);
  }

  /** Create a session pre-loaded with a saved transcript. */
  static fromTranscript(
    transcript: Transcript,
    opts: { model?: SystemLanguageModel; tools?: Tool[] } = {},
  ): LanguageModelSession {
    const fn = getFunctions();
    const tools = opts.tools ?? [];
    tools.forEach((t) => t._register());
    const rawPtrs = tools.map((t) => t._ptr);
    const toolPtrs = tools.length > 0 ? koffi.as(rawPtrs, "void **") : null;

    const ptr = fn.FMLanguageModelSessionCreateFromTranscript(
      transcript._sessionPtr,
      opts.model?._ptr ?? null,
      toolPtrs,
      tools.length,
    );

    if (!ptr) throw new Error("Failed to create session from transcript");

    const session = Object.create(LanguageModelSession.prototype) as LanguageModelSession;
    session._ptr = ptr;
    session._activeTask = null;
    session._queue = Promise.resolve();
    session.transcript = transcript;
    transcript._updateSessionPtr(ptr);
    _sessionRegistry.register(session, ptr, session);
    return session;
  }

  /** Whether the session is currently processing a request (backed by C API). */
  get isResponding(): boolean {
    if (!this._ptr) return false;
    return getFunctions().FMLanguageModelSessionIsResponding(this._ptr) as boolean;
  }

  /** Cancel any in-progress request and reset the session to an idle state. */
  cancel(): void {
    if (this._activeTask) {
      getFunctions().FMTaskCancel(this._activeTask);
      this._activeTask = null;
    }
    if (this._ptr) getFunctions().FMLanguageModelSessionReset(this._ptr);
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  async respond(prompt: string, opts: { options?: GenerationOptions } = {}): Promise<string> {
    return this._enqueue(() => this._respondBasic(prompt, opts.options));
  }

  async respondWithSchema(
    prompt: string,
    schema: GenerationSchema,
    opts: { options?: GenerationOptions } = {},
  ): Promise<GeneratedContent> {
    return this._enqueue(() => this._respondWithSchema(prompt, schema, opts.options));
  }

  async respondWithJsonSchema(
    prompt: string,
    jsonSchema: Record<string, unknown>,
    opts: { options?: GenerationOptions } = {},
  ): Promise<GeneratedContent> {
    return this._enqueue(() => this._respondWithJsonSchema(prompt, jsonSchema, opts.options));
  }

  async *streamResponse(
    prompt: string,
    opts: { options?: GenerationOptions } = {},
  ): AsyncGenerator<string> {
    let release!: () => void;
    const lock = new Promise<void>((res) => (release = res));
    this._queue = this._queue.then(() => lock);

    const fn = getFunctions();
    const optionsJson = serializeOptions(opts.options);

    const streamRef = fn.FMLanguageModelSessionStreamResponse(this._ptr, prompt, optionsJson);

    // FMLanguageModelSessionResponseStreamIterate spawns a single Swift Task
    // that calls the callback once per chunk, then once more with null content
    // when done. We buffer arriving chunks into a queue and drain them.
    type QueueItem = { content: string } | { done: true; error?: Error };
    const queue: QueueItem[] = [];
    let notifyConsumer: (() => void) | null = null;
    let streamDone = false;
    const keepAlive = setInterval(() => {}, 10000);

    const cbPtr = koffi.register((...args: ResponseCbArgs) => {
      const [status, content] = args;
      if (status !== 0) {
        queue.push({ done: true, error: statusToError(status, content) });
        streamDone = true;
        clearInterval(keepAlive);
        koffi.unregister(cbPtr as Parameters<typeof koffi.unregister>[0]);
      } else if (!content) {
        // null content = end-of-stream signal
        queue.push({ done: true });
        streamDone = true;
        clearInterval(keepAlive);
        koffi.unregister(cbPtr as Parameters<typeof koffi.unregister>[0]);
      } else {
        queue.push({ content });
      }
      const notify = notifyConsumer;
      notifyConsumer = null;
      notify?.();
    }, koffi.pointer(ResponseCallbackProto));

    fn.FMLanguageModelSessionResponseStreamIterate(streamRef, null, cbPtr);

    // Apple's ResponseStream yields cumulative snapshots, not deltas.
    // Track previous content and yield only the new suffix each iteration.
    let prevLen = 0;

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notifyConsumer = resolve;
          });
        }
        const item = queue.shift()!;
        if ("done" in item) {
          if (item.error) throw item.error;
          break;
        }
        const delta = item.content.slice(prevLen);
        prevLen = item.content.length;
        if (delta) yield delta;
      }
    } finally {
      clearInterval(keepAlive);
      if (!streamDone) {
        koffi.unregister(cbPtr as Parameters<typeof koffi.unregister>[0]);
      }
      fn.FMRelease(streamRef);
      release();
    }
  }

  dispose(): void {
    if (this._ptr) {
      _sessionRegistry.unregister(this);
      getFunctions().FMRelease(this._ptr);
      this._ptr = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private implementation
  // -------------------------------------------------------------------------

  // Enforces sequential execution: concurrent respond() calls are queued and
  // run one at a time rather than racing over the same session pointer.
  private _enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._queue.then(() => fn());
    this._queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  // Shared boilerplate for one-shot text response callbacks.
  private _runResponseCallback(callC: (cbPtr: unknown) => unknown): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const keepAlive = setInterval(() => {}, 10000);
      const cbPtr = koffi.register((...args: ResponseCbArgs) => {
        clearInterval(keepAlive);
        koffi.unregister(cbPtr as Parameters<typeof koffi.unregister>[0]);
        this._activeTask = null;
        const [status, content] = args;
        if (status !== 0) reject(statusToError(status, content));
        else resolve(content ?? "");
      }, koffi.pointer(ResponseCallbackProto));
      this._activeTask = callC(cbPtr);
    });
  }

  // Shared boilerplate for one-shot structured response callbacks.
  private _runStructuredCallback(callC: (cbPtr: unknown) => unknown): Promise<GeneratedContent> {
    return new Promise<GeneratedContent>((resolve, reject) => {
      const keepAlive = setInterval(() => {}, 10000);
      const cbPtr = koffi.register((...args: StructuredCbArgs) => {
        clearInterval(keepAlive);
        koffi.unregister(cbPtr as Parameters<typeof koffi.unregister>[0]);
        this._activeTask = null;
        const [status, contentRef] = args;
        if (status !== 0) {
          const msg = decodeAndFreeString(
            getFunctions().FMGeneratedContentGetJSONString(contentRef),
          );
          getFunctions().FMRelease(contentRef);
          reject(statusToError(status, msg ?? undefined));
        } else {
          resolve(new GeneratedContent(contentRef));
        }
      }, koffi.pointer(StructuredResponseCallbackProto));
      this._activeTask = callC(cbPtr);
    });
  }

  private _respondBasic(prompt: string, options: GenerationOptions | undefined): Promise<string> {
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    return this._runResponseCallback((cbPtr) =>
      fn.FMLanguageModelSessionRespond(this._ptr, prompt, optionsJson, null, cbPtr),
    );
  }

  private _respondWithSchema(
    prompt: string,
    schema: GenerationSchema,
    options: GenerationOptions | undefined,
  ): Promise<GeneratedContent> {
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    return this._runStructuredCallback((cbPtr) =>
      fn.FMLanguageModelSessionRespondWithSchema(
        this._ptr,
        prompt,
        schema._ptr,
        optionsJson,
        null,
        cbPtr,
      ),
    );
  }

  private _toAppleSchemaFormat(schema: Record<string, unknown>): Record<string, unknown> {
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    const order = schema["x-order"] ?? Object.keys(props);
    return {
      title: "Schema",
      additionalProperties: false,
      ...schema,
      "x-order": order,
    };
  }

  private _respondWithJsonSchema(
    prompt: string,
    jsonSchema: Record<string, unknown>,
    options: GenerationOptions | undefined,
  ): Promise<GeneratedContent> {
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    const schemaJson = JSON.stringify(this._toAppleSchemaFormat(jsonSchema));
    return this._runStructuredCallback((cbPtr) =>
      fn.FMLanguageModelSessionRespondWithSchemaFromJSON(
        this._ptr,
        prompt,
        schemaJson,
        optionsJson,
        null,
        cbPtr,
      ),
    );
  }
}

export type SamplingModeType = "greedy" | "random";

export interface SamplingMode {
  readonly type: SamplingModeType;
  readonly top?: number;
  readonly probabilityThreshold?: number;
  readonly seed?: number;
}

export const SamplingMode = {
  greedy(): SamplingMode {
    return { type: "greedy" };
  },
  random(
    opts: {
      top?: number;
      probabilityThreshold?: number;
      seed?: number;
    } = {},
  ): SamplingMode {
    if (opts.top !== undefined && opts.probabilityThreshold !== undefined) {
      throw new Error(
        "Cannot specify both 'top' and 'probabilityThreshold'. Choose one sampling constraint.",
      );
    }
    if (opts.top !== undefined && opts.top <= 0) {
      throw new Error("'top' must be a positive integer");
    }
    if (
      opts.probabilityThreshold !== undefined &&
      (opts.probabilityThreshold < 0.0 || opts.probabilityThreshold > 1.0)
    ) {
      throw new Error("'probabilityThreshold' must be between 0.0 and 1.0");
    }
    return { type: "random", ...opts };
  },
};

export interface GenerationOptions {
  sampling?: SamplingMode;
  temperature?: number;
  maximumResponseTokens?: number;
}

export function serializeOptions(
  options: GenerationOptions | undefined,
): string | null {
  if (!options) return null;

  const obj: Record<string, unknown> = {};

  if (options.temperature !== undefined) obj.temperature = options.temperature;
  if (options.maximumResponseTokens !== undefined) {
    // Key name aligned with Python SDK: maximum_response_tokens
    obj.maximum_response_tokens = options.maximumResponseTokens;
  }
  if (options.sampling) {
    const s = options.sampling;
    if (s.type === "greedy") {
      obj.sampling = { mode: "greedy" };
    } else {
      const r: Record<string, unknown> = { mode: "random" };
      // Key names aligned with Python SDK: top_k, top_p
      if (s.top !== undefined) r.top_k = s.top;
      if (s.probabilityThreshold !== undefined)
        r.top_p = s.probabilityThreshold;
      if (s.seed !== undefined) r.seed = s.seed;
      obj.sampling = r;
    }
  }

  return JSON.stringify(obj);
}

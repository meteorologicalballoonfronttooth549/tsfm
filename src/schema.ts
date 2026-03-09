/**
 * GenerationSchema — describes the structure of a guided-generation response.
 *
 * Use these classes to tell the model what shape of data to produce.
 * This mirrors the Python SDK's GenerationSchema / GenerationSchemaProperty / GenerationGuide.
 */

import { getFunctions, decodeAndFreeString } from "./bindings.js";
import { statusToError } from "./errors.js";

export type PropertyType = "string" | "integer" | "number" | "boolean" | "array" | "object";

// ---------------------------------------------------------------------------
// GuideType — mirrors Python's GuideType enum
// ---------------------------------------------------------------------------

export enum GuideType {
  ANY_OF = "enum",
  CONSTANT = "constant",
  COUNT = "count",
  ELEMENT = "element",
  MAX_ITEMS = "maxItems",
  MAXIMUM = "maximum",
  MIN_ITEMS = "minItems",
  MINIMUM = "minimum",
  RANGE = "range",
  REGEX = "regex",
}

// ---------------------------------------------------------------------------
// GenerationGuide — mirrors Python's GenerationGuide class
// ---------------------------------------------------------------------------

export class GenerationGuide {
  private readonly guideType: GuideType;
  private readonly value: unknown;

  private constructor(guideType: GuideType, value: unknown) {
    this.guideType = guideType;
    this.value = value;
  }

  /** Constrain output to one of the given string values. */
  static anyOf(values: string[]): GenerationGuide {
    return new GenerationGuide(GuideType.ANY_OF, values);
  }

  /** Constrain output to exactly this string value. */
  static constant(value: string): GenerationGuide {
    return new GenerationGuide(GuideType.CONSTANT, value);
  }

  /** Require exactly `count` items in an array. */
  static count(count: number): GenerationGuide {
    return new GenerationGuide(GuideType.COUNT, count);
  }

  /** Apply a guide to each element of an array. */
  static element(guide: GenerationGuide): GenerationGuide {
    return new GenerationGuide(GuideType.ELEMENT, guide);
  }

  /** Maximum number of items in an array. */
  static maxItems(value: number): GenerationGuide {
    return new GenerationGuide(GuideType.MAX_ITEMS, value);
  }

  /** Maximum numeric value. */
  static maximum(value: number): GenerationGuide {
    return new GenerationGuide(GuideType.MAXIMUM, value);
  }

  /** Minimum number of items in an array. */
  static minItems(value: number): GenerationGuide {
    return new GenerationGuide(GuideType.MIN_ITEMS, value);
  }

  /** Minimum numeric value. */
  static minimum(value: number): GenerationGuide {
    return new GenerationGuide(GuideType.MINIMUM, value);
  }

  /** Constrain numeric value to [min, max]. */
  static range(min: number, max: number): GenerationGuide {
    return new GenerationGuide(GuideType.RANGE, [min, max]);
  }

  /** Constrain string to match a regex pattern. */
  static regex(pattern: string): GenerationGuide {
    return new GenerationGuide(GuideType.REGEX, pattern);
  }

  /** @internal Apply this guide to a C property pointer. */
  _applyToProperty(propPtr: unknown, wrapped = false): void {
    const fn = getFunctions();
    const guideType = this.guideType;
    const value = this.value;

    // Unwrap element guide
    if (guideType === GuideType.ELEMENT) {
      const inner = value as GenerationGuide;
      inner._applyToProperty(propPtr, true);
      return;
    }

    switch (guideType) {
      case GuideType.ANY_OF:
      case GuideType.CONSTANT: {
        const choices = guideType === GuideType.CONSTANT ? [value as string] : (value as string[]);
        fn.FMGenerationSchemaPropertyAddAnyOfGuide(propPtr, choices, choices.length, wrapped);
        break;
      }
      case GuideType.COUNT:
        fn.FMGenerationSchemaPropertyAddCountGuide(propPtr, value as number, wrapped);
        break;
      case GuideType.MAX_ITEMS:
        fn.FMGenerationSchemaPropertyAddMaxItemsGuide(propPtr, value as number);
        break;
      case GuideType.MAXIMUM:
        fn.FMGenerationSchemaPropertyAddMaximumGuide(propPtr, value as number, wrapped);
        break;
      case GuideType.MIN_ITEMS:
        fn.FMGenerationSchemaPropertyAddMinItemsGuide(propPtr, value as number);
        break;
      case GuideType.MINIMUM:
        fn.FMGenerationSchemaPropertyAddMinimumGuide(propPtr, value as number, wrapped);
        break;
      case GuideType.RANGE: {
        const [min, max] = value as [number, number];
        fn.FMGenerationSchemaPropertyAddRangeGuide(propPtr, min, max, wrapped);
        break;
      }
      case GuideType.REGEX:
        fn.FMGenerationSchemaPropertyAddRegex(propPtr, value as string, wrapped);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// GenerationSchemaProperty
// ---------------------------------------------------------------------------

export class GenerationSchemaProperty {
  /** @internal */
  _ptr: unknown;

  constructor(
    name: string,
    type: PropertyType,
    opts: {
      description?: string;
      optional?: boolean;
      guides?: GenerationGuide[];
    } = {},
  ) {
    const fn = getFunctions();
    this._ptr = fn.FMGenerationSchemaPropertyCreate(
      name,
      opts.description ?? null,
      type,
      opts.optional ?? false,
    );

    for (const guide of opts.guides ?? []) {
      guide._applyToProperty(this._ptr);
    }
  }
}

// ---------------------------------------------------------------------------
// GenerationSchema
// ---------------------------------------------------------------------------

export class GenerationSchema {
  /** @internal */
  _ptr: unknown;

  constructor(name: string, description?: string) {
    const fn = getFunctions();
    this._ptr = fn.FMGenerationSchemaCreate(name, description ?? null);
  }

  addProperty(property: GenerationSchemaProperty): this {
    getFunctions().FMGenerationSchemaAddProperty(this._ptr, property._ptr);
    return this;
  }

  addReferenceSchema(schema: GenerationSchema): this {
    getFunctions().FMGenerationSchemaAddReferenceSchema(this._ptr, schema._ptr);
    return this;
  }

  /** Convenience: add a typed property inline. */
  property(
    name: string,
    type: PropertyType,
    opts?: {
      description?: string;
      optional?: boolean;
      guides?: GenerationGuide[];
    },
  ): this {
    const prop = new GenerationSchemaProperty(name, type, opts);
    return this.addProperty(prop);
  }

  /** Serialize the schema to a plain object (mirrors Python's GenerationSchema.to_dict()). */
  toDict(): Record<string, unknown> {
    const errorCode = [0];
    const ptr = getFunctions().FMGenerationSchemaGetJSONString(this._ptr, errorCode, null);
    const json = decodeAndFreeString(ptr);
    if (!json) throw statusToError(errorCode[0], "Failed to serialize GenerationSchema");
    return JSON.parse(json) as Record<string, unknown>;
  }
}

// ---------------------------------------------------------------------------
// GeneratedContent
// ---------------------------------------------------------------------------

/**
 * The structured content returned from guided-generation requests.
 */
export class GeneratedContent {
  /** @internal */
  _ptr: unknown;

  private _parsed: Record<string, unknown> | null = null;

  /** @internal */
  constructor(ptr: unknown) {
    this._ptr = ptr;
  }

  /** Create GeneratedContent from a JSON string (mirrors Python's GeneratedContent.from_json()). */
  static fromJson(jsonString: string): GeneratedContent {
    const fn = getFunctions();
    const errorCode = [0];
    const ptr = fn.FMGeneratedContentCreateFromJSON(jsonString, errorCode, null);
    if (!ptr) throw statusToError(errorCode[0], "Failed to create GeneratedContent from JSON");
    return new GeneratedContent(ptr);
  }

  get isComplete(): boolean {
    return getFunctions().FMGeneratedContentIsComplete(this._ptr) as boolean;
  }

  /** Returns the raw JSON string of the generated content. */
  toJson(): string {
    const ptr = getFunctions().FMGeneratedContentGetJSONString(this._ptr);
    return decodeAndFreeString(ptr) ?? "{}";
  }

  /** Returns the parsed JSON object. */
  toObject(): Record<string, unknown> {
    if (!this._parsed) {
      this._parsed = JSON.parse(this.toJson());
    }
    return this._parsed!;
  }

  /** Returns the value of a specific property. */
  value<T = unknown>(propertyName: string): T {
    const ptr = getFunctions().FMGeneratedContentGetPropertyValue(
      this._ptr,
      propertyName,
      null,
      null,
    );
    const raw = decodeAndFreeString(ptr);
    if (raw !== null) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    }
    // Fall back to JSON representation when the C API returns null
    const obj = this.toObject();
    if (propertyName in obj) {
      return obj[propertyName] as T;
    }
    throw new Error(`Property '${propertyName}' not found in generated content`);
  }
}

/**
 * Quick usage examples for afm-ts-sdk.
 * Run after building: npx tsx example.ts
 */

import {
  SystemLanguageModel,
  SystemLanguageModelUseCase,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  GeneratedContent,
  SamplingMode,
  Tool,
  Transcript,
} from "./src/index.js";

// ─── Basic text generation ───────────────────────────────────────────────────

async function basicExample() {
  const model = new SystemLanguageModel();
  const { available, reason } = await model.waitUntilAvailable();
  if (!available) {
    console.error("Model not available:", reason);
    model.dispose();
    return;
  }

  const session = new LanguageModelSession({
    instructions: "You are a concise assistant.",
  });

  const reply = await session.respond("What is the capital of France?");
  console.log("Response:", reply);
  session.dispose();
  model.dispose();
}

// ─── Streaming ───────────────────────────────────────────────────────────────

async function streamingExample() {
  const session = new LanguageModelSession();

  process.stdout.write("Streaming: ");
  for await (const chunk of session.streamResponse("Tell me a joke in one sentence.")) {
    process.stdout.write(chunk);
  }
  console.log();
  session.dispose();
}

// ─── Structured / guided generation ─────────────────────────────────────────

interface Cat {
  name: string;
  age: number;
  breed: string;
}

async function structuredExample() {
  const schema = new GenerationSchema("Cat", "A rescue cat")
    .property("name", "string", { description: "The cat's name" })
    .property("age", "integer", {
      description: "Age in years",
      guides: [GenerationGuide.range(0, 20)],
    })
    .property("breed", "string", { description: "The cat's breed" });

  const session = new LanguageModelSession();
  const content = await session.respondWithSchema("Generate a rescue cat", schema);

  const cat: Cat = {
    name: content.value("name"),
    age: content.value("age"),
    breed: content.value("breed"),
  };
  console.log("Cat:", cat);
  session.dispose();
}

// ─── JSON Schema generation (round-trip via schema builder) ──────────────────

async function jsonSchemaExample() {
  // respondWithJsonSchema expects Apple's GenerationSchema JSON format,
  // which you obtain via schema.toDict(). Build with the schema builder first.
  const personSchema = new GenerationSchema("Person", "A person profile")
    .property("name", "string", { description: "Full name" })
    .property("age", "integer", {
      description: "Age in years",
      guides: [GenerationGuide.range(0, 120)],
    })
    .property("occupation", "string", { description: "Job title" });

  const session = new LanguageModelSession();
  const content = await session.respondWithJsonSchema(
    "Generate a person profile",
    personSchema.toDict(),
  );
  console.log("Person:", content.toObject());
  session.dispose();
}

// ─── Custom Tool ─────────────────────────────────────────────────────────────

class CalculatorTool extends Tool {
  readonly name = "calculator";
  readonly description = "Performs basic arithmetic. Returns the result as a number.";

  readonly argumentsSchema = new GenerationSchema("CalculatorParams", "Calculator inputs")
    .property("operation", "string", {
      description: "One of: add, subtract, multiply, divide",
      guides: [GenerationGuide.anyOf(["add", "subtract", "multiply", "divide"])],
    })
    .property("a", "number", { description: "First operand" })
    .property("b", "number", { description: "Second operand" });

  async call(args: GeneratedContent): Promise<string> {
    const op = args.value<string>("operation");
    const a = args.value<number>("a");
    const b = args.value<number>("b");

    switch (op) {
      case "add":
        return String(a + b);
      case "subtract":
        return String(a - b);
      case "multiply":
        return String(a * b);
      case "divide":
        if (b === 0) throw new Error("Division by zero");
        return String(a / b);
      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  }
}

async function toolExample() {
  const calculator = new CalculatorTool();
  const session = new LanguageModelSession({
    instructions: "You are a helpful math assistant.",
    tools: [calculator],
  });

  const reply = await session.respond("What is 15% of 240?");
  console.log("Answer:", reply);
  session.dispose();
  calculator.dispose();
}

// ─── Generation options ───────────────────────────────────────────────────────

async function optionsExample() {
  const session = new LanguageModelSession();
  const reply = await session.respond("Write a haiku about rain.", {
    options: {
      temperature: 0.9,
      sampling: SamplingMode.random({ top: 50, seed: 42 }),
      maximumResponseTokens: 100,
    },
  });
  console.log("Haiku:", reply);
  session.dispose();
}

// ─── Transcript persistence ───────────────────────────────────────────────────

async function transcriptExample() {
  const session = new LanguageModelSession();
  await session.respond("My name is Cody.");
  await session.respond("What is my name?");

  // Export as JSON string
  const json = session.transcript.toJson();
  console.log("Transcript (first 100 chars):", json.slice(0, 100));

  // Resume from saved transcript
  const savedTranscript = Transcript.fromJson(json);
  const resumed = LanguageModelSession.fromTranscript(savedTranscript);
  const recall = await resumed.respond("Summarize our conversation so far.");
  console.log("Recalled:", recall);
  session.dispose();
  resumed.dispose();
}

// ─── Content tagging model ────────────────────────────────────────────────────

async function contentTaggingExample() {
  const model = new SystemLanguageModel({
    useCase: SystemLanguageModelUseCase.CONTENT_TAGGING,
  });
  const { available } = await model.waitUntilAvailable();
  if (!available) {
    console.error("Content tagging model not available");
    model.dispose();
    return;
  }
  const session = new LanguageModelSession({ model });
  const reply = await session.respond("Classify this text: 'I love pizza!'");
  console.log("Tag:", reply);
  session.dispose();
  model.dispose();
}

// Run all examples sequentially
(async () => {
  console.log("\n── Basic ──");
  await basicExample();

  console.log("\n── Streaming ──");
  await streamingExample();

  console.log("\n── Structured ──");
  await structuredExample();

  console.log("\n── JSON Schema ──");
  await jsonSchemaExample();

  console.log("\n── Tool ──");
  await toolExample();

  console.log("\n── Options ──");
  await optionsExample();

  console.log("\n── Transcript ──");
  await transcriptExample();

  console.log("\n── Content Tagging ──");
  await contentTaggingExample();
})().catch(console.error);

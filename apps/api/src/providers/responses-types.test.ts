import { describe, expect, it } from "vitest";
import {
  assertNever,
  type ResponseInputItem,
  type ResponseInputMessage,
  type ResponseInputTextParam,
  type ResponseOutputItem,
  type ResponseReferenceItemParam,
} from "./responses-types";

describe("responses-types", () => {
  it("models a text input param", () => {
    const item: ResponseInputTextParam = { type: "input_text", text: "hi" };
    expect(item.type).toBe("input_text");
  });

  it("models a reference input item", () => {
    const item: ResponseReferenceItemParam = { type: "item_reference", id: "msg_1" };
    expect(item.type).toBe("item_reference");
  });

  it("models a user message input", () => {
    const message: ResponseInputMessage = {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hi" }],
      status: "completed",
    };
    expect(message.role).toBe("user");
    expect(message.content).toHaveLength(1);
  });

  it("treats ResponseInputItem as a discriminated union", () => {
    const items: ResponseInputItem[] = [
      { type: "input_text", text: "hi" },
      { type: "item_reference", id: "msg_1" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    ];
    const discriminators = items.map((item) => {
      switch (item.type) {
        case "input_text":
          return "text";
        case "item_reference":
          return "ref";
        case "message":
          return "message";
        default:
          return assertNever(item);
      }
    });
    expect(discriminators).toEqual(["text", "ref", "message"]);
  });

  it("treats ResponseOutputItem as a discriminated union", () => {
    const items: ResponseOutputItem[] = [
      { type: "output_text", text: "hello" },
      { type: "refusal", refusal: "nope" },
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "hello" }],
      },
      {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "lookup",
        arguments: "{}",
        status: "completed",
      },
    ];
    const discriminators = items.map((item) => {
      switch (item.type) {
        case "output_text":
          return "text";
        case "refusal":
          return "refusal";
        case "message":
          return "message";
        case "function_call":
          return "function_call";
        default:
          return assertNever(item);
      }
    });
    expect(discriminators).toEqual(["text", "refusal", "message", "function_call"]);
  });

  it("assertNever throws on unexpected values", () => {
    expect(() => assertNever("nope" as never)).toThrow(/Unexpected value/);
  });
});

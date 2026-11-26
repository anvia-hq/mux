import type { JsonSchemaValidationResult } from "./types";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const extractAllowedTypes = (typeField: unknown): string[] => {
  if (Array.isArray(typeField)) {
    const result: string[] = [];

    for (const item of typeField) {
      if (typeof item === "string") {
        result.push(item);
      }
    }

    return result;
  }

  if (typeof typeField === "string") {
    return [typeField];
  }

  return [];
};

const matchesPrimitiveType = (value: unknown, expected: string): boolean => {
  if (expected === "null") {
    return value === null;
  }

  if (expected === "boolean") {
    return typeof value === "boolean";
  }

  if (expected === "string") {
    return typeof value === "string";
  }

  if (expected === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }

  if (expected === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }

  if (expected === "array") {
    return Array.isArray(value);
  }

  if (expected === "object") {
    return isPlainObject(value);
  }

  return true;
};

const validateNode = (
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  errors: string[],
): void => {
  if (schema.type !== undefined) {
    const allowedTypes = extractAllowedTypes(schema.type);

    if (
      allowedTypes.length > 0 &&
      !allowedTypes.some((typeName) => matchesPrimitiveType(value, typeName))
    ) {
      errors.push(`${path}: expected type ${allowedTypes.join(" | ")}.`);

      return;
    }
  }

  if (Array.isArray(schema.enum)) {
    const matched = schema.enum.some((option) => Object.is(option, value));

    if (!matched) {
      errors.push(`${path}: value is not one of the allowed enum values.`);
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push(`${path}: string length must be >= ${schema.minLength}.`);
    }

    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push(`${path}: string length must be <= ${schema.maxLength}.`);
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push(`${path}: value must be >= ${schema.minimum}.`);
    }

    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push(`${path}: value must be <= ${schema.maximum}.`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push(`${path}: array must contain at least ${schema.minItems} items.`);
    }

    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push(`${path}: array must contain at most ${schema.maxItems} items.`);
    }

    if (isPlainObject(schema.items)) {
      for (let i = 0; i < value.length; i += 1) {
        validateNode(value[i], schema.items, `${path}[${i}]`, errors);
      }
    }
  }

  if (isPlainObject(value)) {
    if (Array.isArray(schema.required)) {
      for (const reqKey of schema.required) {
        if (typeof reqKey === "string" && !Object.hasOwn(value, reqKey)) {
          errors.push(`${path}.${reqKey}: required property is missing.`);
        }
      }
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : null;

    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (Object.hasOwn(value, key) && isPlainObject(propSchema)) {
          validateNode(value[key], propSchema, `${path}.${key}`, errors);
        }
      }
    }

    if (schema.additionalProperties === false && properties) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) {
          errors.push(`${path}.${key}: additional property is not allowed.`);
        }
      }
    }
  }
};

export const validateAgainstJsonSchema = (
  value: unknown,
  schema: Record<string, unknown>,
): JsonSchemaValidationResult => {
  const errors: string[] = [];

  validateNode(value, schema, "$", errors);

  return {
    valid: errors.length === 0,
    errors,
  };
};

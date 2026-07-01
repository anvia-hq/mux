UPDATE "CustomProviderModel"
SET
    "reasoning" = TRUE,
    "toolCall" = TRUE,
    "structuredOutput" = TRUE,
    "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "CustomProviderModel"
SET
    "inputModalities" = ARRAY['text', 'image', 'pdf']::TEXT[],
    "outputModalities" = ARRAY['text']::TEXT[],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "modelId" = 'gpt-5.5';

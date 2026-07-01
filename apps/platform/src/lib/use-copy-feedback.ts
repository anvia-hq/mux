import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type CopyOptions = {
  value: string;
  copiedId: string;
  successMessage: string;
  errorMessage: string;
  description?: string;
};

export function useCopyFeedback(resetMs = 1400) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clearResetTimer = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const copy = useCallback(
    async ({ value, copiedId, successMessage, errorMessage, description }: CopyOptions) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopiedId(copiedId);
        clearResetTimer();
        timeoutRef.current = window.setTimeout(() => setCopiedId(null), resetMs);
        if (description) {
          toast.success(successMessage, { description });
        } else {
          toast.success(successMessage);
        }
        return true;
      } catch {
        toast.error(errorMessage);
        return false;
      }
    },
    [clearResetTimer, resetMs],
  );

  return { copiedId, copy };
}

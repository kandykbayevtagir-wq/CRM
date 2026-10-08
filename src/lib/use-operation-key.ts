"use client";

import { useRef } from "react";

// An ambiguous network failure must retry the same logical operation.
// Changing the payload creates a new operation; dismissing a successful form
// clears the key explicitly.
export function useOperationKey() {
  const current = useRef<{ signature: string; key: string } | null>(null);
  return {
    get(body: Record<string, unknown>) {
      const signature = JSON.stringify(body);
      if (current.current?.signature !== signature) current.current = { signature, key: crypto.randomUUID() };
      return current.current.key;
    },
    reset() { current.current = null; },
  };
}

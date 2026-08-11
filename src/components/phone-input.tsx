"use client";

import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";

import { formatKzPhone, normalizePhone } from "@/lib/validation/phone";

type PhoneInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "defaultValue" | "onChange" | "value" | "type"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (normalized: string) => void;
};

function digitCountBefore(value: string, position: number) {
  return value.slice(0, position).replace(/\D/g, "").length;
}

function cursorForDigit(display: string, digitIndex: number) {
  if (digitIndex <= 0) return display.startsWith("+7") ? 3 : 0;
  let seen = 0;
  for (let index = 0; index < display.length; index += 1) {
    if (/\d/.test(display[index])) {
      seen += 1;
      if (seen >= digitIndex) return index + 1;
    }
  }
  return display.length;
}

export function PhoneInput({ value, defaultValue, onValueChange, id, name = "phone", ...props }: PhoneInputProps) {
  const [display, setDisplay] = useState(formatKzPhone(value ?? defaultValue ?? ""));
  const inputRef = useRef<HTMLInputElement>(null);
  const lastExternalValue = useRef(value);

  useEffect(() => {
    if (value === undefined || value === lastExternalValue.current) return;
    lastExternalValue.current = value;
    setDisplay(formatKzPhone(value));
  }, [value]);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.currentTarget.value;
    const oldCursor = event.currentTarget.selectionStart ?? raw.length;
    const digitsBefore = digitCountBefore(raw, oldCursor);
    const next = formatKzPhone(raw);
    setDisplay(next);
    lastExternalValue.current = undefined;
    onValueChange?.(normalizePhone(raw));
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      const position = cursorForDigit(next, Math.min(digitsBefore, next.replace(/\D/g, "").length));
      input.setSelectionRange(position, position);
    });
  }

  return (
    <input
      {...props}
      ref={inputRef}
      id={id ?? name}
      name={name}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      enterKeyHint={props.enterKeyHint ?? "next"}
      value={display}
      onChange={handleChange}
      onFocus={(event) => {
        if (!event.currentTarget.value) setDisplay("+7 ");
        props.onFocus?.(event);
      }}
    />
  );
}

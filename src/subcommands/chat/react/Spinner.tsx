import React, { useState, useEffect } from "react";
import { Text } from "ink";

const LINE_SPINNER = ["-", "\\", "|", "/"];
const BRAILLE_SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerOpts {
  type?: "line" | "braille";
}

export function Spinner({ type = "line" }: SpinnerOpts) {
  const [frameIndex, setFrameIndex] = useState(0);

  const frames = type === "braille" ? BRAILLE_SPINNER : LINE_SPINNER;

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameIndex(currentIndex => (currentIndex + 1) % frames.length);
    }, 80);

    return () => clearInterval(interval);
  }, [frames.length]);

  return <Text color="cyan">{frames[frameIndex]}</Text>;
}

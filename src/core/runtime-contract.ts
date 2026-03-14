export function renderUnsupported(category: string, values: string[], guidance: string): Error {
  return new Error(
    `Unsupported ${category}: ${values.join(", ")}. Outside the current capability contract. ${guidance}`,
  );
}

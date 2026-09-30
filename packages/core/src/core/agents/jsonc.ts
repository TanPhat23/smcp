export function stripJsonComments(input: string): string {
  // Step 1: Strip single-line and multi-line comments while preserving string literals
  const withoutComments = input.replace(
    /("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    (_match, stringLiteral) => (stringLiteral ? stringLiteral : "")
  );

  // Step 2: Strip trailing commas before closing braces/brackets while preserving string literals
  return withoutComments.replace(
    /("(?:[^"\\]|\\.)*")|(,)(\s*[}\]])/gm,
    (_match, stringLiteral, _comma, closing) => {
      if (stringLiteral) return stringLiteral;
      if (closing) return closing;
      return "";
    }
  );
}

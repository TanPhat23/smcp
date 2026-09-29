export function stripJsonComments(input: string): string {
  return input.replace(
    /("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/.*$|(,)(\s*[}\]])/gm,
    (_match, stringLiteral, _comma, closing) => {
      if (stringLiteral) return stringLiteral;
      if (closing) return closing;
      return "";
    }
  );
}

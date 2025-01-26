// https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
export function hashCode(input: string) {
  let hash = 0;
  const input_length = input.length;
  let chr: number;
  if (input.length === 0) return hash;
  for (let i = 0; i < input_length; i++) {
    chr = input.charCodeAt(i);
    // eslint-disable-next-line no-bitwise
    hash = (hash << 5) - hash + chr;
    // eslint-disable-next-line no-bitwise
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

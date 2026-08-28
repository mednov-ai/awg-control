export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
}

export function maskedKey(value: string): string {
  const unpadded = value.replace(/=+$/, "");
  return unpadded.length > 14 ? `${unpadded.slice(0, 6)}…${unpadded.slice(-6)}` : unpadded;
}

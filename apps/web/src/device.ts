export function coarseDeviceLabel(userAgent: string): string {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);
  const platform = /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iOS" : mobile ? "Mobile" : "Desktop";
  const browser = /Edg\//i.test(userAgent) ? "Edge" : /Firefox\//i.test(userAgent) ? "Firefox" :
    /CriOS|Chrome\//i.test(userAgent) ? "Chrome" : /Safari\//i.test(userAgent) ? "Safari" : "Browser";
  return `${browser} / ${platform}`.slice(0, 80);
}

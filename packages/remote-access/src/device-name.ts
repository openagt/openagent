/**
 * What to call a device in the list, from what its browser says it is (`User-Agent`): the kind
 * of device, then the browser, "iPhone, Safari". Only a label for the person reading the list:
 * nothing is decided by it.
 */
export function deviceName(userAgent: string | undefined): string {
  const ua = userAgent ?? ''
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'Android phone'
          : 'Android tablet'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : undefined
  // Order matters: Edge and Chrome on iOS both also say Safari, and Edge also says Chrome.
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : undefined
  return [device, browser].filter(Boolean).join(', ') || 'A device'
}

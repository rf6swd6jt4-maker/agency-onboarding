const MAX_CLIENT_LOGO_BYTES = 2 * 1024 * 1024

const UNSAFE_SVG_PATTERNS = [
    /<!doctype/iu,
    /<!entity/iu,
    /<\s*(?:script|foreignObject|iframe|object|embed|audio|video|canvas|form)\b/iu,
    /\bon[a-z]+\s*=/iu,
    /\b(?:javascript|vbscript|file):/iu,
    /\bdata\s*:/iu,
    /@import/iu,
    /url\(\s*["']?(?!#)/iu,
    /\b(?:href|src)\s*=\s*["'](?!#)/iu,
]

export function validateClientLogoSvg(bytes: Uint8Array) {
    if (!bytes.byteLength) throw new Error("Choose a non-empty SVG logo.")
    if (bytes.byteLength > MAX_CLIENT_LOGO_BYTES) throw new Error("Agency logo SVGs must be 2MB or smaller.")

    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/u, "").trim()
    if (!/^<\?xml\b[^>]*>\s*/iu.test(source) && !/^<svg\b/iu.test(source)) {
        throw new Error("Agency logos must be valid SVG files.")
    }
    if (!/<svg\b[^>]*\bviewBox\s*=\s*["'][^"']+["']/iu.test(source)) {
        throw new Error("Agency logo SVGs need a viewBox so they scale cleanly on every screen.")
    }
    if (UNSAFE_SVG_PATTERNS.some((pattern) => pattern.test(source))) {
        throw new Error("This SVG contains scripts, external files, or other unsupported content. Export it as a self-contained SVG and try again.")
    }
    return source
}

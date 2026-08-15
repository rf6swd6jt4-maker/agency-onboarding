import sharp from "sharp"

function stickerFileName(name: string) {
    const base = name
        .replace(/[/\\?%*:|"<>]/gu, "-")
        .replace(/[\u0000-\u001f\u007f]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .replace(/\.[^.]+$/u, "")
        .slice(0, 120) || "sticker"
    return `${base}.webp`
}

export async function convertCommunicationStickerImage(
    file: { name: string; size: number; type: string; bytes: Uint8Array }
) {
    if (!file.name.trim() || file.size <= 0) throw new Error("Choose a non-empty sticker image.")
    if (file.size > 10 * 1024 * 1024) throw new Error("Sticker source images can be up to 10MB.")
    if (!new Set(["image/jpeg", "image/png"]).has(file.type.toLowerCase())) {
        throw new Error("Upload a JPEG or PNG image for the sticker tray.")
    }
    const source = sharp(file.bytes, { failOn: "error" }).rotate()
    const metadata = await source.metadata()
    if (metadata.format !== "jpeg" && metadata.format !== "png") {
        throw new Error("The sticker source must be a valid JPEG or PNG image.")
    }

    for (const quality of [82, 72, 62, 52, 42, 34]) {
        const converted = await source
            .clone()
            .resize(512, 512, {
                fit: "contain",
                position: "centre",
                background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .webp({ quality, alphaQuality: 90, effort: 6, smartSubsample: true })
            .toBuffer()
        if (converted.byteLength <= 100 * 1024) {
            return { bytes: new Uint8Array(converted), fileName: stickerFileName(file.name) }
        }
    }
    throw new Error("This image could not be compressed below WhatsApp's 100KB sticker limit.")
}

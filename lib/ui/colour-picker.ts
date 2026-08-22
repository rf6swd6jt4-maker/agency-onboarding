export type HsvColour = {
    h: number
    s: number
    v: number
}

function clamp(value: number, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value))
}

function normalizeHex(value: string) {
    const text = value.trim().toUpperCase()
    return /^#[0-9A-F]{6}$/.test(text) ? text : "#000000"
}

export function hexToHsv(value: string): HsvColour {
    const hex = normalizeHex(value)
    const red = Number.parseInt(hex.slice(1, 3), 16) / 255
    const green = Number.parseInt(hex.slice(3, 5), 16) / 255
    const blue = Number.parseInt(hex.slice(5, 7), 16) / 255
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    const delta = maximum - minimum
    let hue = 0

    if (delta) {
        if (maximum === red) hue = 60 * (((green - blue) / delta) % 6)
        else if (maximum === green) hue = 60 * ((blue - red) / delta + 2)
        else hue = 60 * ((red - green) / delta + 4)
    }

    return {
        h: hue < 0 ? hue + 360 : hue,
        s: maximum ? delta / maximum : 0,
        v: maximum,
    }
}

export function hsvToHex({ h, s, v }: HsvColour) {
    const hue = ((h % 360) + 360) % 360
    const saturation = clamp(s)
    const value = clamp(v)
    const chroma = value * saturation
    const segment = hue / 60
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1))
    const match = value - chroma
    const [red, green, blue] = segment < 1 ? [chroma, intermediate, 0]
        : segment < 2 ? [intermediate, chroma, 0]
            : segment < 3 ? [0, chroma, intermediate]
                : segment < 4 ? [0, intermediate, chroma]
                    : segment < 5 ? [intermediate, 0, chroma]
                        : [chroma, 0, intermediate]
    return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`
}

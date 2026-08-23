"use client"

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import type { OnboardingBrandSwatch } from "@/lib/onboarding/configuration-types"
import { normalizeHexColour } from "@/lib/onboarding/theme"
import { hexToHsv, hsvToHex } from "@/lib/ui/colour-picker"

function clamp(value: number, minimum = 0, maximum = 1) {
    return Math.min(maximum, Math.max(minimum, value))
}

function pointerFraction(event: PointerEvent<HTMLElement>, axis: "x" | "y") {
    const rect = event.currentTarget.getBoundingClientRect()
    const position = axis === "x" ? event.clientX - rect.left : event.clientY - rect.top
    const length = axis === "x" ? rect.width : rect.height
    return clamp(position / Math.max(1, length))
}

function ColourPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
    const [hexDraft, setHexDraft] = useState(normalizeHexColour(value) ?? "#000000")
    const hsv = useMemo(() => hexToHsv(normalizeHexColour(hexDraft) ?? value), [hexDraft, value])
    const [hue, setHue] = useState(hsv.h)
    const saturationDragging = useRef(false)
    const hueDragging = useRef(false)

    function commit(nextHex: string) {
        setHexDraft(nextHex)
        onChange(nextHex)
    }

    function changeSaturationValue(event: PointerEvent<HTMLDivElement>) {
        const saturation = pointerFraction(event, "x")
        const brightness = 1 - pointerFraction(event, "y")
        commit(hsvToHex({ h: hue, s: saturation, v: brightness }))
    }

    function changeHue(event: PointerEvent<HTMLDivElement>) {
        const nextHue = pointerFraction(event, "x") * 360
        setHue(nextHue)
        commit(hsvToHex({ h: nextHue, s: hsv.s, v: hsv.v }))
    }

    function nudgeHue(event: KeyboardEvent<HTMLDivElement>) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)) return
        event.preventDefault()
        const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1
        const nextHue = (hue + direction + 360) % 360
        setHue(nextHue)
        commit(hsvToHex({ h: nextHue, s: hsv.s, v: hsv.v }))
    }

    function nudgeSaturationValue(event: KeyboardEvent<HTMLDivElement>) {
        if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return
        event.preventDefault()
        const saturation = clamp(hsv.s + (event.key === "ArrowLeft" ? -0.01 : event.key === "ArrowRight" ? 0.01 : 0))
        const brightness = clamp(hsv.v + (event.key === "ArrowDown" ? -0.01 : event.key === "ArrowUp" ? 0.01 : 0))
        commit(hsvToHex({ h: hue, s: saturation, v: brightness }))
    }

    return <div>
        <div
            role="slider"
            tabIndex={0}
            aria-label={`${label} saturation and brightness`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.v * 100)}
            aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
            onKeyDown={nudgeSaturationValue}
            onPointerDown={(event) => { saturationDragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); changeSaturationValue(event) }}
            onPointerMove={(event) => { if (saturationDragging.current) changeSaturationValue(event) }}
            onPointerUp={(event) => { saturationDragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId) }}
            onPointerCancel={() => { saturationDragging.current = false }}
            className="relative h-32 touch-none overflow-hidden rounded-xl border border-white/10 sm:h-36"
            style={{ backgroundColor: `hsl(${hue} 100% 50%)`, backgroundImage: "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)" }}
        >
            <span aria-hidden="true" className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.65)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }} />
        </div>
        <div
            role="slider"
            tabIndex={0}
            aria-label={`${label} hue`}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hue)}
            onKeyDown={nudgeHue}
            onPointerDown={(event) => { hueDragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); changeHue(event) }}
            onPointerMove={(event) => { if (hueDragging.current) changeHue(event) }}
            onPointerUp={(event) => { hueDragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId) }}
            onPointerCancel={() => { hueDragging.current = false }}
            className="relative mt-3 h-3 touch-none rounded-full"
            style={{ background: "linear-gradient(90deg, #FF0000 0%, #FFFF00 16.67%, #00FF00 33.33%, #00FFFF 50%, #0000FF 66.67%, #FF00FF 83.33%, #FF0000 100%)" }}
        >
            <span aria-hidden="true" className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,.7)]" style={{ left: `${hue / 360 * 100}%`, backgroundColor: `hsl(${hue} 100% 50%)` }} />
        </div>
        <label className="mt-3 block">
            <span className="sr-only">{label} hex code</span>
            <div className="flex h-10 items-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 focus-within:border-neutral-500">
                <span className="mr-2 text-xs font-medium text-neutral-500">HEX</span>
                <input
                    value={hexDraft}
                    inputMode="text"
                    maxLength={7}
                    onChange={(event) => {
                        const next = event.target.value.toUpperCase()
                        setHexDraft(next)
                        const normalized = normalizeHexColour(next)
                        if (normalized) {
                            const nextHsv = hexToHsv(normalized)
                            if (nextHsv.s > 0.01 && nextHsv.v > 0.01) setHue(nextHsv.h)
                            onChange(normalized)
                        }
                    }}
                    onBlur={() => setHexDraft(normalizeHexColour(value) ?? "#000000")}
                    className="min-w-0 flex-1 bg-transparent text-right font-mono text-sm uppercase text-white outline-none"
                />
            </div>
        </label>
    </div>
}

export function ColourStyleEditor({
    titleId,
    roleLabel,
    assignedSwatch,
    swatches,
    onUpdateSwatch,
    onAssignSwatch,
    onCreateSwatch,
    onClose,
}: {
    titleId: string
    roleLabel: string
    assignedSwatch: OnboardingBrandSwatch | null
    swatches: OnboardingBrandSwatch[]
    onUpdateSwatch: (id: string, values: Partial<OnboardingBrandSwatch>) => void
    onAssignSwatch: (id: string) => void
    onCreateSwatch: (name: string, hex: string) => void
    onClose: () => void
}) {
    const [creating, setCreating] = useState(false)
    const [newName, setNewName] = useState("")
    const [newHex, setNewHex] = useState("#64748B")
    const orderedSwatches = assignedSwatch
        ? [assignedSwatch, ...swatches.filter((swatch) => swatch.id !== assignedSwatch.id)]
        : swatches

    function saveNewStyle() {
        const name = newName.trim()
        const hex = normalizeHexColour(newHex)
        if (!name || !hex) return
        onCreateSwatch(name, hex)
        setNewName("")
        setNewHex("#64748B")
        setCreating(false)
    }

    if (creating) return <div className="flex max-h-[min(92dvh,38rem)] min-h-0 flex-col overflow-hidden">
        <div className="relative flex shrink-0 items-center border-b border-neutral-800 px-3 py-3">
            <button type="button" aria-label="Back to styles" onClick={() => setCreating(false)} className="flex h-8 w-8 items-center justify-center text-neutral-500 hover:text-white"><svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4"><path d="m10 3-5 5 5 5" /></svg></button>
            <p id={titleId} className="pointer-events-none absolute inset-x-12 truncate text-center text-sm font-medium text-white">New colour style</p>
            <button type="button" aria-label="Close colour editor" onClick={onClose} className="ml-auto flex h-8 w-8 items-center justify-center text-lg text-neutral-500 hover:text-white">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <label className="block"><span className="sr-only">Style name</span><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} placeholder="Name" className="h-10 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-neutral-500" /></label>
            <div className="mt-3"><ColourPicker value={newHex} onChange={setNewHex} label="New style" /></div>
        </div>
        <div className="border-t border-neutral-800 p-3"><button type="button" disabled={!newName.trim()} onClick={saveNewStyle} className="h-10 w-full rounded-lg bg-white text-sm font-medium text-black disabled:opacity-30">Save style</button></div>
    </div>

    return <div className="flex max-h-[min(92dvh,38rem)] min-h-0 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 px-3 py-3"><p id={titleId} className="truncate text-sm font-medium text-white">{roleLabel}</p><button type="button" aria-label="Close colour editor" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center text-lg text-neutral-500 hover:text-white">×</button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ColourPicker key={assignedSwatch?.id ?? "unassigned"} value={assignedSwatch?.hex ?? "#000000"} onChange={(hex) => { if (assignedSwatch) onUpdateSwatch(assignedSwatch.id, { hex }) }} label={roleLabel} />
            <div className="mt-4 border-t border-neutral-800 pt-3">
                <div className="flex items-center justify-between"><p className="text-xs font-medium text-neutral-400">Styles</p><button type="button" aria-label="Add colour style" onClick={() => setCreating(true)} className="flex h-8 w-8 items-center justify-center rounded-md text-xl font-light text-neutral-400 hover:bg-neutral-900 hover:text-white">+</button></div>
                <div className="mt-1 divide-y divide-neutral-900">
                    {orderedSwatches.map((swatch) => {
                        const selected = swatch.id === assignedSwatch?.id
                        return <button key={swatch.id} type="button" onClick={() => onAssignSwatch(swatch.id)} className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-neutral-900 ${selected ? "text-white" : "text-neutral-400"}`}>
                            <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border border-white/10" style={{ backgroundColor: normalizeHexColour(swatch.hex) ?? "#000000" }} />
                            <span className="min-w-0 flex-1 truncate text-sm">{swatch.name}</span>
                            {selected ? <span className="text-xs text-neutral-500">Selected</span> : null}
                        </button>
                    })}
                </div>
            </div>
        </div>
    </div>
}

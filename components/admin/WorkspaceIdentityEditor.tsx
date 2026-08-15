"use client"

import { ChangeEvent, CSSProperties, PointerEvent, useRef, useState, useTransition } from "react"

type Props = {
    workspace: { name: string; slug: string; bannerHeight: number; bannerPosition: number; bannerSrc: string | null; logoSrc: string | null }
    updateName: (formData: FormData) => Promise<void>
    updateCoverLayout: (height: number, position: number) => Promise<void>
    uploadBanner: (formData: FormData) => Promise<void>
    uploadLogo: (formData: FormData) => Promise<void>
    product?: "client-work" | "leadgen"
    description?: string | null
    bannerLabel?: string
    editable?: boolean
    displayName?: string
    showNameEditor?: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(value)))
function PencilIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" /><path d="m13.5 8.5 3 3" /></svg> }
function CheckIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m5 12 4 4L19 6" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m6 6 12 12M18 6 6 18" /></svg> }
function ResizeIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2"><path d="m8 10 4-4 4 4M8 14l4 4 4-4" /></svg> }

export function WorkspaceIdentityEditor({ workspace, updateName, updateCoverLayout, uploadBanner, uploadLogo, description = "Settings for this workspace.", bannerLabel = "dashboard banner", editable = true, displayName, showNameEditor = true }: Props) {
    const [nameEditing, setNameEditing] = useState(false)
    const [name, setName] = useState(workspace.name)
    const [height, setHeight] = useState(workspace.bannerHeight)
    const [position, setPosition] = useState(workspace.bannerPosition)
    const [pending, startTransition] = useTransition()
    const layout = useRef({ height: workspace.bannerHeight, position: workspace.bannerPosition })
    const resizeStart = useRef<{ y: number; height: number } | null>(null)
    const imageStart = useRef<{ y: number; position: number } | null>(null)
    const bannerInput = useRef<HTMLInputElement>(null)
    const logoInput = useRef<HTMLInputElement>(null)
    const [bannerSelected, setBannerSelected] = useState(false)
    const [logoSelected, setLogoSelected] = useState(false)

    function reportMutation() { window.dispatchEvent(new Event("betelgeze:workspace-mutation")) }
    function saveCover() { const next = layout.current; startTransition(async () => { await updateCoverLayout(next.height, next.position); reportMutation() }) }
    function saveName() { const data = new FormData(); data.set("name", name); startTransition(async () => { await updateName(data); setNameEditing(false); reportMutation() }) }
    function upload(input: HTMLInputElement, action: (formData: FormData) => Promise<void>, key: "banner" | "logo") { if (!input.files?.[0]) return; const data = new FormData(); data.set(key, input.files[0]); startTransition(async () => { await action(data); reportMutation() }) }
    function onResizeStart(event: PointerEvent<HTMLButtonElement>) { event.preventDefault(); event.stopPropagation(); resizeStart.current = { y: event.clientY, height: layout.current.height }; event.currentTarget.setPointerCapture(event.pointerId) }
    function onResizeMove(event: PointerEvent<HTMLButtonElement>) { if (!resizeStart.current) return; const next = clamp(resizeStart.current.height + event.clientY - resizeStart.current.y, 192, 288); layout.current.height = next; setHeight(next) }
    function onResizeEnd() { if (!resizeStart.current) return; resizeStart.current = null; saveCover() }
    function onImageStart(event: PointerEvent<HTMLDivElement>) { if (!editable || window.innerWidth < 640 || !workspace.bannerSrc || (event.target as HTMLElement).closest("button")) return; imageStart.current = { y: event.clientY, position: layout.current.position }; event.currentTarget.setPointerCapture(event.pointerId) }
    function onImageMove(event: PointerEvent<HTMLDivElement>) { if (!imageStart.current) return; const next = clamp(imageStart.current.position - ((event.clientY - imageStart.current.y) / Math.max(layout.current.height, 1)) * 100, 0, 100); layout.current.position = next; setPosition(next) }
    function onImageEnd() { if (!imageStart.current) return; imageStart.current = null; saveCover() }

    return <><div className="group relative mb-16 h-48 touch-pan-x overflow-visible rounded-xl border border-neutral-800 bg-neutral-900 sm:h-[var(--workspace-cover-height)] sm:touch-none sm:rounded-2xl" style={{ "--workspace-cover-height": `${height}px` } as CSSProperties} onPointerDown={onImageStart} onPointerMove={onImageMove} onPointerUp={onImageEnd} onPointerCancel={onImageEnd}>{workspace.bannerSrc ? <img draggable={false} src={workspace.bannerSrc} alt={`${workspace.name} ${bannerLabel}`} className={`h-full w-full select-none rounded-xl object-cover transition-opacity sm:rounded-2xl ${bannerSelected || pending ? "opacity-60" : ""}`} style={{ objectPosition: `50% ${position}%` }} /> : <div className="flex h-full items-center justify-center rounded-xl bg-gradient-to-br from-neutral-800 to-neutral-900 text-sm text-neutral-500 sm:rounded-2xl">{editable ? `Add a ${bannerLabel}` : `No ${bannerLabel} set`}</div>}{editable && <button data-icon-button type="button" onClick={() => bannerInput.current?.click()} aria-label={`Replace ${bannerLabel}`} className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white backdrop-blur transition hover:bg-black/70"><PencilIcon /></button>}<input ref={bannerInput} onChange={(event: ChangeEvent<HTMLInputElement>) => { setBannerSelected(true); upload(event.currentTarget, uploadBanner, "banner") }} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" />{editable && <button data-icon-button type="button" aria-label="Drag to resize banner" title="Drag to resize banner" onPointerDown={onResizeStart} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} className="absolute bottom-0 left-1/2 hidden h-10 w-10 -translate-x-1/2 translate-y-1/2 touch-none items-center justify-center rounded-full border border-neutral-600 bg-neutral-900 text-neutral-100 shadow-xl transition hover:border-white sm:inline-flex"><ResizeIcon /></button>}{workspace.logoSrc && <img src={workspace.logoSrc} alt={`${workspace.name} logo`} className={`absolute bottom-0 left-4 h-[112px] w-[112px] translate-y-1/2 rounded-full border-4 border-neutral-950 bg-neutral-900 object-cover transition-opacity sm:left-7 sm:h-[108px] sm:w-[108px] ${logoSelected || pending ? "opacity-60" : ""}`} />}{editable && <button data-icon-button type="button" onClick={() => logoInput.current?.click()} aria-label="Replace company logo" className="absolute bottom-0 left-[88px] inline-flex h-9 w-9 translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white backdrop-blur transition hover:bg-black/80 sm:left-[98px]"><PencilIcon /></button>}<input ref={logoInput} onChange={(event: ChangeEvent<HTMLInputElement>) => { setLogoSelected(true); upload(event.currentTarget, uploadLogo, "logo") }} className="sr-only" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /></div><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div>{showNameEditor && nameEditing ? <div className="flex items-center gap-2"><input value={name} onChange={(event) => setName(event.target.value)} aria-label="Workspace name" autoFocus className="min-h-11 w-full max-w-md rounded-lg border border-neutral-600 bg-neutral-900 px-3 text-2xl font-semibold" /><button data-icon-button onClick={saveName} disabled={pending} aria-label="Save workspace name" className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white text-black"><CheckIcon /></button><button data-icon-button onClick={() => { setName(workspace.name); setNameEditing(false) }} aria-label="Cancel workspace name edit" className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-neutral-700"><CloseIcon /></button></div> : <div className="flex items-center gap-2"><h1 className="text-2xl font-semibold tracking-tight">{displayName ?? workspace.name}</h1>{editable && showNameEditor && <button data-icon-button type="button" onClick={() => setNameEditing(true)} aria-label="Edit workspace name" className="inline-flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-800 hover:text-white"><PencilIcon /></button>}</div>}{description && <p className="mt-2 text-sm text-neutral-400">{description}</p>}</div>{editable && <span className="text-xs text-neutral-500">{pending ? "Saving changes..." : <><span className="sm:hidden">Cover editing is available on desktop</span><span className="hidden sm:inline">Drag the cover to reposition it</span></>}</span>}</div></>
}

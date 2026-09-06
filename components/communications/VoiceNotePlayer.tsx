"use client"

import { useCallback, useEffect, useRef, useState } from "react"

const WAVEFORM = [7, 12, 17, 10, 20, 14, 8, 16, 22, 12, 18, 9, 15, 21, 11, 7, 17, 23, 13, 19, 9, 14, 20, 11, 16, 8, 18, 22, 12, 17, 10, 15]
const playbackPositions = new Map<string, number>()

function formatPlaybackTime(value: number) {
    if (!Number.isFinite(value) || value < 0) return "0:00"
    const minutes = Math.floor(value / 60)
    const seconds = Math.floor(value % 60)
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

function PlayIcon({ playing }: { playing: boolean }) {
    return playing
        ? <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current"><path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current"><path d="m8 5 11 7-11 7z" /></svg>
}

export function VoiceNotePlayer({ src, fileName, light = false, whiteOnColor = false, onError, initialDuration = 0 }: { src: string; fileName: string; light?: boolean; whiteOnColor?: boolean; onError?: () => void; initialDuration?: number }) {
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [duration, setDuration] = useState(initialDuration)
    const [currentTime, setCurrentTime] = useState(() => playbackPositions.get(src) ?? 0)
    const [playing, setPlaying] = useState(false)
    const [failed, setFailed] = useState(false)
    const attachAudio = useCallback((audio: HTMLAudioElement | null) => {
        audioRef.current = audio
        if (audio?.error) { setFailed(true); onError?.() }
    }, [onError])
    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0

    useEffect(() => {
        const audio = audioRef.current
        return () => audio?.pause()
    }, [])

    async function togglePlayback() {
        const audio = audioRef.current
        if (!audio) return
        if (!audio.paused) {
            audio.pause()
            return
        }
        if (duration > 0 && audio.currentTime >= duration) audio.currentTime = 0
        try {
            await audio.play()
            setFailed(false)
        } catch {
            setFailed(true)
        }
    }

    function seek(value: number) {
        const audio = audioRef.current
        if (!audio || !duration) return
        audio.currentTime = value
        playbackPositions.set(src, value)
        setCurrentTime(value)
    }

    function loadMetadata(audio: HTMLAudioElement) {
        const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0
        setDuration(nextDuration)
        const saved = playbackPositions.get(src) ?? 0
        if (saved > 0 && saved < nextDuration) {
            audio.currentTime = saved
            setCurrentTime(saved)
        }
    }

    return <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} className={`mb-1.5 w-60 max-w-full rounded-xl border px-2.5 py-2 ${whiteOnColor ? "border-white/15 bg-white/10 text-white" : light ? "border-black/10 bg-black/5 text-neutral-800" : "border-white/10 bg-black/20 text-neutral-200"}`}>
        <audio
            ref={attachAudio}
            src={src}
            preload="none"
            onLoadedMetadata={(event) => loadMetadata(event.currentTarget)}
            onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
            onTimeUpdate={(event) => { playbackPositions.set(src, event.currentTarget.currentTime); setCurrentTime(event.currentTarget.currentTime) }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={(event) => { playbackPositions.delete(src); event.currentTarget.currentTime = 0; setCurrentTime(0); setPlaying(false) }}
            onError={() => { setFailed(true); onError?.() }}
        />
        <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => void togglePlayback()} aria-label={`${playing ? "Pause" : "Play"} ${fileName}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center bg-transparent text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"><PlayIcon playing={playing} /></button>
            <div className="min-w-0 flex-1">
                <div className="relative flex h-7 items-center gap-[2px]" aria-hidden="true">
                    {WAVEFORM.map((height, index) => <span key={index} style={{ height }} className={`min-w-px flex-1 rounded-full transition-colors ${index / WAVEFORM.length <= progress ? "bg-white" : whiteOnColor ? "bg-white/35" : light ? "bg-neutral-400" : "bg-neutral-600"}`} />)}
                    <input aria-label={`Seek ${fileName}`} type="range" min={0} max={duration || 0} step={0.1} value={Math.min(currentTime, duration || 0)} onChange={(event) => seek(Number(event.target.value))} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                </div>
                <div className={`mt-0.5 flex items-center justify-between text-[10px] tabular-nums ${failed ? "text-red-500" : whiteOnColor ? "text-white/65" : "text-neutral-500"}`}><span>{failed ? "Audio unavailable" : formatPlaybackTime(currentTime)}</span><span>{formatPlaybackTime(duration)}</span></div>
            </div>
        </div>
    </div>
}

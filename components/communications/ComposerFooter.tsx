"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import { containComposerTouch } from "./composer-touch"

export function ComposerFooter(props: ComponentProps<"footer">) {
    const ref = useRef<HTMLElement>(null)
    useEffect(() => {
        if (ref.current) return containComposerTouch(ref.current)
    }, [])
    return <footer {...props} ref={ref} />
}

export function keepComposerCurrentLineCentered(textarea: HTMLTextAreaElement | null) {
    if (!textarea) return
    window.requestAnimationFrame(() => {
        textarea.scrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
    })
}

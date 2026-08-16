export function keepComposerCurrentLineCentered(textarea: HTMLTextAreaElement | null) {
    if (!textarea) return
    const styles = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20
    const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
    const minimumHeight = Math.ceil(lineHeight + verticalPadding)
    const maximumLines = window.matchMedia("(min-width: 1024px)").matches ? 7 : 4
    const maximumHeight = Math.ceil(lineHeight * maximumLines + verticalPadding)

    textarea.style.height = `${minimumHeight}px`
    const contentHeight = textarea.scrollHeight
    textarea.style.height = `${Math.min(maximumHeight, Math.max(minimumHeight, contentHeight))}px`
    textarea.style.overflowY = contentHeight > maximumHeight ? "auto" : "hidden"

    window.requestAnimationFrame(() => {
        textarea.scrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
    })
}

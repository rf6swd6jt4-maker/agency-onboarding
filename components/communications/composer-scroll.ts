export function keepComposerCurrentLineCentered(textarea: HTMLTextAreaElement | null) {
    if (!textarea) return
    const styles = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20
    const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
    const minimumHeight = Math.ceil(lineHeight + verticalPadding)
    const maximumLines = window.matchMedia("(min-width: 1024px)").matches ? 7 : 4
    const maximumHeight = Math.ceil(lineHeight * maximumLines + verticalPadding)

    const currentHeight = textarea.getBoundingClientRect().height || minimumHeight
    const inlineTransition = textarea.style.transition
    textarea.style.transition = "none"
    textarea.style.height = `${minimumHeight}px`
    const contentHeight = textarea.scrollHeight
    const nextHeight = Math.min(maximumHeight, Math.max(minimumHeight, contentHeight))
    // Measure at the minimum height, restore the currently rendered frame, then
    // let CSS interpolate to the new line count. ResizeObserver keeps the message
    // pane anchored to the same visible content throughout that interpolation.
    textarea.style.height = `${currentHeight}px`
    void textarea.offsetHeight
    textarea.style.transition = inlineTransition
    void textarea.offsetHeight
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = contentHeight > maximumHeight ? "auto" : "hidden"

    window.requestAnimationFrame(() => {
        textarea.scrollTop = Math.max(0, textarea.scrollHeight - textarea.clientHeight)
    })
}

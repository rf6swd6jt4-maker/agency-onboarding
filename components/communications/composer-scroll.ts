export function keepComposerCurrentLineCentered(textarea: HTMLTextAreaElement | null) {
    if (!textarea) return
    const styles = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20
    const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0)
    const minimumHeight = Math.ceil(lineHeight + verticalPadding)
    const maximumLines = window.matchMedia("(min-width: 1024px)").matches ? 7 : 4
    const maximumHeight = Math.ceil(lineHeight * maximumLines + verticalPadding)

    const currentHeight = textarea.getBoundingClientRect().height || minimumHeight
    // Measure outside layout so a routine keystroke cannot briefly collapse the
    // live composer and let the browser clamp the message pane's scroll position.
    const measurement = textarea.cloneNode(false) as HTMLTextAreaElement
    measurement.value = textarea.value
    measurement.setAttribute("aria-hidden", "true")
    measurement.tabIndex = -1
    measurement.style.position = "fixed"
    measurement.style.inset = "0 auto auto -10000px"
    measurement.style.width = `${textarea.getBoundingClientRect().width}px`
    measurement.style.height = "0"
    measurement.style.minHeight = "0"
    measurement.style.maxHeight = "none"
    measurement.style.overflow = "hidden"
    measurement.style.visibility = "hidden"
    measurement.style.pointerEvents = "none"
    measurement.style.transition = "none"
    const measurementHost = textarea.parentElement ?? document.body
    measurementHost.appendChild(measurement)
    const contentHeight = measurement.scrollHeight
    measurement.remove()

    const nextHeight = Math.min(maximumHeight, Math.max(minimumHeight, contentHeight))
    const inlineTransition = textarea.style.transition
    textarea.style.transition = "none"
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

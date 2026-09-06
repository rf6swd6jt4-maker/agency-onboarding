/** Bound simultaneous preview loads; visible entries precede the nearby buffer. */
export function createMediaQueue(limit = 4) {
    const pending = new Set<{ priority: number; start: (done: () => void) => void }>()
    let running = 0
    let scheduled = false
    function drain() {
        scheduled = false
        for (const job of [...pending].sort((a, b) => a.priority - b.priority)) {
            if (running >= limit) break
            pending.delete(job)
            running++
            let complete = false
            job.start(() => { if (!complete) { complete = true; running--; schedule() } })
        }
    }
    function schedule() {
        if (!scheduled) { scheduled = true; queueMicrotask(drain) }
    }
    return {
        add(priority: number, start: (done: () => void) => void) {
            const job = { priority, start }
            pending.add(job)
            schedule()
            return () => { pending.delete(job) }
        },
    }
}

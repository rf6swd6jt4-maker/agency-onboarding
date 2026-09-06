import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { communicationAttachmentFromValue, communicationMediaMetadata, communicationMediaRatio, communicationPreviewUrl } from "../lib/communications/attachments.ts"
import { communicationMediaRequestHeaders, communicationMediaStatusIsValid } from "../lib/communications/media-http.ts"
import { createMediaQueue } from "../lib/communications/media-queue.ts"

test("image-only client and team bubbles reserve width independently of decoded media", async () => {
    const bubble = await readFile("components/communications/NativeMessageBubble.tsx", "utf8")
    assert.match(bubble, /image \? \{ width: "min\(22rem, 100%\)" \}/)
    assert.doesNotMatch(bubble, /onLoadedMetadataCapture|setAspectRatio/)
    for (const file of ["CommunicationsWorkspace", "TeamCommunicationsWorkspace"]) {
        const source = await readFile(`components/communications/${file}.tsx`, "utf8")
        assert.match(source, /image=\{message\.attachment\?\.kind === "image"\}/)
    }
})

test("media dimensions survive storage normalization without trusting invalid layout hints", () => {
    const attachment = communicationAttachmentFromValue({ storagePath: "workspace/client-messages/image.enc", fileName: "photo.jpg", mimeType: "image/jpeg", width: 1080, height: 1920, duration: 30, hasPreview: true })!
    assert.equal(attachment.width, 1080)
    assert.equal(attachment.height, 1920)
    assert.equal(attachment.hasPreview, true)
    assert.equal(communicationMediaRatio(attachment), 1080 / 1920)
    for (const invalid of [0, -1, Infinity, NaN, "100", 0.5, 1e9]) assert.deepEqual(communicationMediaMetadata({ width: invalid, height: 100, duration: Infinity }), {})
    assert.equal(communicationMediaRatio({ kind: "video" }), 4 / 3)
    assert.equal(communicationMediaRatio({ kind: "image", width: 1, height: 30000 }), 0.4)
    assert.equal(communicationPreviewUrl("/media/file?grant=abc#fragment"), "/media/file?grant=abc&preview=1")
})

test("private media forwards revalidation and video range validators without applying ranges to previews", () => {
    const request = new Request("https://example.test/media", { headers: { Range: "bytes=100-200", "If-Range": '"version"', "If-None-Match": '"cached"' } })
    assert.deepEqual(communicationMediaRequestHeaders(request, false), { "if-none-match": '"cached"', range: "bytes=100-200", "if-range": '"version"' })
    assert.deepEqual(communicationMediaRequestHeaders(request, true), { "if-none-match": '"cached"' })
    for (const status of [200, 206, 304, 416]) assert.equal(communicationMediaStatusIsValid(status), true)
    for (const status of [401, 403, 404, 500]) assert.equal(communicationMediaStatusIsValid(status), false)
})

test("preview loading is bounded, prioritizes visible media and cancels queued offscreen work", async () => {
    const queue = createMediaQueue(2)
    const started: string[] = []
    const done = new Map<string, () => void>()
    const add = (name: string, priority: number) => queue.add(priority, (finish) => { started.push(name); done.set(name, finish) })
    add("buffer", 1)
    add("visible1", 0)
    add("visible2", 0)
    const cancel = add("cancelled", 1)
    await Promise.resolve()
    assert.deepEqual(started, ["visible1", "visible2"])
    cancel()
    done.get("visible1")!()
    done.get("visible1")!()
    await Promise.resolve()
    assert.deepEqual(started, ["visible1", "visible2", "buffer"])
    done.get("visible2")!()
    await Promise.resolve()
    assert.equal(started.includes("cancelled"), false)
})

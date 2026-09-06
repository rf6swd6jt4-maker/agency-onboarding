/** Preserve validators and byte-range semantics across the authenticated proxy. */
export function communicationMediaRequestHeaders(request: Request, preview: boolean) {
    const headers: Record<string, string> = {}
    for (const name of ["if-none-match", "if-modified-since", ...(!preview ? ["range", "if-range"] : [])]) {
        const value = request.headers.get(name)
        if (value) headers[name] = value
    }
    return headers
}

export function communicationMediaStatusIsValid(status: number) {
    return (status >= 200 && status < 300) || status === 304 || status === 416
}

"use client"

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    type ReactNode,
} from "react"

type FlushTask = () => Promise<void>

type OnboardingSaveCoordinatorValue = {
    register: (id: string, task: FlushTask) => () => void
    flushAll: () => Promise<void>
}

const EMPTY_COORDINATOR: OnboardingSaveCoordinatorValue = {
    register: () => () => undefined,
    flushAll: async () => undefined,
}

const OnboardingSaveCoordinatorContext = createContext(EMPTY_COORDINATOR)

export function OnboardingSaveCoordinator({ children }: { children: ReactNode }) {
    const tasksRef = useRef(new Map<string, FlushTask>())

    const register = useCallback((id: string, task: FlushTask) => {
        tasksRef.current.set(id, task)
        return () => {
            if (tasksRef.current.get(id) === task) tasksRef.current.delete(id)
        }
    }, [])

    const flushAll = useCallback(async () => {
        await Promise.all([...tasksRef.current.values()].map((task) => task()))
    }, [])

    const value = useMemo(() => ({ register, flushAll }), [flushAll, register])

    return (
        <OnboardingSaveCoordinatorContext.Provider value={value}>
            {children}
        </OnboardingSaveCoordinatorContext.Provider>
    )
}

export function useOnboardingSaveCoordinator() {
    return useContext(OnboardingSaveCoordinatorContext)
}

export function useOnboardingSaveTask(id: string, flush: FlushTask) {
    const { register } = useOnboardingSaveCoordinator()
    const flushRef = useRef(flush)

    useEffect(() => {
        flushRef.current = flush
    }, [flush])

    useEffect(() => register(id, () => flushRef.current()), [id, register])
}
